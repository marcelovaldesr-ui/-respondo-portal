# El portal como app en el teléfono · plan de 48 horas

**Fecha:** 24 de agosto de 2026
**Estado del código:** escrito y verificado — **156 tests en verde, typecheck limpio, lint
limpio y `npm run build` OK**.
**Costo en dinero:** cero. No hay tiendas, ni cuentas de desarrollador, ni revisiones.

---

## Qué es esto y qué NO es

El portal pasa a poder **instalarse en la pantalla de inicio** del teléfono. Se abre sin
barra de direcciones, con el ícono de Respondo, y **suena cuando un cliente necesita a una
persona**.

**No es una app aparte.** Es el mismo código y el mismo despliegue: cuando haces `git push`,
el cambio le llega a todos al instante. No hay nada que republicar ni que le aprueben.

**No está en el App Store ni en Play Store.** Eso es otra decisión, con otro costo, y
conviene tomarla cuando haya un motivo comercial concreto — no ahora.

---

## HORA 0 → 1 · Tus cuatro pasos

### 1 · Aplicar la migración 283  ·  2 minutos

Supabase → SQL Editor → pegar **`sql/283_push_suscripciones.sql`** → Run.

Crea la tabla donde se guarda a qué teléfono hay que avisarle.

> Se puede aplicar antes o después del despliegue. Si no está, el portal simplemente no
> ofrece las notificaciones y todo lo demás funciona igual. **No es como la 279**, donde el
> código necesitaba la columna sí o sí.

**Cómo saber que quedó:** `select count(*) from ed_push_suscripciones;` debe devolver 0 sin
error.

### 2 · Generar el par de llaves y cargarlo en Vercel  ·  5 minutos

**Primero, generarlas en tu computador:**

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
npx web-push generate-vapid-keys
```

Devuelve dos líneas: `Public Key` y `Private Key`.

> **Por qué se generan acá y no te las paso yo.** La privada es un secreto: con ella
> cualquiera puede mandar notificaciones haciéndose pasar por Respondo. Generándola en tu
> máquina **no pasa por ningún chat ni queda escrita en este repositorio**. Es el mismo
> criterio que con la contraseña de Gmail de la cuenta de revisión.

**Después, Vercel → el proyecto del portal → Settings → Environment Variables.** Las cuatro,
en **Production**:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la **Public Key** que salió arriba |
| `VAPID_PUBLIC_KEY` | la **misma Public Key**, otra vez |
| `VAPID_PRIVATE_KEY` | la **Private Key** |
| `VAPID_SUBJECT` | `mailto:hola@respon-do.com` |

Sí, la pública va dos veces y no es un error: una la lee el navegador (por eso lleva
`NEXT_PUBLIC_`, que en Next significa "esto se publica") y la otra la lee el servidor para
firmar. Separadas a propósito, para que nunca haya dudas de cuál es cuál.

> **Qué son.** Un par de llaves que firman cada aviso para que Google y Apple sepan que
> viene de nosotros. La pública viaja al navegador (es pública por diseño); **la privada
> jamás sale del servidor**.
>
> ⚠️ **Si se pierden o se cambian, todas las suscripciones dejan de funcionar** y hay que
> volver a pedir permiso en cada teléfono. Guárdalas donde guardas el resto de las claves.
> Mientras no haya nadie suscrito, regenerarlas no cuesta nada; después sí.

### 3 · Desplegar  ·  5 minutos

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
npm install
npm run build
git add -A
git commit -m "PWA: instalable, notificaciones push y bandeja movil"
git push
```

⚠️ **El `npm install` no es opcional**: se agregaron `web-push` y `@types/web-push`.

### 4 · Instalarla en tu teléfono  ·  2 minutos

**Android (Chrome):** entra al portal → aparece un cartel «Instalar app» → tocar. Si no
sale, menú ⋮ → «Instalar aplicación».

**iPhone (Safari — tiene que ser Safari):** entra al portal → botón **Compartir** →
**Agregar a pantalla de inicio**.

> ⚠️ **En iPhone esto no es opcional.** Apple no entrega notificaciones a una pestaña de
> Safari: solo a la app agregada a la pantalla de inicio. Si no se instala así, el botón de
> avisos ni siquiera aparece — en su lugar sale la instrucción de cómo instalarla.

Después: abrir desde el ícono → pantalla **Inicio** → botón **«Activar avisos»** → aceptar
el permiso del sistema.

---

## HORA 1 → 24 · Probar de verdad

Esto es lo que yo no puedo hacer: necesita un teléfono y un cliente escribiendo.

