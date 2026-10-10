# Kambak en el portal de Respondo — cuenta de solo mensajería

Kambak (kambak.cl, tarjetas de sellos digitales) usa el portal **solo como cañería de WhatsApp**:
un número, sin asistentes IA. Salen únicamente (1) los mensajes que el sistema de Kambak pide por
API y (2) lo que una persona escribe a mano desde la bandeja. **Nada contesta solo.**
Los datos de Kambak y de Respondo no se mezclan: Kambak es su propio cliente (tenant) del portal.

## Cómo funciona

| Pieza | Qué hace |
|---|---|
| `ed_clientes.solo_mensajeria` (migración 322) | Apaga toda la IA de la cuenta: el mensaje entrante se guarda, pero no se llama a ningún modelo. Los controles de IA salen bloqueados ("Esta cuenta es de solo mensajería."). |
| `POST /api/externo/mensajes` (migración 323) | Kambak pide "mándale esta plantilla a este número". El portal vuelve a revisar todo (segunda barrera). |
| Webhook de salida (migración 324) | El portal le avisa a Kambak: estado de cada mensaje, mensajes entrantes y bajas. |
| Bandeja (`/conversaciones`) | Quien del equipo se agregue como usuario responde a mano dentro de las 24 h, o manda una plantilla de aviso. |

## 1. API de envío (Kambak → portal)

`POST https://<dominio-del-portal>/api/externo/mensajes` — JSON:

```json
{
  "clienteId": "<id de la cuenta Kambak en el portal>",
  "to": "+56912345678",
  "template": "sello_promo",
  "language": "es",
  "variables": ["Camila", "Café Aroma", "2x1 en cafés", "Pide uno y llévate otro.", "el 31 de octubre"],
  "idempotencyKey": "promo-oct-2026-camila-0001"
}
```

**Firma** (la misma de todas las rutas `/api/externo/*`): headers `x-respondo-ts` (segundos Unix),
`x-respondo-nonce` (aleatorio único, 8–128 caracteres) y `x-respondo-firma` =
`HMAC-SHA256(secreto, "<ts>.<nonce>.<cuerpo exacto>")` en hexadecimal. El secreto es el de la fila de
`ed_integraciones` de la cuenta. Reloj a menos de 5 minutos.

```js
const crypto = require('crypto');
const ts = String(Math.floor(Date.now() / 1000));
const nonce = crypto.randomBytes(12).toString('hex');
const firma = crypto.createHmac('sha256', process.env.RESPONDO_SIGNING_SECRET)
  .update(`${ts}.${nonce}.${cuerpo}`).digest('hex');
// headers: x-respondo-ts, x-respondo-nonce, x-respondo-firma
```

**Respuestas**

| Código | Significado |
|---|---|
| 200 `{ok,id,status:"sent"}` | Aceptado por Meta (los estados siguientes llegan por webhook). |
| 200 `status:"queued"` | Fuera de horario (9:00–21:00 Chile): sale solo a las 9:00 por el cron. |
| 200 `status:"skipped", reason:"opted_out"` | El número pidió BAJA. No se envió. |
| 200 `status:"skipped", reason:"monthly_cap"` | Ya recibió el máximo de marketing del mes. No se envió. |
| 200 `duplicate:true` | Misma `idempotencyKey`: devuelve el resultado anterior, no reenvía. |
| 400 / 422 | Clave, número (+56 9 y 8 dígitos), plantilla o variables inválidos. |
| 401 / 403 | Firma inválida / la cuenta no es de solo mensajería. |
| 429 / 502 / 503 | Demasiados envíos / Meta rechazó (`status:"failed"`) / WhatsApp sin configurar. |

**Reglas del portal (segunda barrera, además de las de Kambak)**
- Solo las 6 plantillas de abajo, con todas sus variables, en ese orden.
- Baja: utility y marketing no salen a un número en baja. El código de verificación sí (lo pidió la persona).
- Horario 9:00–21:00 hora de Chile para utility y marketing; el código sale siempre.
- Tope mensual por número **solo para marketing** (`RESPONDO_TOPE_MENSUAL_MARKETING`, por defecto 4). Ojo: el portal cuenta por teléfono entre TODOS los locales de Kambak; Kambak cuenta por cliente dentro de cada local. Una persona con tarjeta en dos locales puede llegar antes al tope del portal.
- Freno por número: códigos 5 cada 10 min; avisos 20 por minuto.
- Registro (`ed_envios_api`): plantilla, estado y huella del número. El teléfono y las variables solo
  existen mientras el envío espera en cola. El texto enviado vive en la conversación (lo ve la bandeja);
  el código de verificación **no** se guarda.

## 2. Webhook de salida (portal → Kambak)

`POST` a `KAMBAK_WEBHOOK_URL` (https). Cabeceras: `X-Respondo-Signature: sha256=<hex>` con
`HMAC-SHA256(KAMBAK_WEBHOOK_SECRET, cuerpo exacto)`, `X-Respondo-Event`, `X-Respondo-Delivery` (id del evento; ignorar repetidos).
Kambak responde **2xx** = recibido. Cuerpo: `{ "id", "type", "created_at", "data": {…} }`.

