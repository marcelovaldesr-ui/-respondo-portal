# Auditoría de la plataforma · tres ciclos

**Fecha:** 24 de agosto de 2026 (de madrugada)
**Alcance:** 22 páginas, 27 endpoints, 7 server actions, 74 módulos de `lib`, 29
componentes, 33 migraciones.
**Estado al cerrar:** **156 tests en verde · typecheck limpio · lint limpio · `npm run
build` OK.**

> **Cómo leer esto.** Está ordenado por ciclo, y dentro de cada ciclo primero lo que se
> encontró y después lo que se hizo. Los resultados NEGATIVOS —lo que se buscó y no
> apareció— están incluidos a propósito: saber que algo se revisó y estaba bien vale tanto
> como saber qué se arregló, y evita volver a revisarlo dentro de un mes.

---

## Ciclo 1 · Seguridad y aislamiento

### Lo que se buscó y NO apareció

| Se buscó | Resultado |
|---|---|
| Endpoints sin autenticación | **8 detectados, los 8 correctos**: webhooks con firma, accesos por token de un solo uso, y `/api/version` que no expone dato alguno |
| Fugas de aislamiento entre clientes | **27 consultas revisadas una por una. Ninguna filtra de más.** Las 4 sospechosas resultaron sondas de existencia o consultas ya acotadas por ids del propio cliente |
| Secretos en el código | **0** |
| `dangerouslySetInnerHTML`, `eval`, `innerHTML` | **0** |
| `any` explícito | **0** |
| `catch` vacíos que traguen errores | **0** |
| Enlaces externos sin `rel=noreferrer` | **0** |
| Imágenes sin `alt` · botones de ícono sin etiqueta | **0** |

Esto es una base sana. La disciplina de filtrar por `cliente_id` en cada consulta está
sostenida en todo el repositorio.

### Lo que sí apareció, y se arregló

**1 · `/api/error-cliente` sin freno de abuso.** Es público por necesidad —si el portal se
rompe antes de cargar la sesión, igual queremos enterarnos— pero público + escribe en los
registros significa que alguien puede inflar la factura de Vercel con un bucle.
→ Freno por IP, 30 por minuto. Devuelve **200 y no 429** a propósito: es telemetría, y un
429 haría que el reportador reintente y genere más tráfico del que se está frenando.

**2 · `/api/push/suscribir` sin freno.** Escribe en la base. → 10 por minuto por usuario.

**3 · El stream en vivo no limitaba conexiones simultáneas.** Cada uno mantiene una función
viva hasta 50 segundos; nada impedía abrir veinte pestañas y tener veinte corriendo.
→ 6 por minuto. Al superarlo, el navegador **cae solo al sondeo**: nadie se queda sin
mensajes, solo con un segundo más de latencia.

**4 · `productionBrowserSourceMaps` seguía activo.** Se había puesto el 19-ago para cazar el
fallo «i is not a function», que dejó de reproducirse. Publicaba el código fuente del
cliente sin razón. → Quitado, con la línea para reactivarlo anotada por si vuelve.

---

## Ciclo 2 · Rendimiento e integridad de los datos

### El hallazgo más grave: números creíbles y falsos

**PostgREST corta toda respuesta en 1.000 filas** por configuración del servidor, y
`.limit(n)` mayor **no** la sube. Este repositorio ya pagó ese error una vez: el 31-jul la
analítica leía solo los 1.000 mensajes más antiguos y reportaba **0% de cobertura de IA con
el bot funcionando a todo dar**.

La auditoría encontró **el mismo patrón todavía vivo en dos lugares**:

**`lib/contadores.ts` — los contadores del menú lateral.** Traía las filas de oportunidades
abiertas y las contaba en JavaScript. Un cliente con más de mil vería un tope de 1.000, sin
ningún error.
→ Ahora cuenta en Postgres con `count: "exact", head: true`, que **no transfiere ni una
fila**: es más correcto y además más barato. La lista que sí se muestra en pantalla lleva un
`limit(200)` explícito.

**`lib/embudo.ts` — el tablero del embudo.** Sin límite, un cliente con muchos contactos
vería un tablero incompleto: tarjetas que simplemente no están.
→ `limit(500)` explícito y documentado.

> Por qué importa más que un error normal: **un panel que el cliente usa para decidir si
> sigue pagando no se puede equivocar en silencio.** Un error se ve y se arregla; un número
> plausible pero falso se cree.

### N+1 en el cron de seguimientos

`lib/seguimientos.ts` recorría los clientes de la tanda y hacía **dos consultas por cada
uno**. Con 3 clientes eran 6 y no se notaba; con 30 son 60, en serie, dentro de un cron con
techo de tiempo.

