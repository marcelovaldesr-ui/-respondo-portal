# Guion — Video demo verificación OAuth Google Calendar

> **Actualizado 12-ago-2026.** Dos cosas cambiaron desde que se escribió este
> guion, y las dos juegan a favor:
>
> 1. **La agenda del portal por fin muestra las citas.** Cuando se intentó grabar
>    la vez pasada estaba rota por un join ambiguo de PostgREST (arreglado hoy),
>    así que el paso 7 —crear una cita y verla en el calendario— habría sido
>    imposible de mostrar. Ahora funciona.
> 2. **Ya hay una cita real de prueba** en la clínica demo: *Mentoria · Camila*,
>    lunes 17 de agosto 12:00. Sirve para el paso 9 (cancelarla y mostrar que
>    desaparece de Google Calendar) sin tener que crear nada.
>
> Recuerda: **antes de grabar hay que revocar el acceso** en
> `myaccount.google.com/connections` → Respondo. Sin eso Google muestra la
> pantalla resumida de "ya tiene cierto acceso" en vez de la pantalla completa
> de permisos, que es la que el revisor necesita ver. Fue lo que invalidó la
> toma anterior.

**Duración objetivo:** 2–3 minutos
**Cuenta a usar:** hirespondo@gmail.com → cliente "Clínica Dental Sonrisa (demo)"
**Profesional a conectar:** Dra. Valentina Rojas

## Requisitos técnicos (obligatorios)

- Pantalla completa, se debe ver la URL del navegador en todo momento.
- Audio no es obligatorio, pero ayuda (puedes narrar en vivo o agregar subtítulos después).
- Sube el video a **YouTube → visibilidad: No listado** (ni público ni privado).
- No aceleres ni cortes el video en los pasos marcados con ⚠️.

## Paso a paso

| # | Qué se ve en pantalla | Qué decir / hacer | Duración aprox. |
|---|---|---|---|
| 1 | La web `respon-do.com` | "Esta es Respondo, plataforma de agendamiento para pymes en Chile." | 5 s |
| 2 | Login del portal (`respondo-portal.vercel.app`) con hirespondo@gmail.com, entras a **Agenda → Configuración** | "El dueño del negocio entra a su portal y va a su Agenda, donde ve sus servicios, sus profesionales y sus horas reservadas." | 20 s |
| 3 | La sección "Ver tus horas en Google Calendar" | "Aquí puede conectar su Google Calendar. Es opcional." | 10 s |
| 4 | **Clic en "Conectar Google Calendar"** (junto a Dra. Valentina Rojas) | ⚠️ Momento clave: se debe ver el botón siendo presionado, con el mouse encima antes de hacer clic. | — |
| 5 | **La pantalla de consentimiento de Google COMPLETA** | ⚠️ Requisito explícito de Google: debe verse el nombre "Respondo", la cuenta de Google elegida (hirespondo@gmail.com) y **el permiso de Calendar solicitado** ("Ver y editar eventos en tus calendarios"). No cortes esta parte ni la aceleres. Deja que se vea completa, de arriba a abajo si hay scroll. | 15–20 s |
| 6 | Clic en "Continuar"/"Permitir", vuelta al portal, ya conectado (verás "Google Calendar conectado ✓") | "Ya quedó conectado." | 5 s |
| 7 | Ve a la Agenda y crea una cita de prueba (o usa "Probar ahora" si agenda por ahí) | "Cuando se reserva una hora…" | 15 s |
| 8 | **Abre Google Calendar del navegador (calendar.google.com) con la MISMA cuenta hirespondo@gmail.com, mostrando el evento recién creado** | "…aparece automáticamente en su Google Calendar." ⚠️ Esto es lo que demuestra el USO real del permiso — no lo saltes. | 15 s |
| 9 | Cancela esa misma cita desde el portal → vuelve a Google Calendar y el evento ya no está | "Y si la hora se cancela, el evento se elimina solo." | 15 s |
| 10 | Crea un evento personal cualquiera directo en Google Calendar (ej. "Reunión personal") en un horario dentro del horario de atención → vuelve al portal / a la agenda pública y muestra que ese horario ya no se ofrece como disponible | "Y si el dueño tiene un compromiso personal, Respondo deja de ofrecer esa hora." | 20 s |
| 11 | Vuelve a Agenda → Configuración, clic en **"Desconectar"** | "Puede desconectarlo cuando quiera." | 10 s |

## Errores que hacen rechazar el video (evítalos)

- No mostrar la pantalla de consentimiento completa, o mostrar una de otra app distinta a Respondo.
- Mostrar un dominio distinto al declarado (usa `respondo-portal.vercel.app`, nunca `localhost`).
- No mostrar qué hace la app con los datos — solo mostrar la conexión y cortar ahí no alcanza; Google quiere ver el evento apareciendo de verdad en el calendario.

## Después de grabar

1. Sube el video a YouTube como **No listado**.
2. Copia el enlace.
3. Entra al **Centro de verificación** (dentro de "Público" en Google Auth Platform) y pega los textos de justificación (los tienes más abajo) junto con el enlace del video.
4. Botón **Enviar para verificación**. La revisión toma típicamente 3–5 días hábiles.

---

## Textos para el formulario (Centro de verificación)

El formulario de Google está en inglés — cópialos y pégalos tal cual.

### 1) ¿Por qué necesitas este scope? (*Scope justification*)

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

### 2) ¿Cómo se usan los datos? (*How will the data be used*)

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

### 3) Descripción corta de la app (si la piden)

```
Respondo is an appointment scheduling and customer communication platform for
small service businesses in Chile. Businesses manage their services, staff
schedules and bookings in one place; customers book through a public booking
page or by chatting with the business on WhatsApp. The optional Google Calendar
integration keeps the owner's calendar and Respondo's schedule in sync.
```
