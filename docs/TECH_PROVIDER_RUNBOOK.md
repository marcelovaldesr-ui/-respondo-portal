# Respondo como Tech Provider de Meta — Runbook (23-jul-2026)

Página oficial del proceso: app **Respon.do** → Casos de uso → Personalizar →
**Hazte socio → Hacerte proveedor de tecnología**
(developers.facebook.com/apps/1754035789373592/use_cases/customize/onboard-v2/)

Estado que muestra Meta: **"1 de 2 pasos completados"**.

## Paso 1 — Verificación de la empresa ✅ HECHO
Impresora Color Limitada verificada por Meta (22-jul-2026).

## Paso 2 — Revisión de la aplicación (lo único que falta)
La revisión otorga acceso avanzado a `whatsapp_business_messaging` (enviar
mensajes a clientes) y `whatsapp_business_management` (incorporar clientes y
administrar sus activos) = **convertirse en proveedor de tecnología**.

El borrador del envío YA tiene los 3 permisos correctos en cola
(whatsapp_business_messaging, public_profile, whatsapp_business_management).
Estaba **"Sin enviar"** — nunca se envió.

### 2a. Configuración básica de la app (bloqueo actual)
Meta exige 3 campos antes de poder enviar: **ícono 1024×1024, URL de política
de privacidad y categoría.**

Ya preparado por Claude:
- Ícono listo: `C:\Users\marce\web-respondo\brand\respondo_app_icon_1024.png`
- Páginas legales creadas en la web Astro (falta deploy):
  - `/privacidad` → https://www.respon-do.com/privacidad/
  - `/terminos` → https://www.respon-do.com/terminos/
  - `/eliminacion-datos` → https://www.respon-do.com/eliminacion-datos/
- En el formulario de Meta (Configuración → Información básica) quedaron
  escritas las URLs + categoría "Empresa y páginas", pero **el guardado no
  persistió** (Meta valida que la URL de privacidad exista → hoy da 404).

ORDEN CORRECTO (manual Marcelo, ~10 min):
1. `git push` de respondo-astro (deploya las 3 páginas legales en Vercel).
2. Verificar que https://www.respon-do.com/privacidad/ carga.
3. En Meta → Configuración de la aplicación → Información básica:
   re-pegar las 3 URLs, elegir categoría "Empresa y páginas", subir el ícono
   (`respondo_app_icon_1024.png`) y **Guardar cambios**.

### 2b. Videos de evidencia (los pide Meta para aprobar)
- **Video 1 (messaging):** se ve cómo se envía un mensaje desde nuestra
  aplicación (portal/API) a un número de WhatsApp, Y se ve WhatsApp Web donde
  se recibe. → Grabar pantalla: inbox del portal enviando + WhatsApp Web
  recibiendo.
- **Video 2 (management):** llamadas de prueba a la API + proceso de creación
  de una plantilla de mensaje. → Claude prepara los curl y el flujo; Marcelo
  graba.

### 2c. Enviar la revisión
App → Revisión → Revisión de la aplicación → completar los 4 bloques
(Verificación ✅ / Configuración de la app / Uso permitido / Gestión de datos)
→ "Enviar a revisión". Los bloques "Uso permitido" y "Gestión de datos" son
formularios/certificaciones que se llenan ahí mismo.

## Extra descubierto: "Registro insertado alojado por Meta"
En la misma página hay un botón **"Generar enlace"**: Meta hostea la página de
Embedded Signup y nosotros solo mandamos el link al cliente. Sirve para
onboardear clientes SIN construir el frontend propio (nuestro botón
`components/ConectarWhatsApp.tsx` ya está construido igual, para cuando
tengamos config_id).

## Código ya listo en el portal (nada pendiente de Claude)
- Webhook oficial endurecido: `lib/inboundMeta.ts` + ruta delgada
  (idempotencia ante reintentos de Meta, ACKs/statuses, ecos de Coexistencia →
  toma de control humana, debounce, anti-carrera). Tests M1-M7 ✅.
- `enviarTexto` devuelve wamid (eco/ACK tracking).
- Embedded Signup: backend `app/api/whatsapp/onboarding/route.ts` + frontend
  `components/ConectarWhatsApp.tsx` + página `/whatsapp` en el portal.
  Env que faltan en Vercel: `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`,
  `NEXT_PUBLIC_WHATSAPP_APP_ID`, `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`.
  El config_id se crea en: Casos de uso → Hazte socio → **Creador de registro
  insertado** (con Coexistencia activada).

## Pendiente de configurar en Meta (2 min, tras el push)
- WhatsApp → Configuración → Webhook → campos: además de `messages`,
  suscribir **`smb_message_echoes`** (necesario para Coexistencia: detecta
  cuando Cecilia escribe desde su app → Tino se calla). Opcional:
  `smb_app_state_sync`, `account_update`.

## AUDITORÍA PRE-ENVÍO (24-jul-2026) — hallazgos y correcciones

