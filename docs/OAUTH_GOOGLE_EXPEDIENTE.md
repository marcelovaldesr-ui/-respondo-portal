# Expediente OAuth de Google — todo listo para que lo envíes

**Para:** Marcelo · **Fecha:** 31-jul-2026 · **Objetivo:** dejar enviada la verificación de la app de Google para que Respondo pueda conectar Google Calendar con el botón "Conectar mi Google" a nombre del cliente.

> **Antes de empezar, lo importante: esto NO bloquea el lanzamiento del 10 de agosto.**
> La agenda propia, los empleados agendando por WhatsApp, la página pública de
> reservas y los recordatorios ya funcionan sin Google. Y para ver las horas en
> Google Calendar hay dos vías que YA están construidas y no necesitan
> verificación (ver `AGENDA_F5_CALENDARIOS.md`). La verificación OAuth es solo
> para la versión más pulida del futuro.

---

## Parte A — Lo que puedes hacer mañana (60–90 min, sin esperas)

### A1. Crear el proyecto en Google Cloud (10 min)

1. Entra a <https://console.cloud.google.com/> con la **cuenta de correo de la empresa** (no una personal: esa cuenta queda como dueña del proyecto para siempre).
2. Arriba a la izquierda, selector de proyecto → **Proyecto nuevo**.
   - Nombre: `Respondo`
   - Crear.
3. Buscador de arriba → "Google Calendar API" → **Habilitar**.

### A2. Configurar la marca de la pantalla de consentimiento (15 min)

En el menú → **APIs y servicios** → **Pantalla de consentimiento de OAuth** (en las consolas nuevas aparece como *Google Auth Platform → Branding*).

| Campo | Qué poner |
|---|---|
| Tipo de usuario | **Externo** |
| Nombre de la aplicación | `Respondo` |
| Correo de asistencia | `hirespondo@gmail.com` |
| **Logo** | **DÉJALO VACÍO por ahora** ⚠️ |
| Página principal | `https://www.respon-do.com` |
| Política de privacidad | `https://www.respon-do.com/privacidad/` |
| Condiciones del servicio | `https://www.respon-do.com/terminos/` |
| Dominios autorizados | `respon-do.com` |
| Datos de contacto del desarrollador | `hirespondo@gmail.com` |

> ⚠️ **Por qué sin logo:** subir un logo activa una revisión de marca adicional
> (verifican que el logo sea tuyo), que suma días sin aportar nada a la
> aprobación del scope. Se puede agregar después, cuando ya esté aprobado.

### A3. Verificar el dominio en Search Console (15 min, es el paso con más fricción)

Google exige que demuestres que `respon-do.com` es tuyo.

1. Entra a <https://search.google.com/search-console> **con la misma cuenta** del paso A1.
2. Agregar propiedad → **Dominio** → escribe `respon-do.com`.
3. Google te dará un registro **TXT**. Hay que agregarlo en el DNS del dominio:
   - Si el DNS lo maneja **Vercel**: panel de Vercel → tu dominio → *DNS* → *Add Record* → Tipo `TXT`, Name `@`, Value = lo que te dio Google.
   - Si el DNS está en el **registrador** donde compraste el dominio (NIC Chile u otro): entra ahí y agrega el mismo TXT.
4. Vuelve a Search Console → **Verificar**. Suele tomar entre 5 minutos y 1 hora en propagar; si falla, espera y reintenta.

> Si el dominio ya estaba verificado en Search Console con otra cuenta, basta con
> agregar esta cuenta como propietario, no hay que rehacer el TXT.

### A4. Publicar la política de privacidad actualizada (5 min)

Ya te dejé el archivo listo: `respondo-astro/src/pages/privacidad.astro` (te lo commiteé al disco).
Le agregué la **sección 5: Google Calendar y Datos de Usuario de Google**, que es
exactamente lo que Google busca en la revisión: qué datos accedemos, para qué,
cómo los guardamos, con quién los compartimos, cómo revocar, y la declaración
textual de cumplimiento de **Limited Use**.

Solo tienes que hacer `npm run build` y desplegar la web como siempre. Verifica
después que <https://www.respon-do.com/privacidad/> muestre la sección 5.

### A5. Crear la credencial OAuth (5 min)

**APIs y servicios** → **Credenciales** → *Crear credenciales* → **ID de cliente de OAuth**:
- Tipo: **Aplicación web**
- Nombre: `Respondo Portal`
- Orígenes autorizados de JavaScript: `https://<tu-portal>.vercel.app` (y `http://localhost:3000` para pruebas)
- URIs de redireccionamiento autorizados: `https://<tu-portal>.vercel.app/api/google/callback` (y `http://localhost:3000/api/google/callback`)

