# Auditoría de plataforma — preparación para escalar

**Fecha:** 11-ago-2026 · **Alcance:** respondo-portal completo (23.154 líneas, 158 archivos)
**Objetivo:** dejar la plataforma lista para pasar de 1 cliente real a varios, sin
iterar a cada rato.

**Estado final:** TypeScript limpio · 38 pruebas en verde (4 nuevas) · ESLint sin
avisos en todo el proyecto.

---

## Resumen ejecutivo

Se revisaron aislamiento multi-cliente, rendimiento, seguridad, crecimiento de
datos, monitoreo y experiencia de usuario. **La base es sólida** —RLS en las 27
tablas, cabeceras de seguridad completas, cero fugas de datos personales en
logs, aislamiento por cliente bien construido—. No fue una auditoría de "arreglar
lo que está mal": fue de encontrar lo que **rompe al agregar el cliente número 2**.

Se encontraron **4 fallos que solo aparecen al escalar**, todos silenciosos (sin
error visible), y uno de ellos con daño ya programado para esta semana.

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | WAHA mezcla clientes: mensajes de un negocio salen por el WhatsApp de otro | **Crítica** | Arreglado + riesgo activo neutralizado |
| 2 | El cliente queda en silencio cuando el modelo se satura | **Alta** | Arreglado |
| 3 | El monitoreo es ciego a los tokens de los clientes reales | **Alta** | Arreglado |
| 4 | `waba_phone_id` con doble uso: la migración a Cloud API dejaba mudo a Tino | **Alta** | Arreglado (migración 275) |
| 5 | `ed_webhook_eventos` crece para siempre | Media | Arreglado (migración 276) |
| 6 | 404 sin marca | Baja | Arreglado |

---

## 1 · CRÍTICO — WAHA mezcla clientes entre sí

### Qué encontré

WAHA está cableado a **un solo negocio**, y nada lo impedía a nivel de datos:

- `lib/waha.ts:406` — el parser fija `instancia: INSTANCIA` (variable de
  entorno). Todo lo que entra se atribuye a ese cliente, venga de donde venga.
- `enviarTextoWaha` usa la constante global `SESSION`. Todo lo que sale se manda
  desde **ese** WhatsApp.

Con un cliente funcionaba perfecto. Con dos, los recordatorios del cliente B
salen desde el número del cliente A y quedan guardados en la conversación de A.
Sin error, sin log raro: se mezclan dos negocios en silencio. Es el peor fallo
posible —privacidad— y el más difícil de notar.

### No era hipotético: había daño programado

Al verificar contra la base encontré **4 clientes activos** con
`transporte='waha'` (el valor por defecto de la columna) y **5 seguimientos
pendientes** de clientes de prueba que habrían salido por el WhatsApp real de
Impresora Color:

```
confirmacion_cita    → +56911223344   [Barbería Nogal]           05-ago
recordatorio_cita    → +56911223344   [Barbería Nogal]           06-ago
confirmacion_cita    → +56965950344   [Clínica Dental Sonrisa]   16-ago
recordatorio_cita    → +56965950344   [Clínica Dental Sonrisa]   17-ago
encuesta_postventa   → +56965950344   [Clínica Dental Sonrisa]   17-ago
```

`+56965950344` es **tu número**, y además es **contacto real de Impresora
Color**. Los tres del 16-17 de agosto le habrían llegado desde el WhatsApp de
Cecilia hablando de una hora dental — y se habrían guardado dentro de la
conversación real de Impresora contigo, ensuciando su inbox, su embudo y el
informe semanal que ella lee.

Vinieron del sembrado de datos demo y de la reserva de prueba de la agenda.

### Qué hice

1. **Barrera en el envío** (`lib/waha.ts`): `enviarTextoWaha` acepta `clienteId`
   y **rechaza** el envío si ese cliente no es el dueño de la sesión. Quien llama
   lo trata como fallo de envío y deja la conversación esperando a una persona —
   falla segura en vez de escribirle a un cliente ajeno.
2. **Conectada en los dos caminos de fuga**: el cron de seguimientos y el
   inbound de WAHA.
3. **Detección temprana en `/api/salud`**: avisa si hay clientes en `waha` que no
   son dueños de la sesión. Se pone en rojo **solo** si tienen envíos pendientes
   —los clientes demo dormidos no encienden la alarma, porque un monitor siempre
   rojo se termina ignorando.
4. **Riesgo activo neutralizado**: eliminé los 5 seguimientos pendientes.
   Verificado: quedan 0.

### Lo que NO hice, a propósito

No construí WAHA multi-sesión. Es la vía **no oficial y de salida**: ahora que
Meta aprobó la app, los clientes nuevos deben entrar por Cloud API, que sí es
multi-cliente de verdad (credenciales por cliente en `ed_clientes`). Construir
multi-sesión sería invertir en el camino que estamos abandonando.

**Regla operativa:** solo Impresora Color va por WAHA. Todo cliente nuevo entra
por Cloud API con coexistencia.

---

## 2 · ALTO — El cliente queda en silencio justo cuando el modelo falla

### Qué encontré