| # | Prueba | Qué debe pasar |
|---|---|---|
| 1 | Instalar y abrir desde el ícono | Sin barra de direcciones. Barra de estado en navy |
| 2 | Mantener presionado el ícono | Aparecen los atajos «Chats» y «Agenda» |
| 3 | Activar avisos | El botón queda en «Desactivar» y el recuadro se pone índigo |
| 4 | **Que un cliente escriba algo que el asistente derive** | Llega la notificación con el **nombre** del contacto |
| 5 | Tocar la notificación | Abre el portal **en esa conversación** |
| 6 | Con la app abierta y otro chat, tocar otra notificación | Reusa la misma ventana, no abre otra |
| 7 | Poner el teléfono en modo avión y abrir la app | Sale la pantalla «Sin conexión», no el dinosaurio |
| 8 | En el teléfono, tocar una conversación | La lista se oculta y se ve el chat completo |
| 9 | Tocar «Volver a la lista» | Vuelve al instante, con el mismo scroll y filtros |

**Para forzar la prueba 4** sin esperar a un cliente real: escríbele al número algo que
obligue al asistente a derivar — un reclamo, o algo que no pueda responder («necesito hablar
con el dueño ahora»).

---

## Cuándo suena, y por qué así

El aviso sale **cuando el asistente decide que la conversación necesita una persona**, no en
cada mensaje.

Es deliberado: Tino atiende la mayoría de las conversaciones. Si notificáramos todo, la
persona apagaría los avisos en una semana — y ahí perderíamos también los que sí importan.
**Un aviso que se ignora es peor que ninguno.**

Si más adelante un cliente quiere que le llegue todo, se puede hacer configurable. Que lo
pida primero.

---

## Lo que quedó decidido y conviene no revisar

**El permiso se pide después de un clic, nunca solo.** Un navegador que muestra el cartel
apenas entras recibe un «Bloquear» reflejo — y ese bloqueo es **permanente**: desde el
código no se puede volver a preguntar nunca más. La persona tendría que ir a la
configuración del navegador a mano.

**El service worker cachea lo mínimo.** Solo los archivos con hash de Next y los íconos.
Las llamadas a `/api` y las navegaciones van siempre a la red. Para una bandeja de mensajes,
mostrar algo viejo es peor que no mostrar nada: alguien podría creer que un cliente no ha
escrito.

**`/sw.js` se sirve con `no-cache`.** Es el error clásico de las PWA: el navegador guarda el
service worker, y como ese archivo controla lo que se sirve, una versión vieja puede quedar
mandando durante días.

**Hay dos juegos de íconos.** Android recorta el ícono en círculo o «squircle» según el
fabricante y se come hasta el 20% de cada borde. Por eso los `maskable` llevan la marca al
55% del lienzo sobre el degradado a sangre. Sin eso, el logo sale decapitado en la mitad de
los teléfonos.

---

## Una regresión que cacé antes de desplegar

Al pasar el cambio de conversación al lado del cliente (commit `8252f8b`), **la lista dejó
de ocultarse en el teléfono** al abrir un chat: la visibilidad dependía de un valor que
calculaba el servidor y que ya no cambia.

En un celular eso significaba tocar una conversación y que la lista quedara encima, tapando
justo lo que acababas de abrir. **No se ve en el computador**, donde las dos columnas
conviven y todo parece correcto.

Resuelto con `ColumnaLista`. Vale como recordatorio: mover algo al cliente puede romper cosas
que dependían del renderizado del servidor, y las que se rompen en móvil no se notan probando
en el escritorio.

---

## Lo que NO hice, y por qué

- **Envoltorio para las tiendas (Capacitor).** Apple rechaza bajo la guía 4.2 lo que sea «un
  sitio web envuelto». Habría que agregar funciones nativas de verdad y además pasar la
  revisión. US$99 al año + US$25, y no aporta nada que esto no dé.
- **Modo sin conexión de verdad** (leer conversaciones guardadas). Requiere sincronización y
  resolver conflictos; para una bandeja en vivo, el riesgo de mostrar algo desactualizado es
  peor que el beneficio.
- **Avisos configurables por tipo.** Que un cliente lo pida primero.
- **Insignia con el número de pendientes en el ícono.** La API está poco soportada; es
  cosmética.

---

## Si algo no funciona

| Síntoma | Dónde mirar |
|---|---|
| No aparece el botón de avisos | Faltan las variables VAPID en Vercel, o es un iPhone sin instalar |
| Se activa pero no llega nada | Registros de Vercel: `[push] fallo al enviar` |
| «Las notificaciones todavía no están habilitadas» | Falta la migración 283 |
| El ícono se ve como una captura de la página | `apple-touch-icon` no cargó: forzar recarga y reinstalar |
| Cambié algo y en el teléfono se ve lo viejo | Cerrar la app del todo y volver a abrir; el service worker toma el control en la siguiente carga |