Guarda el **Client ID** y el **Client Secret** — me los pasas y los dejo cableados
(van como variables de entorno, nunca en el código).

### A6. Declarar el scope y pedir la verificación (10 min)

En la pantalla de consentimiento → **Permisos (Scopes)** → *Agregar o quitar*:

- Agrega **solo**: `https://www.googleapis.com/auth/calendar.events`

> **No agregues** `https://www.googleapis.com/auth/calendar` (calendario completo).
> Mientras más angosto el permiso, más rápido y más fácil aprueban — y
> `calendar.events` alcanza para todo lo que hacemos.
>
> 📌 **Dato a verificar en pantalla:** junto a cada scope, la consola muestra la
> etiqueta **"Sensible"** o **"Restringido"**. Confirma que `calendar.events`
> aparezca como *Sensible*. Si apareciera como *Restringido*, avísame: eso
> implicaría una evaluación de seguridad anual (CASA) y convendría replantear la
> estrategia — en ese caso nos quedamos con la cuenta de servicio, que no la
> necesita.

Luego, en el **Centro de verificación**, completa la justificación (textos listos
en la Parte C) y sube el video (guion en la Parte D). Botón **Enviar para
verificación**.

---

## Parte B — Lo único que NO se puede terminar mañana

**El video demo.** Google exige un video mostrando el flujo real: el usuario
apretando "Conectar Google Calendar" en Respondo, la pantalla de consentimiento
de Google con esos mismos permisos, y qué hace la app con los datos después.

Ese botón es parte de la F5-OAuth que aún no construyo (hoy la sincronización va
por cuenta de servicio, que no lo necesita). La secuencia realista:

1. Mañana dejas listo A1–A6.
2. Me pasas el Client ID y Secret → construyo el flujo de conexión.
3. Despliegas el portal en Vercel.
4. Grabas el video (2–3 min) siguiendo el guion de la Parte D.
5. Lo subes a YouTube como **No listado** y pegas el enlace.
6. **Enviar.** Desde ahí, la revisión toma típicamente **3–5 días hábiles**.

**Mientras tanto la app funciona igual** en modo prueba (agregando correos como
"usuarios de prueba"), y los clientes reales van por cuenta de servicio, que no
requiere nada de esto.

---

## Parte C — Textos para el formulario (cópialos y pégalos)

El formulario de Google está en inglés. Estos textos están escritos para lo que
los revisores buscan: función concreta, visible en la interfaz, y por qué un
permiso más angosto no alcanza.

### C1. ¿Por qué necesitas este scope? (*Scope justification*)

```
Respondo is a scheduling and customer-communication platform for small
businesses in Chile (clinics, salons, gyms and similar appointment-based
businesses). Business owners use Respondo to manage their services, staff
working hours and customer bookings, which can be created by the business
itself, by customers through a public booking page, or through the business's
WhatsApp assistant.

We request https://www.googleapis.com/auth/calendar.events so that a business
owner who connects their Google Calendar can:

1. See every appointment booked through Respondo automatically appear as an
   event in their own Google Calendar, so they do not have to check two places.
2. Have that event automatically updated when the appointment is rescheduled and
   removed when it is cancelled.
3. Avoid double-booking: we read the busy time blocks of the connected calendar
   so Respondo never offers a time slot when the owner already has a personal or
   external commitment.

All three functions are visible and prominent in the product: they are shown in
the "Agenda" section of the customer portal, where the owner explicitly connects
the calendar and can disconnect it at any time.

A narrower scope does not work for our use case:
- calendar.freebusy would let us read availability, but not create, update or
  delete the appointment events, which is the core of the feature.
- calendar.events.owned only covers events the user owns, and many of our
  businesses operate shared calendars where staff members are the organizers.
- calendar.readonly would not allow writing appointments at all.

We deliberately do NOT request the full https://www.googleapis.com/auth/calendar
scope, because we do not need to manage calendars themselves (create, delete or
change calendar settings) — only the events.
```

### C2. ¿Cómo se usan los datos? (*How will the data be used*)