`responderBot.ts` tiene una "red de seguridad" muy bien pensada: si el modelo
falla, le avisa al cliente ("se me complicó revisar eso, le aviso al equipo") y
deja la conversación esperando a una persona. Existe desde la auditoría del
30-jul y resuelve el peor fallo posible.

**Pero esa red vive DESPUÉS de la llamada al modelo, y nunca alcanzaba a
ejecutarse en el caso para el que fue escrita.** Sumando el peor camino:

```
debounce largo             20,0 s   (mensaje corto sin puntuación final)
generarJSON peor caso      82,7 s   (2 modelos × 2 intentos × 20 s + esperas)
envío con "escribiendo…"    6,0 s
──────────────────────────────────
total                     108,7 s   vs.  maxDuration = 60 s
```

Vercel mata la función a los 60 s. El proceso muere **antes** de llegar a la red
de seguridad: el cliente no recibe nada, nadie se entera, y como el mensaje ya
quedó guardado, el reintento de Meta lo descarta por duplicado y no se responde
nunca.

Lo grave es cuándo ocurre: cuando Gemini está saturado. El propio comentario de
`gemini.ts` dice que los 503/429 "son muy comunes a ciertas horas". O sea, la
garantía de "el cliente NUNCA queda en silencio" se caía exactamente en el
escenario que la justifica.

### Qué hice

- **`lib/presupuesto.ts` (nuevo)**: fecha límite absoluta calculada al entrar al
  webhook, reservando 16 s para responder y derivar.
- **`gemini.ts`**: acepta `fechaLimite`, recorta el timeout de cada intento a lo
  que quede y deja de intentar cuando no alcanza (falla rápido y a propósito).
- Conectado en los **tres** canales: WAHA, Meta y Instagram.

**Verificado con pruebas** (`tests/presupuesto.test.mjs`, 4 nuevas): con un
presupuesto de 4 s y Gemini simulado colgado, la llamada retorna en 4,9 s en vez
de 40 s+. La red de seguridad ahora siempre alcanza a correr.

---

## 3 · ALTO — El monitoreo es ciego a los clientes reales

### Qué encontré

`/api/salud` revisa el token de Meta… pero solo el de las variables de entorno
`WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`, que son las del **número de
prueba**.

Cada cliente onboardeado por Embedded Signup guarda **su propio** token en
`ed_clientes.waba_token`. Esos no los miraba nadie.

Con 10 clientes en Cloud API, si a uno se le revoca el token —el dueño le quita
el acceso a la app desde Meta Business Suite, o Meta lo invalida— su Tino queda
mudo y `/api/salud` sigue diciendo "ok" porque el número de prueba está sano.

**Es exactamente el patrón del apagón de 21 horas de agosto**: el vigilante
mirando el lugar equivocado. Lo peor es que escala con el negocio: mientras más
clientes, más probable que uno esté caído sin que lo sepamos.

### Qué hice

Nuevo chequeo `tokens_clientes`: valida el token real de cada cliente en vía
oficial contra Graph API (en paralelo, acotado a 10 por corrida, 8 s de timeout)
y nombra a los que fallan. Corre con el secreto pero **sin exigir `full=1`**,
para que entre en el chequeo automático de cada 30 minutos y no en uno manual.

> **Pendiente tuyo:** confirmar que la URL del vigilante en cron-job.org incluya
> `?k=<CRON_SECRET>`. Sin el secreto, este chequeo no corre.

---

## 4 · ALTO — `waba_phone_id` con doble uso (bloqueaba la coexistencia)

Detallado en `docs/COEXISTENCIA_PASO_A_PASO.md`. Resumen: la misma columna
guardaba el nombre de la instancia de WAHA y el `phone_number_id` de Meta. Al
completar el Embedded Signup se sobrescribía, dejando el ruteo de WAHA sin mapeo
y a Tino mudo **sin camino de vuelta**.

Arreglado con la **migración 275** (columna `waha_instancia` propia + CHECK para
que no vuelvan a mezclarse) y respaldo en el código para que el deploy sea
seguro en cualquier orden.

---

## 5 · MEDIO — `ed_webhook_eventos` crece para siempre

La purga existente vacía el `payload` a los 7 días pero **nunca borra la fila**.
Medido con un solo cliente: **4.110 filas en 30 días**, casi una por mensaje.

```
 1 cliente   →    ~50.000 filas/año
25 clientes  → ~1.200.000 filas/año
50 clientes  → ~2.500.000 filas/año
```

No es un problema de corrección (el índice único mantiene la idempotencia), pero
Supabase cobra por tamaño y una tabla que solo crece termina siendo la que nadie
se atreve a tocar. Barato ahora, molesto con millones de filas.

**Arreglado:** borrado por tandas de 500 con retención de 30 días (Meta y WAHA
reintentan durante horas, no semanas) + índice de apoyo en la **migración 276**.

---

## 6 · BAJO — 404 sin marca

Cualquier URL equivocada —un enlace viejo en un correo, un slug de reserva mal
escrito— caía en la pantalla por defecto de Next: fondo blanco, tipografía del
sistema, *"This page could not be found"*. Es una de las pocas pantallas que un
cliente puede ver **antes** de confiar en nosotros.