→ Reescrito a **dos consultas totales**: una trae todos los empleados de todos los clientes
de la tanda, otra los envíos del día de todos esos empleados, y el conteo por cliente se
arma en memoria.

Es de los errores que no duelen hasta que el negocio funciona — y ahí duelen justo cuando
menos conviene.

### ❌ Un falso hallazgo mío, y el error que casi introduce

La auditoría reportó **«13 de 14 páginas sin estado de carga»**. Era falso, y el script era
el culpable: comprobaba si cada página tenía un `loading.tsx` **en su propia carpeta**, sin
mirar que ya existía uno **a nivel del grupo** `(portal)` que las cubre a todas.

Lo grave no es el falso positivo: es que actué sobre él. Escribí un `loading.tsx` nuevo
**encima del que ya estaba** — y el original era mejor: su relleno coincidía con el de las
páginas reales y sus tarjetas imitaban la estructura de verdad, en vez de seis cajas
genéricas.

Se detectó porque al revisar el estado final el archivo aparecía como **modificado** y no
como nuevo. Restaurado con `git checkout`.

**Dos lecciones que valen más que el arreglo:**

1. **Un script de auditoría también se audita.** Un hallazgo automático no es un hecho hasta
   que se mira el archivo.
2. **Que un archivo aparezca como «modificado» cuando esperabas «nuevo» es una alarma.** Fue
   lo único que lo delató.

---

## Ciclo 3 · Verificación y visibilidad operativa

Se repasó lo arreglado y se buscó lo que quedaba fuera del alcance de los dos primeros.

**Se agregó un chequeo de notificaciones a `/api/salud`.** Si las llaves VAPID se borran de
Vercel o la tabla desaparece, los avisos dejan de salir **en silencio**: el portal sigue
funcionando y lo único que pasa es que el teléfono no suena. Nadie reclama por algo que no
ocurre — se descubre cuando un cliente dice «les escribí ayer y no me contestaron».

Ahora el vigilante lo reporta junto al resto. Distingue tres casos: faltan las llaves, falta
la migración, o está bien (y cuántos dispositivos hay suscritos). **Cero dispositivos no es
un fallo**: puede que nadie los haya activado todavía.

---

## Lo que se decidió NO tocar, y por qué

- **Unificar `AvisoVersion` y `VigilanteDeVersion`.** Parecían duplicados; al leerlos son
  **complementarios**: uno consulta la versión cada 10 minutos y avisa, el otro escucha
  errores del navegador y los reporta. Juntarlos sería mover código sin ganar nada y con
  riesgo de romper el reporte de errores, que es lo único que hoy nos deja ver un fallo del
  lado del cliente.
- **Virtualizar la lista de mensajes.** Con 60 mensajes en pantalla y paginación hacia
  atrás no hace falta. Si algún cliente carga 2.000 de una, ahí sí.
- **Las 14 consultas restantes sin `limit`.** Se revisaron una por una: son consultas
  acotadas por ids ya derivados del cliente, o con `maybeSingle()`, o de paginación
  deliberada. No hay riesgo de corte silencioso.
- **Miniaturas del lado del servidor.** Requiere `sharp` como dependencia nueva; con caché
  de un año, espacio reservado y carga diferida, el problema práctico ya está resuelto.

---

## Riesgos que siguen abiertos

| Riesgo | Estado |
|---|---|
| **Método de pago del WABA** | ⛔ Sigue bloqueando a Beto, a Vera y a las plantillas desde la bandeja |
| Fallo «i is not a function» | Dejó de reproducirse. Sin causa confirmada, y ya sin mapas de origen para diagnosticarlo |
| Ley 21.719 | Entra el 1-dic-2026. Falta razón social, términos y política publicados |
| `prompt-nucleo.md` maestro desfasado | Riesgo de editar el archivo equivocado |
| Verificación de negocio del WABA | `not_verified`: limita el tier de envío si RS-Shop expande |

---

## Qué queda por probar con un teléfono

Nada de la auditoría necesita migración. Lo que sí falta probar es lo construido antes:

1. **Recibir una imagen** por Cloud API y verla en la bandeja.
2. **Enviar una** con 📎 y con Ctrl+V.
3. **Instalar la app** y activar los avisos.
4. **Que un cliente escriba algo que el asistente derive** → debe sonar el teléfono.

Los pasos detallados están en `docs/INBOX_RENDIMIENTO_AGO2026.md` y
`docs/PWA_PASO_A_PASO.md`.
