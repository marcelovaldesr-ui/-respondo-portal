# Instagram Direct — del código al envío a revisión

**Actualizado el 17-ago-2026.** Reemplaza la versión del 3-ago, que asumía pegar el
token a mano por SQL.

---

## Qué está hecho (no tienes que tocarlo)

- **Login de Instagram completo.** `/api/instagram/conectar` y `/api/instagram/callback`:
  el dueño aprieta un botón, entra con su Instagram y queda conectado. Antes esto no
  existía y el token se pegaba con un UPDATE.
- **La suscripción a webhooks que faltaba.** `subscribed_apps` se llama al conectar. Sin
  eso todo dice "conectado" y no llega ni un mensaje — sin error, sin síntoma.
- **Token cifrado** (migración 281), igual que el de WhatsApp.
- **Renovación automática** a los 45 días, colgada del cron que ya existe.
- **Bloque de Instagram en el portal**, dentro de la página de WhatsApp.
- 12 tests del cifrado y de la firma del estado. Typecheck limpio.

## Lo que tienes que hacer tú

### 1 · Crear la app en Meta

En [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Crear app**.

- Caso de uso: **Otro** → tipo **Empresa**
- Portafolio: el de **Respondo** (el mismo que ya está verificado como Tech Provider —
  la verificación de negocio se hereda y no hay que repetirla)
- Nombre sugerido: `Respondo Instagram`

**App APARTE de la de WhatsApp, a propósito.** La revisión es por app: si Instagram sale
rechazado, WhatsApp —que es lo que da ingresos hoy— no se toca.

Agrega el producto **Instagram** → **API setup with Instagram login**.

### 2 · Las credenciales (acá se equivoca todo el mundo)

En ese mismo panel de Instagram busca **Instagram app ID** e **Instagram app secret**.

> ⚠️ **NO son el App ID ni el App Secret de Facebook** que aparecen en Configuración →
> Básica. Son otros, viven dentro del producto Instagram. Si usas los de Facebook, el
> login falla con un error que no explica nada.

### 3 · Variables en Vercel

En el proyecto del portal → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `IG_APP_ID` | el *Instagram app ID* del paso 2 |
| `IG_APP_SECRET` | el *Instagram app secret* del paso 2 |
| `IG_VERIFY_TOKEN` | invéntalo, cualquier texto largo; se usa una sola vez en el paso 5 |

Vuelve a desplegar después de agregarlas.

### 4 · URI de redirección

En el panel de Instagram → **Business login settings** → *Valid OAuth Redirect URIs*:

```
https://respondo-portal.vercel.app/api/instagram/callback
```

Tiene que ser **idéntica**, con la barra final tal cual (o sea, sin barra final).

> Esa pantalla además te muestra la **URL de autorización completa** que arma Meta.
> Compárala con la que genera el código. Si difieren, manda la del panel y avísame.

### 5 · Webhook

En el panel de Instagram → **Webhooks** → *Configurar*:

| Campo | Valor |
|---|---|
| Callback URL | `https://respondo-portal.vercel.app/api/instagram/webhook` |
| Verify token | el mismo `IG_VERIFY_TOKEN` del paso 3 |

Suscríbete a **`messages`** y **`messaging_postbacks`**. Nada más.

### 6 · Migración

Pega `sql/281_instagram_token_cifrado.sql` en el SQL Editor de Supabase. Es segura: hoy
no hay ninguna cuenta conectada, así que no hay nada que preservar.

### 7 · Conectar tu cuenta de prueba

La cuenta tiene que ser **profesional** (Empresa o Creador). Una personal no recibe
mensajes por API.

Entra al portal → **WhatsApp** → abajo verás el bloque de Instagram → **Conectar
Instagram**. Debería quedar "Cuenta conectada · @loquesea".

### 8 · Probar de verdad

Desde OTRO teléfono, manda un DM a la cuenta. Tiene que aparecer en la bandeja del
portal y el asistente tiene que responder.

**Si dice "conectado" y no llega nada**, es la suscripción del webhook. Revisa el paso 5.

### 9 · Enviar a revisión

Permisos a pedir, solo estos dos: **`instagram_business_basic`** e
**`instagram_business_manage_messages`**.

Los textos están abajo, listos para copiar.

---

## Textos para la solicitud

### Descripción del caso de uso

> Respondo is a customer-service assistant used by small and medium businesses in Chile.
> Each business connects its own professional Instagram account so that direct messages
> from its customers are answered promptly.
>
> When a customer sends a direct message to the business, our app receives it through the
> `messages` webhook, shows it in the business's shared inbox, and generates a reply on
> behalf of the business using the information the business itself configured (services,
> prices, opening hours, booking availability). A member of the business staff can take
> over the conversation at any moment from the same inbox and reply personally.
>
> We use Instagram messaging exclusively for one-to-one conversations that the customer
> starts. We do not send bulk, promotional or unsolicited messages, and we never message
> a person who has not written to the business first.

### Justificación de `instagram_business_basic`

> Required to identify the Instagram professional account that the business owner is
> connecting, and to display it back to them in our portal so they can confirm they
> linked the correct account.
>
> We use it to obtain the account's ID and username. The ID is what lets us route each
> incoming message to the right business: our platform serves many businesses, and the
> account ID is how we know which one an incoming direct message belongs to. The username
> is shown in the portal as "Connected as @account" so the owner can verify the
> connection at a glance.
>
> We do not request or use any other profile information.

### Justificación de `instagram_business_manage_messages`

> This is the core of our product: receiving and replying to the direct messages that
> customers send to the business.
>
> Specifically we use it to (1) receive incoming direct messages through the `messages`
> webhook, (2) display those conversations in the business's inbox inside our portal, and
> (3) send replies back to the customer, either generated by the assistant the business
> configured or typed by a staff member who takes over the conversation.
>
> All messaging is one-to-one and always initiated by the customer. We reply within the
> 24-hour window and we do not use this permission for broadcasts, marketing or
> re-engagement — Instagram does not offer message templates to reopen a closed window,
> and our follow-up features are explicitly disabled for this channel.

### Instrucciones de prueba para el revisor

> Test credentials are provided in the App Review form.
>
> 1. Go to https://respondo-portal.vercel.app and sign in with the test account we
>    provided. The portal sends a sign-in link by email; the mailbox credentials are
>    included as well.
> 2. In the left menu open **WhatsApp**. Scroll to the **Instagram** section at the
>    bottom of that page.
> 3. Click **Conectar Instagram** ("Connect Instagram"). You will be redirected to
>    Instagram Login. Authorize the test professional account.
> 4. You will return to the portal and the section will show **Cuenta conectada**
>    ("Account connected") with the account's username.
> 5. From any other Instagram account, send a direct message to the connected test
>    account — for example: "Hola, ¿tienen hora disponible mañana?"
>    ("Hi, do you have an appointment available tomorrow?").
> 6. In the left menu open **Conversaciones** ("Conversations"). The incoming message
>    appears there within a few seconds, and the assistant's reply is sent back to the
>    customer automatically.
> 7. To see a human taking over: in that same conversation, use the reply box at the
>    bottom to type a message and send it. It is delivered to the customer on Instagram,
>    and the assistant stops replying automatically in that conversation.
>
> The portal is in Spanish, as our customers are Chilean businesses.

---

## Guion del video

Sin cortes, sin edición, pantalla completa. Entre 2 y 3 minutos. Meta rechaza cuando el
video no permite reproducir el flujo, así que se graba **el flujo entero de una sola vez**.

| Tiempo | Qué se ve |
|---|---|
| 0:00 | El portal de Respondo, ya con sesión iniciada. Se ve el menú. |
| 0:10 | Entrar a **WhatsApp** y bajar hasta el bloque de **Instagram**, sin conectar. |
| 0:20 | Apretar **Conectar Instagram**. |
| 0:25 | La pantalla de **login de Instagram**. Escribir usuario y contraseña de la cuenta de prueba. |
| 0:40 | **La pantalla de permisos**, mostrando los dos que se piden. Detenerse 3 segundos ahí. Apretar Permitir. |
| 0:50 | La vuelta al portal con **"Cuenta conectada · @…"**. |
| 1:00 | Cambiar al **teléfono** (o a otra ventana con otra cuenta de Instagram). |
| 1:10 | Mandar un DM a la cuenta del negocio: *"Hola, ¿tienen hora disponible mañana?"* |
| 1:20 | Volver al portal, entrar a **Conversaciones**. Se ve el mensaje entrante. |
| 1:35 | Se ve **la respuesta del asistente**, y se ve llegar al teléfono. |
| 1:50 | En el portal, escribir una respuesta **a mano** desde la caja de abajo y enviarla. |
| 2:05 | En el teléfono llega ese mensaje escrito por la persona. |
| 2:15 | Fin. |

**El tramo de 1:50 a 2:05 es el que más pesa.** Demuestra que hay un negocio real
atendiendo a un cliente real, no un bot suelto mandando mensajes. Es exactamente lo que
`manage_messages` está pensado para permitir, y lo que separa una aprobación de un
rechazo por "no se lee como atención al cliente".

Sin narración: los rótulos no hacen falta si el flujo se entiende solo, pero si grabas
con el portal en español, agrega subtítulos cortos en inglés en los tres momentos clave
(conectar, mensaje entrante, respuesta humana).

---

## Lo que puede hundir la solicitud

1. **El revisor no puede reproducirlo.** El video no reemplaza las credenciales de
   prueba: tiene que poder entrar él. Si el acceso al portal falla, es rechazo directo.
2. **El caso de uso no se lee como atención al cliente.** `manage_messages` es
   estrictamente conversación negocio↔cliente. Cualquier cosa que suene a difusión o
   marketing masivo es rechazo.
3. **El webhook no responde** en el momento en que lo prueban. La app tiene que estar en
   **modo Live**.
4. **Pedir permisos de más.** No pidas los de comentarios ni publicación "por si acaso":
   alarga la revisión y da motivos para rechazar.

---

## Límites del canal que conviene tener claros antes de vender

- **La ventana de 24 h no tiene plantillas.** En WhatsApp una conversación cerrada se
  reabre con una plantilla; en Instagram no existe esa figura. Pasadas 24 horas desde el
  último mensaje de la persona, no se le puede escribir y punto. **El seguimiento
  automático de Beto no opera en este canal** y el portal ya se lo advierte al dueño.
- **La misma persona aparece dos veces** si escribe por WhatsApp y por Instagram. El
  identificador de Instagram no es un teléfono y no hay forma honesta de cruzarlos.
- **Los 25 usuarios de prueba no son clientes.** Son cuentas con rol en la app. Sirven
  para que José y Tomás prueben mientras esperamos, no para vender antes de la
  aprobación.