```
Google user data is used exclusively to power the calendar synchronization
feature described above, and only while the business keeps the integration
enabled.

- We do not store the content of the user's personal calendar events. Busy/free
  information is queried at the moment we compute available appointment slots
  and is not persisted.
- Of the events we create ourselves, we store only the technical event
  identifier, so that we can later update or delete that same event.
- We never use Google user data for advertising, we do not sell or transfer it,
  and we do not use it to train generalized artificial intelligence models.
- Access is limited to the automated process that performs the synchronization;
  no Respondo employee reads the user's calendar data.

Our use of information received from Google APIs adheres to the Google API
Services User Data Policy, including the Limited Use requirements. This is
stated publicly in our privacy policy at
https://www.respon-do.com/privacidad/ (section 5).
```

### C3. Descripción corta de la app (si la piden)

```
Respondo is an appointment scheduling and customer communication platform for
small service businesses in Chile. Businesses manage their services, staff
schedules and bookings in one place; customers book through a public booking
page or by chatting with the business on WhatsApp. The optional Google Calendar
integration keeps the owner's calendar and Respondo's schedule in sync.
```

---

## Parte D — Guion del video demo (2–3 minutos)

**Requisitos técnicos:** pantalla completa, se debe ver la URL del navegador,
audio no es obligatorio pero ayuda (puedes narrar o poner subtítulos), subir a
**YouTube → visibilidad: No listado**.

| # | Qué se ve en pantalla | Qué decir / mostrar |
|---|---|---|
| 1 | La web `respon-do.com` | "Esta es Respondo, plataforma de agendamiento para pymes en Chile." (5 s) |
| 2 | Login del portal y entrada a `/agenda` | "El dueño del negocio entra a su portal y va a su Agenda, donde ve sus servicios, sus profesionales y sus horas reservadas." (20 s) |
| 3 | La sección "Ver tus horas en Google Calendar" | "Aquí puede conectar su Google Calendar. Es opcional." (10 s) |
| 4 | **Clic en "Conectar Google Calendar"** | ⚠️ Momento clave: se debe ver el botón siendo presionado. |
| 5 | **La pantalla de consentimiento de Google COMPLETA** | ⚠️ Requisito explícito: debe verse el nombre "Respondo", la cuenta elegida y **el permiso de Calendar solicitado**. No cortes esta parte ni la aceleres. |
| 6 | Vuelta al portal, ya conectado | "Ya quedó conectado." (5 s) |
| 7 | Crear una cita en Respondo | "Cuando se reserva una hora…" (15 s) |
| 8 | **Google Calendar del usuario mostrando el evento creado** | "…aparece automáticamente en su Google Calendar." ⚠️ Esto es lo que demuestra el USO real del permiso. (15 s) |
| 9 | Cancelar la cita en Respondo → el evento desaparece de Google | "Y si la hora se cancela, el evento se elimina solo." (15 s) |
| 10 | Poner un evento personal en Google Calendar → volver a Respondo y ver que ese horario ya no se ofrece | "Y si el dueño tiene un compromiso personal, Respondo deja de ofrecer esa hora." (20 s) |
| 11 | Desconectar la integración | "Puede desconectarlo cuando quiera." (10 s) |

**Errores que hacen rechazar el video** (los más comunes):
- No mostrar la pantalla de consentimiento completa, o mostrar una de otra app.
- Mostrar un dominio distinto al declarado (usa el dominio final, no localhost).
- No mostrar qué hace la app con los datos (solo mostrar la conexión y cortar).

---

## Parte E — Checklist para ir marcando

- [ ] A1 · Proyecto `Respondo` creado y Calendar API habilitada
- [ ] A2 · Pantalla de consentimiento configurada (sin logo)
- [ ] A3 · `respon-do.com` verificado en Search Console (TXT en DNS)
- [ ] A4 · Política de privacidad con sección 5 publicada y visible en la web
- [ ] A5 · Client ID + Secret creados → **pasármelos**
- [ ] A6 · Scope `calendar.events` declarado + confirmado que dice "Sensible"
- [ ] B2 · (yo) Flujo "Conectar Google Calendar" construido
- [ ] B3 · Portal desplegado en Vercel
- [ ] B4 · Video grabado y subido a YouTube (No listado)
- [ ] B5 · Formulario enviado con los textos de la Parte C
- [ ] ⏳ Esperar 3–5 días hábiles

---

## Fuentes

- [Google — Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google Cloud — Verification requirements](https://support.google.com/cloud/answer/13464321)
- [Google — Restricted scope verification (CASA)](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google — API Services User Data Policy (Limited Use)](https://developers.google.com/terms/api-services-user-data-policy)
- [Google — OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
