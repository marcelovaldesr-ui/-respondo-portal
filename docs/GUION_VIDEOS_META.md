# Guion de los 2 videos para el App Review de Meta

Datos que vas a usar:
- **Portal:** https://respondo-portal.vercel.app
- **Número de prueba (business):** +1 555 166-3440
- **WABA ID:** `2272215056649338`
- **Phone Number ID:** `1292907717228921`
- **Token:** tu token permanente del System User (el mismo de siempre). En los comandos aparece como `<TU_TOKEN>` — reemplázalo antes de correr.

---

## ✅ Reglas técnicas de grabación (si se saltan, Meta rechaza)
- **1080p o más.** Ventana del navegador grande y nítida.
- **Cursor visible** y grande (muévete con el mouse, no con teclado, para que se vea qué haces).
- **Sin cortes de edición** en los momentos clave (login, envío, respuesta).
- **La UI está en español** → agrega **subtítulos/anotaciones en inglés** en los momentos clave (con cualquier editor: CapCut, iMovie, Clipchamp). Ejemplos de captions más abajo.
- **Sin audio** (Meta no lo escucha).
- Graba solo la ventana necesaria (pantalla completa del navegador/terminal).
- Programas gratis: OBS Studio o Xbox Game Bar (Win+G) para grabar; CapCut/Clipchamp para subtítulos.

**Antes de grabar el Video 1**, confirma que el teléfono desde el que vas a escribir esté **agregado como destinatario** en Meta (API Setup → "Para"). El número de prueba solo puede responder a números en esa lista. Usa un teléfono **sin ningún bot conectado** (no el que corre WAHA).

---

## 🎬 VIDEO 1 — Permiso `whatsapp_business_messaging` (~2 min)
**Qué debe probar:** que la app envía y recibe mensajes de WhatsApp usando la Cloud API.

Pasos (grabando):
1. Abre https://respondo-portal.vercel.app **deslogueado**. Muestra el login completo: escribe el correo → "Enviar enlace" → abre el correo → clic al enlace → entras al portal.
   *(Caption EN: "Logging into the Respondo portal")*
2. En **Inicio**, muestra 2-3 segundos el panel (equipo, métricas).
   *(Caption EN: "Business dashboard — AI assistant activity")*
3. Ve a **Conversaciones**. Muestra la lista de conversaciones atendidas.
   *(Caption EN: "Conversations handled by our assistant over WhatsApp")*
4. En el **teléfono**, abre WhatsApp y escríbele al **+1 555 166-3440**:
   > Hola, ¿hacen tarjetas de presentación?
   *(Caption EN: "A customer sends a WhatsApp message to the business number")*
5. **Tino responde** automáticamente (esto usa `whatsapp_business_messaging` — la app enviando). Muestra la respuesta llegando en el WhatsApp del teléfono.
   *(Caption EN: "Our app replies using the WhatsApp Cloud API — whatsapp_business_messaging")*
6. Vuelve al portal, recarga **Conversaciones**: aparece la conversación nueva con el mensaje entrante y la respuesta. Ábrela para mostrar el hilo.
   *(Caption EN: "The full conversation appears in the portal")*

Fin. Con eso se ve: login → recibir mensaje → **la app enviando** por la API oficial → todo reflejado en el producto.

---

## 🎬 VIDEO 2 — Permiso `whatsapp_business_management` (~2 min)
**Qué debe probar:** que la app administra los activos de la cuenta de WhatsApp (números y plantillas).

Prepara un **terminal** (PowerShell) o el **Graph API Explorer** de Meta. Reemplaza `<TU_TOKEN>` en cada comando.

Pasos (grabando):
1. **Listar los números de la cuenta** (leer activos de la WABA):
   *(Caption EN: "Listing the business WhatsApp phone numbers — whatsapp_business_management")*
```bash
curl "https://graph.facebook.com/v21.0/2272215056649338/phone_numbers" -H "Authorization: Bearer <TU_TOKEN>"
```
2. **Listar las plantillas de mensaje** existentes:
   *(Caption EN: "Listing message templates")*
