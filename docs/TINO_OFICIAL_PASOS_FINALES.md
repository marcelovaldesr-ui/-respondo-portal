# Tino oficial (número de prueba Meta) — pasos finales

Estado actual:
- ✅ App de Meta creada ("Respon.do"), caso de uso WhatsApp.
- ✅ Empresa **Impresora Color Limitada** verificada por Meta.
- ✅ Variables en Vercel + redeploy hecho.
- ✅ Webhook del portal probado y respondiendo (Meta lo validará OK).

- ✅ **Webhook configurado en Meta** (check verde — URL + verify token guardados).

Falta: **token permanente** (el temporal ya se venció) + **destinatario** + **probar**.

## Paso 0 (IMPORTANTE) — Token permanente de Usuario del sistema
El token temporal de "Generar identificador" **dura solo unas horas** y ya se venció.
Para que Tino funcione sin renovar, genera un token permanente:

1. **business.facebook.com** → tu Business Manager → **Configuración del negocio**.
2. **Usuarios → Usuarios del sistema** → **Agregar** → nombre: `Respondo API` → rol **Administrador**.
3. Con ese usuario creado, **"Asignar activos"** → asigna la **app (Respon.do)** y la **cuenta de WhatsApp (WABA)** con **control total**.
4. **"Generar nuevo token"** → elige la app **Respon.do** → marca los permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   → **Generar.** Ese token **NO expira**.
5. Cópialo → Vercel → `WHATSAPP_TOKEN` (reemplaza el viejo) → **Redeploy**.

Con eso el token deja de ser un problema para siempre.

## Datos que vas a usar
- **Callback URL:** `https://respondo-portal.vercel.app/api/whatsapp/webhook`
- **Verify token:** `respondo-tino-verify-2026`
- **Número de prueba (Tino):** +1 555 166-3440
- **Phone Number ID:** 1292907717228921

## Paso 1 — Configurar el Webhook en Meta
1. En **developers.facebook.com** → tu app **Respon.do**.
2. Menú izquierdo: **WhatsApp → Configuración** (Configuration). *(En el flujo nuevo por casos de uso, también puede estar en "Paso 2. Configuración de producción" → sección Webhook.)*
3. En la sección **Webhook**, clic en **Editar**:
   - **URL de devolución de llamada (Callback URL):** pega `https://respondo-portal.vercel.app/api/whatsapp/webhook`
   - **Verificar token:** pega `respondo-tino-verify-2026`
   - **Verificar y guardar.** (Meta hace un chequeo; como el portal ya responde, pasa OK.)
4. En **"Campos del webhook" / "Administrar"**, **suscríbete al campo `messages`** (activa la casilla). Ese es el que hace que lleguen los mensajes entrantes.

## Paso 2 — Agregar tu número de prueba (destinatario)
En **Paso 1. Probar** (o "API Setup"), en la sección **"Para"/Destinatario**, agrega un número de WhatsApp **que tú puedas usar** (para hacer de "cliente"). Sigue el código de verificación que te manda Meta.

## Paso 3 — Probar
Desde ese teléfono, escríbele al número de prueba **+1 555 166-3440** un mensaje como:
- "Hola, ¿hacen tarjetas de presentación?"

→ **Tino te responde por la API oficial.** (Sin Evolution, sin caídas.)

Verás la conversación también en el portal (Conversaciones), y podrás **tomar el control** para responder tú.

## Notas
- El **token dura 24h**. Cuando se venza, en Meta ("Generar identificador") sacas uno nuevo y lo actualizas en Vercel (`WHATSAPP_TOKEN`) + Redeploy. Para producción luego generamos un **token permanente** (System User) para no renovar.
- Si algo del webhook no valida, avísame: reviso el portal y lo destrabamos.

## Lo que sigue después (no ahora)
- Token permanente (System User).
- Conectar el **número real de Cecilia con Coexistencia** (producción) → mantiene su app + llamadas.
- **Embedded Signup** en el portal para onboardear clientes (fase Respondo plataforma).