**Arreglado:** `app/not-found.tsx` con el sistema de diseño del portal.
(Verifiqué que las clases y variables CSS usadas existen realmente en
`globals.css` y que el isotipo está en `public/brand/`.)

---

## Lo que revisé y está bien (no requiere acción)

Vale tanto como los hallazgos, porque evita gastar tiempo acá:

- **Aislamiento multi-cliente**: escaneé las 32 consultas a `ed_clientes` y todas
  las tablas con `cliente_id`. Toda acción de servidor que recibe un id del
  navegador valida pertenencia antes de escribir. Sin IDOR.
- **RLS**: activo en las **27 tablas**. Ninguna sin protección.
- **Cabeceras de seguridad**: CSP, HSTS con preload, X-Frame-Options,
  Permissions-Policy, COOP. Nivel empresa, ya estaba.
- **Fugas de datos personales en logs**: cero. Los `console.error` registran
  códigos y mensajes de error, nunca teléfonos ni contenido de conversaciones.
  Relevante para la Ley 21.719 (diciembre 2026).
- **Índices**: buena cobertura. `portal_usuarios.email` —consultado en **cada**
  request autenticado— está indexado vía la restricción `unique` (lo verifiqué
  específicamente porque parecía faltar).
- **Analítica**: la paginación de 1.000 filas está bien resuelta. Medí el volumen
  real: 4.007 mensajes/30 días = 5 viajes a Supabase. Y como la página es **por
  cliente**, sumar clientes no la enlentece. Descartado como riesgo.
- **Cron**: acotado a 10 seguimientos por corrida, con tope diario **por cliente**
  (ya corregido en julio). No se dispara al escalar.
- **Límite de la función**: el cron y los webhooks están en 60 s con márgenes
  razonables una vez aplicado el presupuesto de tiempo.
- **Manejo de errores en la UI**: `error.tsx` del portal es excelente —detecta el
  desajuste de chunks tras un deploy y recarga solo, sin cartel feo.

---

## Riesgos conocidos que NO arreglé (decisión consciente)

1. **Ritmo de seguimientos a escala.** El cron manda hasta 10 por corrida cada
   5 min, y solo en horario hábil: ~1.400/día para **todos** los clientes
   juntos. Con 30-40 clientes activos los recordatorios empezarán a salir tarde.
   Además se ordenan por fecha programada de forma global, así que un cliente con
   mucho atraso puede postergar a los demás. Subir el límite arriesga el timeout
   de 60 s: la solución correcta es repartir por cliente (round-robin), y conviene
   hacerlo cuando haya volumen real que lo justifique, no antes.

2. **WAHA sigue siendo de un solo cliente.** Es intencional (ver hallazgo 1). La
   barrera lo hace seguro; el camino es Cloud API.

3. **`waba_token` sin cifrar en la base.** El comentario de la migración 210 ya
   lo anota. Hoy el riesgo es acotado (service role nunca llega al navegador y
   RLS está activo), pero con varios clientes reales conviene moverlo a Supabase
   Vault. Lo dejo señalado, no hecho: cambia el flujo de onboarding y quería que
   lo decidas tú.

---

## Qué tienes que hacer

En este orden:

1. **Commit + push** de todo lo de hoy.
2. Esperar el deploy y **aplicar las migraciones 275 y 276** en Supabase
   (en ese orden; la 275 tiene su propio paso a paso en
   `COEXISTENCIA_PASO_A_PASO.md` — **deploy primero, migración después**).
3. **Verificar que el vigilante de cron-job.org apunte a
   `/api/salud?k=<CRON_SECRET>`.** Sin el secreto, los dos chequeos nuevos no
   corren y el punto ciego sigue abierto.
4. Cuando conectes clientes nuevos: **siempre por Cloud API**, nunca por WAHA.

---

## Archivos tocados

**Nuevos**
```
lib/presupuesto.ts                  presupuesto de tiempo de la función
tests/presupuesto.test.mjs          4 pruebas del presupuesto
app/not-found.tsx                   404 de marca
sql/275_waha_instancia.sql          separa identidad WAHA / Meta
sql/276_purga_webhooks.sql          índice para la purga por antigüedad
docs/COEXISTENCIA_PASO_A_PASO.md    runbook de coexistencia
docs/AUDITORIA_ESCALA_AGO2026.md    este informe
```

**Modificados**
```
lib/gemini.ts                       respeta la fecha límite
lib/responderBot.ts                 recibe y propaga el presupuesto
lib/inboundWaha.ts                  presupuesto + barrera multi-cliente
lib/inboundMeta.ts                  presupuesto
lib/inboundInstagram.ts             presupuesto
lib/waha.ts                         barrera anti-fuga + waha_instancia
lib/webhookInbox.ts                 borrado de eventos viejos
app/api/salud/route.ts              2 chequeos nuevos
app/api/cron/seguimientos/route.ts  pasa clienteId a la barrera
app/api/whatsapp/onboarding/route.ts  verifica coexistencia real
app/(portal)/whatsapp/page.tsx      muestra el modo de conexión
```
