# Recording Pack — Meta App Review, RONDA 1 (4 permisos)
App **Respondo Ads** (`1771222117337476`) · actualizado 06-oct-2026 · **PREPARADO, NO ENVIADO**
La app ya está **publicada (modo En vivo)** y las URLs de privacidad, eliminación de datos y condiciones están cargadas en la consola.

Permisos de esta ronda: `business_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`.
`ads_management` queda **DIFERIDO** (ver `META_ADS_MANAGEMENT_BACKLOG` al final).

## Reglas para todos los videos
- Navegador: **Chrome** (el que usas hoy), ventana normal, zoom 100 %, 1080p. Grabación de pantalla completa del navegador; que se vea la barra de direcciones.
- Sesión del portal: **Respondo Demo**. Graba con tu sesión ya iniciada (marcelo.valdes.r@mail.pucv.cl); el inicio de sesión con enlace por correo **no se graba** (mostraría el Gmail). El revisor usará `revision.metarespondo@gmail.com`, ya activo y probado.
- Sesión de Facebook: tu cuenta personal (Marcelo), la que administra el portafolio **Cecilia Roa**.
- Idioma de la interfaz: español. En cada video, agrega un **rótulo en inglés** (texto sobre el video o narración) con la frase indicada en "PERMISO DEMOSTRADO".
- **Nunca mostrar:** tokens, `.env`, Supabase, Vercel, consola del navegador, Graph API Explorer, facturación o métodos de pago, otras pestañas, Gmail, conversaciones de clientes.
- **No hacer clic en "Confirmar" dentro del modal de publicación** (ese paso es `ads_management`, que no va en esta ronda). Esa regla vale incluso ahora que la publicación en pausa funciona: en estos videos solo se **cancela**.
- Antes de grabar: una sola vez, comprueba que en Facebook estás con tu cuenta personal que administra el portafolio **Cecilia Roa** y que Respondo Demo aparece como único negocio al entrar al portal.
- Datos: la cuenta publicitaria "Cecilia Roa" **nunca ha pautado**. Todas las cifras son **cero reales**. No se inventa nada y no se edita el video para cambiar números.

---

## VIDEO 1 — `business_management` (≈ 70–90 s)
- **START URL:** https://respondo-portal.vercel.app/marketing/integraciones
- **LOGIN:** portal como Respondo Demo; Facebook ya iniciado en Opera.
- **ESTADO INICIAL:** la tarjeta **Meta Ads** está conectada. Antes de grabar: clic en **Desconectar** en esa tarjeta, para que el video parta desde cero.
- **CLICK 1:** en la tarjeta **Meta Ads**, clic en **Conectar** → se abre "Inicio de sesión con Facebook para empresas".
- **CLICK 2:** en **Porfolio empresarial** deja **Cecilia Roa**. No abras el selector de Página. Clic en **Siguiente**.
- **CLICK 3:** en "Revisa lo que se compartirá con Respondo Ads", **pausa 3 segundos** sobre la lista de permisos → **Confirmar** → **Finalizar**. No toques "Añadir método de pago".
- **WHAT TO SHOW:** de vuelta en Integraciones: aviso "Cuenta publicitaria conectada". Zoom a la tarjeta Meta Ads: **Cuenta: Cecilia Roa · Portafolio: Cecilia Roa · Factura en CLP · Zona horaria America/Santiago**.
- **PERMISO DEMOSTRADO (rótulo EN):** "Respondo reads which Business Portfolio owns the ad account the business shared (business_management) and stores it per client."
- **WHAT NOT TO SHOW:** el desplegable de Página (sale en gris con un aviso de Meta), la URL completa del diálogo, "Añadir método de pago".
- **END STATE:** Integraciones con Meta Ads **conectado** y la fila **Portafolio** visible.

