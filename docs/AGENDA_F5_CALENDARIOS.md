# F5 · Sincronización con Google Calendar (sin esperar la verificación)

**Entregado:** 31-jul-2026. **Estado:** construido y verificado; falta que
Marcelo aplique la migración 221 y (opcionalmente) configure la cuenta de
servicio.

La pregunta que resolvió esta fase: *"¿podemos empezar el 10 de agosto sin
esperar el OAuth de Google?"*. **Sí.** Hay tres vías; dos ya están hechas y no
requieren verificación de ninguna clase.

| Vía | Qué logra | Requiere verificación de Google | Estado |
|---|---|---|---|
| **1. Enlace iCal** | El dueño ve sus horas de Respondo dentro de su Google Calendar (o Apple/Outlook) | ❌ Nada | ✅ Construida |
| **2. Cuenta de servicio** | Sincronización real en dos vías: escribimos las citas y leemos sus compromisos para no ofrecer horas ocupadas | ❌ Nada | ✅ Construida (falta pegar la llave) |
| **3. OAuth "Conectar mi Google"** | Lo mismo que la 2, pero con el botón elegante y autoservicio para el cliente | ✅ Sí (3–5 días hábiles) | ⏳ Ver `OAUTH_GOOGLE_EXPEDIENTE.md` |

---

## Vía 1 · Enlace iCal (cero configuración)

**Cómo funciona:** cada cliente tiene un enlace secreto
`/api/agenda/ical/<token>` que entrega sus citas en formato de calendario
estándar (RFC 5545). El dueño lo pega en Google Calendar → *Otros calendarios* →
*Desde URL*, y sus horas aparecen en el celular junto a todo lo demás.

**Dónde lo ve el cliente:** portal → **Agenda** → *"Ver tus horas en Google
Calendar"* → enlace con botón **Copiar**.

**Lo honesto que hay que decirle al cliente:** Google refresca las suscripciones
por URL **cada varias horas**, no al instante. Es perfecto para "ver mi día en
el celular"; no sirve si necesita que aparezca en 10 segundos. Para eso está la
vía 2.

**Detalles técnicos:**
- Publica una ventana de 60 días hacia atrás y 180 hacia adelante.
- El UID de cada evento es el id de la cita → al reagendar, el calendario
  **actualiza** el evento en vez de duplicarlo.
- Las citas canceladas o marcadas "no llegó" se publican como `CANCELLED`, así
  desaparecen del calendario del dueño.
- Seguridad: el token es aleatorio de 24 bytes (48 caracteres hex), único e
  indexado. Mismo modelo que los enlaces privados de Google Calendar. Rotarlo es
  cambiar esa columna.
- Verificado con un parser independiente (`node-ical`): acentos, comas, punto y
  coma, saltos de línea y plegado de líneas largas dan la vuelta completa sin
  corromperse.

---

## Vía 2 · Cuenta de servicio (sincronización real, hoy)

**La idea:** una cuenta de servicio es un "correo robot" (algo como
`agenda@respondo-xxxx.iam.gserviceaccount.com`). El dueño **comparte su
calendario con ese correo**, igual que se lo compartiría a una recepcionista.
Desde ese momento podemos leer su disponibilidad y escribirle las citas. **Google
no exige verificación de app para esto**, porque no hay usuarios dando
consentimiento OAuth: hay un calendario compartido a propósito.

**Qué hace ya el código:**
- Al crear una cita → crea el evento en el calendario del profesional.
- Al reagendar → **mueve** el mismo evento (id determinista derivado del id de la
  cita: no se duplica).
- Al cancelar o marcar no-show → borra el evento.
- Al calcular cupos disponibles → consulta *free/busy* del calendario y descarta
  los horarios donde el dueño ya está ocupado, aunque ese compromiso no esté en
  Respondo.

**Sin dependencias:** el JWT RS256 se firma con el `crypto` de Node. No se
instaló `googleapis` (menos peso en Vercel, menos superficie). La firma está
verificada con un test que genera un par de llaves RSA y valida la firma, más un
control negativo con una firma corrupta.

### Lo que falta para encenderla (10 min tuyos, sin esperas)

1. En Google Cloud (mismo proyecto del expediente OAuth): **IAM y administración
   → Cuentas de servicio → Crear**. Nombre: `agenda`. Sin roles.
2. En esa cuenta → pestaña **Claves** → *Agregar clave* → *Crear clave nueva* →
   **JSON**. Se descarga un archivo.
3. De ese JSON saca dos valores y ponlos como variables de entorno en Vercel
   (y en tu `.env.local` para probar):
   - `GOOGLE_SA_EMAIL` = el campo `client_email`
   - `GOOGLE_SA_PRIVATE_KEY` = el campo `private_key` **completo**, con los
     `\n` tal como vienen (el código los normaliza solo).
4. El **dueño del negocio** (o tú en su calendario de prueba) comparte su Google
   Calendar con ese `client_email`, con permiso **"Hacer cambios en los
   eventos"**.
5. En el portal → Agenda → sección de calendarios → pega el **ID del calendario**
   del profesional (suele ser el correo del dueño) y marca *Activar*.
   Al guardar, el portal **prueba el acceso en el momento** y te dice si Google
   respondió bien o cuál fue el error exacto.

> Si no configuras nada de esto, no pasa absolutamente nada: todas las funciones
> de Google quedan inertes y la agenda opera igual que hoy.

---

## Archivos de esta fase

| Archivo | Qué es |
|---|---|
| `sql/221_agenda_calendarios.sql` | Migración aditiva: `ed_clientes.ical_token` + `ed_profesionales.gcal_id/gcal_sync/gcal_ultimo_error/gcal_ultima_sync` |
| `lib/ical.ts` | Generador iCal puro (escapado, plegado de líneas, fechas UTC) |
| `app/api/agenda/ical/[token]/route.ts` | Endpoint público del feed, con rate-limit |
| `lib/googleCalendar.ts` | Cuenta de servicio: JWT RS256, token cacheado, eventos y free/busy. Inerte sin credenciales |
| `lib/agendaGoogle.ts` | Puente agenda ↔ Google, 100% best-effort y defensivo |
| `components/CampoCopiar.tsx` | Campo con botón "Copiar" para el enlace iCal |
| `scripts/_test_ical.ts` | 26 tests del generador iCal |
| `scripts/_test_gcal_firma.ts` | 9 tests de la firma JWT (con llaves RSA generadas al vuelo) |

**Modificados:** `lib/agenda.ts` (free/busy en disponibilidad + espejo del
evento al crear/reagendar/cancelar), `app/(portal)/agenda/*` (sección de
calendarios).

## Garantías que se mantienen

- **Tino en Impresora Color sigue intacto.** Nada de esto se activa sin agenda
  configurada, sin migración 221 y sin credenciales.
- **Google nunca puede romper una cita.** Todas las llamadas van envueltas: si
  Google está caído, si el permiso fue revocado o si la migración no está
  aplicada, la cita se crea igual y el error queda anotado en la ficha del
  profesional para verlo en el portal.
- La disponibilidad sin credenciales se calcula exactamente igual que antes.

## Pendientes tuyos

1. Aplicar `sql/221_agenda_calendarios.sql` en Supabase (después de la 220).
   Verificación esperada: `col_ical = 1`, `cols_gcal = 4`.
2. `npm run build` + commit + push.
3. (Opcional, cuando quieras la sincronización real) los 5 pasos de la vía 2.