| `type` | `data` |
|---|---|
| `message.status` | `{ id, message_id, status: "sent"\|"delivered"\|"read"\|"failed", reason? }` — `id` es el de la respuesta de la API |
| `message.inbound` | `{ from: "+569…", type, text, message_id }` |
| `contact.optout` | `{ phone: "+569…", source: "whatsapp_keyword" }` |

**Reintentos:** si Kambak no responde 2xx, se reintenta a 1 min, 5 min, 15 min, 1 h, 6 h y 24 h. Después queda
en la bandeja de fallidos (`GET /api/kambak/eventos`; `POST /api/kambak/eventos {ids?}` los devuelve a la cola).

**Bajas nativas:** si alguien responde solo "BAJA", "STOP", "no más", "cancelar", "darme de baja", "unsubscribe"
(y variantes cortas), el portal marca el contacto `no_contactar`, responde una confirmación breve y emite
`contact.optout`. Frases largas no cuentan (para no silenciar a quien no lo pidió).

## 3. Variables de entorno (solo NOMBRES — los valores los carga una persona en Vercel)

**En el portal (Vercel de respondo-portal):**

| Nombre | Para qué |
|---|---|
| `KAMBAK_WEBHOOK_URL` | Dirección https del webhook de Kambak (`https://www.kambak.cl/api/hooks/respondo`) |
| `KAMBAK_WEBHOOK_SECRET` | Firma portal → Kambak (el mismo valor va en Kambak como `RESPONDO_WEBHOOK_SECRET`) |
| `RESPONDO_TOPE_MENSUAL_MARKETING` | Tope mensual por número (opcional, por defecto 4) |
| `RESPONDO_ENVIOS_SIMULADOS` | `1` = no llama a Meta (solo preview/desarrollo) |

**En Kambak (Vercel de sello-fidelizacion):**

| Nombre | Para qué |
|---|---|
| `MESSAGING_PROVIDER` | `respondo` para enviar por el portal (sin esto sigue directo con Meta o simulado) |
| `RESPONDO_API_URL` | Dirección https del portal, sin barra final |
| `RESPONDO_CLIENT_ID` | Id de la cuenta Kambak en el portal (`ed_clientes.id`) |
| `RESPONDO_SIGNING_SECRET` | Firma Kambak → portal; es el mismo valor que `ed_integraciones.secreto` de la cuenta |
| `RESPONDO_WEBHOOK_SECRET` | Verifica los avisos del portal (igual a `KAMBAK_WEBHOOK_SECRET` del portal) |

Kambak mantiene su interruptor (`MESSAGING_ENABLED`, `MESSAGING_DRY_RUN`) y su pausa global: el marketing solo llega al portal cuando están en verdad encendidos.

## 4. Plantillas para subir a Meta (las sube una persona; el código nunca las crea)

Idioma `es`. Nombre exacto en minúsculas. Las de marketing terminan con la línea de baja.

**`sello_premio_cerca`** — utility — variables: nombre, faltan (con la palabra: "1 sello" / "3 sellos"; Kambak la arma), premio, local
```
Hola {{1}}, ¡ya casi! Para tu {{3}} en {{4}} solo necesitas {{2}} más.

Te esperamos para completar tu tarjeta.
```
Ejemplos: Camila · 2 sellos · café gratis · Café Aroma. *Meta puede reclasificarla a marketing; si lo hace, se acepta o se ajusta el texto.*

**`sello_promo`** — marketing — nombre, local, titulo, detalle, hasta
```
Hola {{1}}, en {{2}} tenemos una promo para ti: {{3}}.

{{4}}

Válida hasta {{5}}.

Responde BAJA para no recibir más avisos.
```
Ejemplos: Camila · Café Aroma · 2x1 en cafés · Pide uno y llévate otro, de lunes a jueves. · el 31 de octubre

**`sello_evento`** — marketing — nombre, local, titulo, detalle, fecha
```
Hola {{1}}, {{2}} te invita: {{3}}.

{{4}}

Fecha: {{5}}.

Responde BAJA para no recibir más avisos.
```
Ejemplos: Camila · Café Aroma · Noche de música en vivo · Entrada liberada para quienes tienen tarjeta de sellos. · sábado 25 a las 20:00

**`sello_rescate`** — marketing — nombre, local, detalle
```
Hola {{1}}, hace tiempo que no te vemos por {{2}}. {{3}}

Te esperamos con tu tarjeta de sellos.

Responde BAJA para no recibir más avisos.
```
Ejemplos: Camila · Café Aroma · Esta semana tu próximo café tiene doble sello.

**`sello_cerca`** — marketing — nombre, local, sellos, meta
```
Hola {{1}}, en {{2}} llevas {{3}} de {{4}} sellos. ¡Te falta poco para tu premio!

Responde BAJA para no recibir más avisos.
```
Ejemplos: Camila · Café Aroma · 8 · 10