### Corregido por Claude (ya en el código, entra con el push)
1. **[CRÍTICO] Redirect a /en/ escondía las páginas legales.** El Layout
   redirige navegadores en inglés a /en/ — y los revisores de Meta usan
   navegador en inglés: al abrir /privacidad los mandaba al home EN =
   "política no encontrada" = rechazo. FIX: las rutas legales ya NO redirigen.
2. **Política de privacidad reforzada** con lenguaje explícito de "Datos de la
   Plataforma de Meta" (qué datos recibimos por la Cloud API, uso exclusivo
   para el servicio, no venta, eliminación a pedido, links a Meta Platform
   Terms y WhatsApp Business Policy). El rechazo más común es "política
   genérica que no menciona los datos de la API".
3. **Footer con links legales** (privacidad/términos/eliminación): los
   revisores verifican que la política sea accesible desde el sitio.

### Llamadas API por permiso (requisito "1 llamada exitosa / 30 días") — 24-jul ✅
- `whatsapp_business_messaging`: envío de Tino al número de prueba (ya hecho, repetible).
- `whatsapp_business_management`: GET `/2272215056649338/message_templates` y
  GET `/2272215056649338/phone_numbers` → ambas 200 con el token permanente.
  → El botón "Request advanced access" debería habilitarse en 1-2 días.
  Dato confirmado en la respuesta: número prueba +1 555-166-3440
  (id 1292907717228921), quality GREEN, webhook apuntando al portal ✅.

### Verificado OK
- www.respon-do.com responde 200 (apex redirige a www) → las URLs cargadas en
  Meta son correctas.
- Migraciones 210/212/213 aplicadas (waba_*, wa_message_id, estado_envio).
- Switch de transporte por cliente coherente: `configPorCliente` solo devuelve
  Cloud si hay waba_phone_id + waba_token reales; mientras tanto el envío
  humano sale por WAHA. El mismo campo hace el switch completo.
- Webhook oficial: idempotencia/ACKs/ecos/debounce con tests M1-M7 en verde.

### Riesgos a tener presentes (no son bugs)
- **Conflicto de mapeo al pasar a producción oficial:** ed_clientes.waba_phone_id
  hoy vale "impresora-color" (mapeo WAHA). Cuando se conecte el número real por
  Embedded Signup, ese campo se sobreescribe → WAHA deja de resolver el cliente
  (Tino calla en WAHA). Es el switch esperado, pero: APAGAR WAHA al migrar, no
  correr ambos con el mismo número.
- La app está "Sin publicar" (modo dev): se puede ENVIAR la revisión así;
  tras la aprobación hay que pasarla a activa (Publicar).
- Al crear la config de Embedded Signup: agregar respondo-portal.vercel.app y
  www.respon-do.com en "Dominios permitidos para el SDK de JavaScript".

### Guion de los 2 videos (criterios reales de revisión)
Reglas comunes: alta resolución, cursor visible, sin saltos de edición en los
momentos clave, UI en inglés o con subtítulos en inglés, y que el video
muestre EXACTAMENTE lo que el caso de uso declara. Antes de grabar, abrir
"Mostrar instrucciones" de cada permiso en la página de Tech Provider y seguir
esa pauta al pie de la letra.

**Video 1 — whatsapp_business_messaging (~2 min):**
1. Abrir el portal (respondo-portal.vercel.app), mostrar el login completo
   (desde deslogueado) y entrar.
2. Ir a Conversaciones, escribir un mensaje a un número de prueba y enviarlo.
3. En pantalla dividida (o misma grabación), mostrar WhatsApp Web del número
   receptor recibiendo el mensaje al instante.
4. Responder desde WhatsApp y mostrar que la respuesta llega al portal (y que
   Tino contesta automático — refuerza el caso de uso de mensajería).

**Video 2 — whatsapp_business_management (~2 min):**
1. Mostrar una llamada de prueba a la Graph API (curl o Postman) con el token:
   GET /{waba_id}/phone_numbers → se ve la respuesta JSON.
2. Crear una plantilla: POST /{waba_id}/message_templates (Claude deja los
   comandos listos) o crearla en el WhatsApp Manager, mostrando el proceso
   completo hasta que queda "En revisión/Aprobada".

### Respuestas sugeridas para "Gestión de datos" (cuestionario)
- ¿Dónde se almacenan los datos? Base de datos administrada (Supabase/AWS),
  cifrado en tránsito (TLS) y en reposo, acceso restringido por cliente (RLS).
- ¿Se comparten con terceros? Solo procesadores necesarios para prestar el
  servicio (nube, base de datos, proveedor de IA), bajo contrato. Nunca venta.
- ¿Se usan para publicidad o entrenamiento? No.
- ¿Eliminación? A pedido del usuario o del negocio (respon-do.com/eliminacion-datos),
  máx. 30 días; también al terminar el contrato.
- ¿Quién accede? El negocio dueño de la conversación y personal autorizado de
  soporte. Nunca otros clientes.

## Después de la aprobación
1. Conectar número real de Cecilia con Coexistencia (QR desde su app).
2. Onboardear clientes externos vía Embedded Signup (botón del portal o
   enlace alojado por Meta).
3. Facturar mensajería con margen (inbound/servicio gratis hasta oct-2026).
