# Google Calendar SIN esperar la verificación — 10 minutos

## La decisión

Hay dos caminos para conectar Google Calendar, y **no son alternativas: son
etapas**.

| | Cuenta de servicio (este doc) | OAuth con botón "Conectar" |
|---|---|---|
| Tiempo de setup | ~10 min | 60–90 min + **3 a 5 días hábiles** de espera |
| Requiere verificación de Google | **No** | Sí (video demo, dominio verificado en Search Console) |
| Qué puede hacer | Escribe las citas en el calendario del dueño **y lee sus compromisos** para no ofrecer horas ocupadas | Lo mismo |
| Fricción para el cliente | Pega un correo robot en "Compartir" de su calendario | Un clic |
| Sirve para el 10-ago | **Sí** | No alcanza |

**Recomendación: hacer esto ahora y OAuth después.** La cuenta de servicio da
sincronización real en las dos direcciones desde el primer día. El botón de
OAuth es una mejora de comodidad, no de capacidad: se cambia el "pega este
correo" por un clic, y eso puede llegar en septiembre sin costo para nadie.

Además ya existe una tercera vía que **no requiere nada**: el enlace iCal que
está en `/agenda/configuracion`. El dueño lo pega en Google Calendar y ve sus
horas en el celular. Es solo lectura y Google lo refresca cada varias horas,
pero funciona hoy, sin tocar Google Cloud.

---

## PASO A · Crear la cuenta de servicio (5 min)

1. Entra a <https://console.cloud.google.com> con la cuenta de Respondo.
2. Arriba a la izquierda, **selector de proyecto → Proyecto nuevo**.
   Nombre: `respondo-agenda`. Crear.
3. Buscador de arriba: escribe **"Google Calendar API"** → **Habilitar**.
4. Buscador: **"Cuentas de servicio"** (*Service accounts*) → **Crear cuenta de
   servicio**.
   - Nombre: `agenda`
   - ID: queda `agenda` → el correo será
     `agenda@respondo-agenda.iam.gserviceaccount.com`
   - En "Otorgar acceso" **no marques nada**. No lo necesita: el permiso se lo da
     cada dueño al compartir su calendario.
   - **Listo**.
5. Entra a la cuenta recién creada → pestaña **Claves** (*Keys*) →
   **Agregar clave → Crear clave nueva → JSON** → se descarga un archivo.

> Ese JSON es una credencial. No lo subas al repositorio ni lo mandes por
> WhatsApp. Del archivo solo se usan dos campos.

## PASO B · Cargar las variables en Vercel (3 min)

Abre el JSON descargado. Necesitas `client_email` y `private_key`.

Vercel → proyecto `respondo-portal` → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `GOOGLE_SA_EMAIL` | el `client_email` del JSON, tal cual |
| `GOOGLE_SA_PRIVATE_KEY` | el `private_key` del JSON, **completo**, incluyendo `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----` |

Marca los tres entornos (Production, Preview, Development) y guarda.

**Sobre los saltos de línea:** el JSON trae la clave con `\n` escapados. Pégala
tal cual, con los `\n` literales — el código ya los convierte
(`lib/googleCalendar.ts` hace `replace(/\\n/g, "\n")`). Si tu editor te la pega
con saltos de línea reales, también funciona. Las dos formas están cubiertas y
probadas.

Después de guardar hay que **redesplegar** para que las variables entren:
Deployments → el último → **⋯ → Redeploy**.

## PASO C · Compartir el calendario (2 min por profesional)

Esto lo hace cada dueño de negocio, una sola vez:

1. Google Calendar → engranaje → **Configuración**.
2. En la izquierda, elegir el calendario → **Compartir con determinadas personas**.
3. **Agregar personas** → pegar el correo de la cuenta de servicio
   (`agenda@respondo-agenda.iam.gserviceaccount.com`).
4. Permiso: **Hacer cambios en los eventos**. Enviar.
5. En esa misma pantalla, más abajo: **Integrar calendario → ID del calendario**.
   Copiarlo (suele ser el correo del dueño, o algo como
   `abc123@group.calendar.google.com`).

## PASO D · Conectar en el portal (1 min)

Portal → **Agenda → Configuración → Ver tus horas en Google Calendar →
Sincronización en dos vías**. Ahí, por cada profesional:

- Pegar el **ID del calendario**
- Marcar **Activar**
- **Guardar**

Si algo falla, Google devuelve el motivo y queda escrito bajo el formulario
(`gcal_ultimo_error`). Los errores típicos:

| Mensaje | Qué pasó |
|---|---|
| `404 Not Found` | El ID del calendario está mal escrito |
| `403 Forbidden` | No se compartió, o se compartió con permiso de solo lectura |
| `invalid_grant` | La clave privada quedó mal pegada en Vercel |

## PASO E · Verificar (1 min)

Crea una hora de prueba en `/agenda` con **+ Nueva hora** y mírala aparecer en
Google Calendar. Después cancélala en el portal: el evento debe desaparecer.

Al revés también: pon un evento personal en Google a una hora de atención y
comprueba que esa hora **deja de ofrecerse** en tu página pública de reservas.
Eso es lo que la cuenta de servicio agrega sobre el enlace iCal.

---

## Lo que queda pendiente para OAuth

Nada de esto se pierde. Cuando quieras el botón "Conectar Google Calendar":
`docs/OAUTH_GOOGLE_EXPEDIENTE.md` tiene los pasos A1–A6, los textos en inglés
para el formulario de justificación y el guion del video demo. Lo único que
necesito de ti para construirlo es el **Client ID** y el **Client Secret** del
paso A5.