**`sello_codigo`** — **authentication** — variable: código. Se crea con el tipo "Autenticación" de Meta, activando "agregar recomendación de seguridad"
y "vencimiento del código: 5 minutos" (coincide con el vencimiento de Kambak), y el botón "Copiar código". Meta fija el texto
("{{1}} es tu código de verificación. Por tu seguridad, no lo compartas. Este código caduca en 5 minutos."). Se envía con el código en el cuerpo y en el botón.

Los textos exactos viven en `lib/plantillasKambak.ts`; un test (`tests/kambak-envios.test.mjs`) cuida que los
nombres, categorías y orden de variables no cambien sin avisar. **El repo de Kambak (`lib/messaging.js`) usa los mismos nombres y orden.**

## 5. Cómo probar sin mandar nada real

1. En un entorno de **preview** (no producción) con una base de desarrollo: aplicar 322, 323, 324 y `sql/consultas/kambak_alta.sql`.
2. Poner `RESPONDO_ENVIOS_SIMULADOS=1`. Hacer un POST firmado a `/api/externo/mensajes`: responde `sent` con un id `sim.…`
   y aparece en la bandeja. No se llama a Meta.
3. Probar los casos: número inválido (422), plantilla desconocida (422), misma clave dos veces (`duplicate`), 5.º marketing del mes (`monthly_cap`).
4. Tests automáticos: `npm test` (archivos `solo-mensajeria`, `kambak-envios`, `kambak-webhook`, `kambak-bandeja`).
   *Nota:* 5 tests de `whatsapp-booking-actions` fallan desde antes de este trabajo, no tienen relación.

## 6. Pendientes que SOLO puede hacer una persona (en este orden)

1. **Aplicar migraciones** en Supabase (SQL editor), en orden: `322_solo_mensajeria.sql`, `323_envios_api.sql`, `324_eventos_salida.sql`.
2. **Crear la cuenta Kambak** (SQL editor de Supabase, `sql/consultas/kambak_alta.sql`):
   a. Reemplazar `<<EMAIL_DUENO>>`, `<<TELEFONO_ESCALACION_569XXXXXXXX>>` y `<<EMAIL_STAFF_1>>`.
   b. Generar el secreto de firma en tu computador (`openssl rand -hex 32 | pbcopy`), pegarlo en lugar de `<<SECRETO_DE_FIRMA>>`
      y **quitar los `-- ` del insert de `ed_integraciones`** (paso 3 del archivo). Sin esa fila el portal responde 401 a Kambak.
      Ese mismo valor va después en Kambak como `RESPONDO_SIGNING_SECRET` (no lo pegues en chats ni en el repo).
   c. Ejecutar el archivo completo. Al final, las dos consultas de verificación deben mostrar la cuenta con `solo_mensajeria = true`
      y los usuarios. Copiar el `id` de la cuenta: es el `RESPONDO_CLIENT_ID` de Kambak.
   d. Otras personas para la bandeja: `portal_usuarios` no tiene pantalla, se insertan por SQL (email, cliente_id de Kambak, rol `dueno` o `staff`).
3. **Conectar el número de WhatsApp de Kambak** al portal (Embedded Signup de Meta, igual que otros clientes) y verificar que la cuenta
   quede con `transporte = 'cloud'`. Marcelo decide qué número es.
4. **Dar de alta las 6 plantillas** en Meta (sección 4) y esperar su aprobación. Revisar la categoría final que asigne Meta.
5. **Cargar variables en Vercel** (nunca por chat ni en el repo): generar cada secreto con `openssl rand -hex 32 | pbcopy` y pegarlo en
   Vercel: `KAMBAK_WEBHOOK_URL`, `KAMBAK_WEBHOOK_SECRET` (portal). En el Vercel de Kambak: `MESSAGING_PROVIDER=respondo`, `RESPONDO_API_URL`,
   `RESPONDO_CLIENT_ID`, `RESPONDO_SIGNING_SECRET` (el mismo valor que `ed_integraciones.secreto`) y `RESPONDO_WEBHOOK_SECRET` (igual a `KAMBAK_WEBHOOK_SECRET`).
6. **Redeploy** del portal y de Kambak para que tomen las variables, y confirmar que el cron externo sigue llamando a
   `/api/cron/seguimientos` (despacha la cola nocturna y los reintentos del webhook).
7. **Prueba final con un número propio** (el de Marcelo): un aviso real, mirar el estado en la base de Kambak, responder BAJA y
   confirmar que llega `contact.optout`.

## Riesgos conocidos

- Un secreto de firma vive legible en `ed_integraciones.secreto` (así funciona hoy todo `/api/externo/*`). Rotarlo = actualizar la fila y Kambak.
- Meta puede reclasificar `sello_premio_cerca` a marketing (más caro) o rechazar alguna plantilla; hay que revisar la aprobación.
- La cola nocturna y los reintentos dependen del cron externo (cron-job.org); si se detiene, los mensajes de noche esperan.
- Los eventos fallidos conservan su contenido (incluye el texto entrante) hasta reenviarse; no hay limpieza automática todavía.