## VIDEO 2 — `ads_read` (≈ 60–75 s)
- **START URL:** https://respondo-portal.vercel.app/marketing/integraciones (continúa del video 1)
- **LOGIN:** igual.
- **CLICK 1:** recarga la página (F5). Zoom a la fila **"Última lectura: 0 anuncios · 30 días"**.
- **CLICK 2:** menú izquierdo **Analizar → Campañas**. Muestra las tarjetas de arriba (**Campañas activas 0**, **Invertido $0**) y el mensaje "Todavía no hay campañas".
- **CLICK 3:** vuelve a **Integraciones** y abre **"Ver detalles"** de la tarjeta Meta Ads.
- **WHAT TO SHOW:** que Respondo **consultó la API** (la fila "Última lectura" tiene un valor, no "—") y que muestra el estado real: cero campañas y cero gasto, porque la cuenta nunca ha pautado.
- **PERMISO DEMOSTRADO (rótulo EN):** "Each time the page loads, Respondo reads the connected ad account's campaigns and insights (ads_read). This account has never run ads, so the real values are zero."
- **WHAT NOT TO SHOW:** Ads Manager con facturación; ningún número que no venga de la pantalla.
- **END STATE:** Integraciones con la fila "Última lectura" visible.

## VIDEO 3 — `pages_show_list` (≈ 40–50 s)
- **START URL:** https://respondo-portal.vercel.app/marketing/integraciones
- **CLICK 1:** zoom a la fila **"Página: Impresora color"** de la tarjeta Meta Ads.
- **CLICK 2:** abre una pestaña nueva con https://www.facebook.com/1439127932606268 y muestra que es la misma Página ("Impresora color").
- **CLICK 3:** vuelve a la pestaña del portal.
- **PERMISO DEMOSTRADO (rótulo EN):** "Respondo lists the Pages the person manages (pages_show_list) to link the business's own Page to its workspace."
- **WHAT NOT TO SHOW:** otras pestañas de Facebook, el feed personal.
- **END STATE:** portal en Integraciones.

## VIDEO 4 — `pages_read_engagement` (≈ 75–90 s)
- **START URL:** https://respondo-portal.vercel.app/marketing/campanas/nueva ("Armar a mano")
- **CLICK 1:** completa el asistente **sin IA**, escribiendo tú:
  - Objetivo: **Conseguir conversaciones**.
  - Oferta: "Demo de Respondo".
  - Audiencia: Chile, 25–55.
  - Presupuesto diario: **3000**.
  - Creatividades: salta este paso.
  - Copy: Titular "Conoce Respondo" · Texto "Asistentes con IA para tu pyme".
  - Destino: ahora el paso 7 te deja elegir **WhatsApp** o **Sitio web**; deja **WhatsApp** (en Revisión debe decir "WhatsApp").
- **CLICK 2:** paso **8 · Revisión** → **Publicar en Meta Ads**.
- **CLICK 3:** en el modal, **no confirmes**. Muestra el bloque **"Se publicará como"** con la **foto de perfil y el nombre "Impresora color"** y el ID de la Página. Luego clic en **Cancelar**.
- **WHAT TO SHOW:** que antes de crear cualquier cosa, el dueño ve con qué identidad (Página) saldría su anuncio.
- **PERMISO DEMOSTRADO (rótulo EN):** "Before anything is published, Respondo reads the linked Page's name and profile picture (pages_read_engagement) to show the owner which Page the ad will run under."
- **WHAT NOT TO SHOW:** el botón **Confirmar** apretado; el paso de creatividades con IA; la pantalla de otros negocios (Respondo o Impresora Color) si abres el menú de negocios.
- **END STATE:** modal cerrado con Cancelar; el borrador queda guardado como borrador.

---

## Después de grabar
- **Deja Respondo Demo conectado a Meta** durante la revisión. Así el revisor ve el producto funcionando aunque su cuenta de prueba no tenga una cuenta publicitaria. Por el portal solo puede leer cifras en cero y ver el nombre público de la Página: no tiene acceso de administrador al negocio en Meta.
- Cuando Meta responda, clic en **Desconectar** en Respondo Demo y desactiva al usuario revisor.
- Después de grabar y **antes de enviar**: desactivar `marcelo.valdes.r@mail.pucv.cl` de Respondo Demo (lo hace Claude con un script). Si grabas de nuevo, hay que reactivarlo.

## Lista de comprobación antes de apretar "grabar"
1. Chrome en zoom 100 %, sin pestañas ajenas visibles, notificaciones del sistema silenciadas.
2. Portal abierto en **Respondo Demo** (no en Respondo ni en Impresora Color).
3. Facebook iniciado con tu cuenta personal.
4. Video 1: Meta Ads **desconectado** antes de empezar. Video 2 y 3 continúan con la conexión del video 1. Video 4: borrador nuevo.
5. Al terminar cada video, revisa que no se vea ningún token, Gmail ni método de pago.