```bash
curl "https://graph.facebook.com/v21.0/2272215056649338/message_templates?limit=5" -H "Authorization: Bearer <TU_TOKEN>"
```
3. **Crear una plantilla nueva** (administrar la WABA — este es el corazón del permiso). Muestra la respuesta con `"status": "PENDING"`:
   *(Caption EN: "Creating a new message template — managing the WhatsApp Business Account")*
```bash
curl -X POST "https://graph.facebook.com/v21.0/2272215056649338/message_templates" -H "Authorization: Bearer <TU_TOKEN>" -H "Content-Type: application/json" -d "{\"name\":\"pedido_listo\",\"language\":\"es\",\"category\":\"UTILITY\",\"components\":[{\"type\":\"BODY\",\"text\":\"¡Hola {{1}}! Tu pedido en Impresora Color ya está listo para retiro en Arauco 1060, Chillán. ¡Te esperamos! 🎉\",\"example\":{\"body_text\":[[\"Rodrigo\"]]}}]}"
```
4. *(Opcional, refuerza)* Abre el **Administrador de WhatsApp** (WhatsApp Manager) → Plantillas, y muestra `pedido_listo` en estado "En revisión".
   *(Caption EN: "The new template appears in WhatsApp Manager, pending approval")*

Fin. Con eso se ve la app **leyendo y creando** activos de la WABA = `whatsapp_business_management`.

> **Nota:** el comando de crear plantilla ya lo probé y funciona (devuelve PENDING). Si necesitas grabar de nuevo, primero borra la plantilla para poder recrearla en cámara:
> ```bash
> curl -X DELETE "https://graph.facebook.com/v21.0/2272215056649338/message_templates?name=pedido_listo" -H "Authorization: Bearer <TU_TOKEN>"
> ```

---

## 📝 Para el formulario (después de subir los videos)

### Descripción de uso — whatsapp_business_messaging (pégala en el permiso)
> Respondo provides a customer-service and sales assistant that operates on businesses' WhatsApp numbers. We use whatsapp_business_messaging to receive customer messages sent to the business and to send replies on the business's behalf — answering questions, sharing prices, capturing lead details, and handing the conversation to a human when needed. Without this permission the assistant cannot receive or reply to WhatsApp messages, which is the core of the product. Data is used only to deliver the conversation and is shown to the business in its portal.

### Descripción de uso — whatsapp_business_management (pégala en el permiso)
> We use whatsapp_business_management to manage the business's WhatsApp Business Account: listing its phone numbers, subscribing our app to receive webhooks, and creating/reading message templates used for order and follow-up notifications. As a Tech Provider we also use it to onboard business clients and manage their assets on their behalf. Without it we cannot set up or maintain the messaging integration for each business.

### Cómo puede probar el revisor (campo "App Verification / cómo accedemos")
> The core messaging flow can be tested by sending a WhatsApp message to our test number +1 555 166-3440; the assistant replies automatically via the Cloud API. The business-facing portal (respondo-portal.vercel.app) is where the business views its conversations; a test login can be provided on request. Management calls can be reproduced with the WhatsApp Business Account ID 2272215056649338 using the Graph API.

### Gestión de datos (respuestas guía)
- **Dónde se guardan:** base de datos administrada (Supabase/AWS), cifrado en tránsito (TLS) y en reposo, aislada por cliente.
- **Con quién se comparten:** solo procesadores necesarios para operar (nube, base de datos, proveedor de IA), bajo contrato. Nunca venta.
- **¿Publicidad / entrenamiento?** No.
- **Eliminación:** a pedido del usuario o del negocio (respon-do.com/eliminacion-datos), máx. 30 días.
- **Quién accede:** el negocio dueño de la conversación y soporte autorizado de Respondo.

### Antes de dar "Enviar"
- Pedir acceso avanzado a los 2 permisos (los botones se habilitan 1-2 días tras las llamadas API del 24-jul).
- Revisar que NO estés pidiendo `public_profile` u otros permisos que el video no muestra (pedir de más = rechazo).
- Confirmar ícono / URL privacidad / categoría.
- **NO** pasar la app a "Live" hasta que aprueben.
