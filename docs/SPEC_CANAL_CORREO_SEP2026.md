# SPEC · Canal Correo (Tino en la bandeja de entrada)

**2-sep-2026 · estado: DISEÑADO, NO CONSTRUIDO.**
Escrito contra el código real del portal, no en abstracto.

---

## 0. La corrección de rumbo (leer antes que nada)

El planteamiento original era: **Gmail API + OAuth + Cloud Pub/Sub**.
Ese camino está mal para Respondo, por dos razones que no se arreglan programando mejor.

### 0.1 Leer correo con la API de Gmail es un *restricted scope*

Google clasifica sus permisos en tres niveles. Los de Gmail caen así:

| Scope | Nivel | Qué implica |
|---|---|---|
| `gmail.send`, `gmail.compose` | **Sensible** | Verificación normal (video, política de privacidad, dominio verificado) |
| `gmail.readonly`, `gmail.modify`, `gmail.metadata`, `https://mail.google.com/` | **Restringido** | Verificación **+ evaluación de seguridad CASA anual por un tercero certificado** |

Para que Tino *lea* correos entrantes hace falta `readonly` o `modify`. No hay atajo:
la CASA es una auditoría externa que se paga todos los años y que un equipo de dos
personas sin clientes pagando no tiene por qué asumir hoy.

### 0.2 Tocar el consent screen pone en riesgo la Agenda

La verificación de OAuth quedó **cerrada el 21-ago**. Los scopes actuales viven en
`lib/googleOAuth.ts:70`:

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.freebusy
```

Agregar scopes de Gmail al **mismo proyecto de Google Cloud** reabre la verificación
del consent screen. Es decir: por una función que ningún prospecto ha pedido, se
arriesga volver a "app no verificada" en la Agenda, que es el wedge que sí vende.

> **Regla:** si algún día se usa un scope de Gmail, va en un **proyecto de Google Cloud
> separado**, con su propio OAuth client y su propia pantalla de consentimiento. La
> verificación de Calendar no se toca nunca más.

### 0.3 Y además solo serviría a la mitad de los clientes

La API de Gmail no sirve para Outlook, Zoho, ni el correo del hosting con cPanel que
usa media pyme chilena. Se pagaría una auditoría anual por una integración que deja
fuera a parte de la cartera.

---

## 1. La arquitectura correcta: reenvío + webhook de entrada

Es lo que hacen Intercom, Front, Help Scout y Zendesk. Ninguno pide OAuth de Gmail.

```
Cliente escribe a  ventas@empresa.cl
        │
        │  (regla de reenvío en el correo del negocio — 2 minutos, la pone el dueño)
        ▼
   cliente-abc@in.respon-do.com        ← subdominio nuestro, MX al proveedor de entrada
        │
        │  el proveedor parsea el MIME y hace POST del JSON
        ▼
   POST /api/correo/webhook            ← firma HMAC, responde 200 en <2 s SIEMPRE
        │
        ▼
   procesarConInbox()                  ← YA EXISTE en lib/webhookInbox.ts (idempotencia)
        │
        ▼
   lib/inboundCorreo.ts                ← resuelve buzón→cliente→empleado, normaliza hilo,
        │                                 limpia firma y cita, inserta en ed_mensajes
        ▼
   responderSiBot()                    ← YA EXISTE en lib/responderBot.ts
        │
        ├─ modo borrador → estado_envio='borrador', avisa por push, NO manda
        └─ modo envío    → API del proveedor con In-Reply-To / References
```

**Ventajas frente a Pub/Sub:** cero OAuth, cero verificación, cero CASA, funciona con
cualquier proveedor de correo del cliente, y el flujo es **calcado del webhook de Meta
que ya está en producción** — se reusa la idempotencia, el reclamar/finalizar y el cron
de reproceso que ya existen.

**Por qué Pub/Sub es más máquina, no menos:** `users.watch` de Gmail **caduca a los 7 días**
y hay que re-armarlo por cron para cada buzón; hay que persistir un `historyId` por casilla;
y si te atrasas, Google responde **410 Gone** y toca resincronizar el buzón completo. Es
más infraestructura frágil, no menos.

### Proveedores de entrada (elegir uno en F0)
- **Cloudflare Email Workers** — gratis, MX de Cloudflare, el worker hace el POST. Más barato.
- **Postmark Inbound / Mailgun Routes / Resend** — parseo MIME listo, adjuntos ya separados, precio bajo en volumen chico. Menos código.

### El envío
No sale por Gmail. Sale por API del proveedor desde un **dominio de envío aparte**
(nunca `respon-do.com`: esa regla ya rige para el correo en frío y por la misma razón —
no quemar la reputación del dominio de la marca).

- `From:` con el dominio del cliente exige que el dueño ponga **un registro DNS** (SPF/DKIM).
  Es un paso de onboarding real, igual que el método de pago del WABA.
- Sin ese registro: `From: ventas-empresa@envio.respondomail.cl` + `Reply-To: ventas@empresa.cl`.
  Funciona, se ve peor.
- Si algún cliente grande exige que la respuesta quede en **su** carpeta Enviados: ahí sí
  `gmail.send` (scope **sensible**, verificación sin CASA), en el proyecto separado del punto 0.2.
  Opción avanzada, no el camino base.

---

## 2. Esquema de base de datos

**Principio: no crear un universo paralelo.** `ed_mensajes` ya es multicanal
(`sql/210_whatsapp_cloud.sql:21`). Si el correo entra por ahí, heredan gratis el inbox,
`ed_chat_estado`, `ed_etiquetas`, `ed_contactos`, el embudo, los seguimientos, la analítica
y los cobros. Si se hace una tabla aparte, hay que reescribir todo eso.

### Migración 290 (aditiva)

```sql
-- 1) El canal. El CHECK de 210 hoy solo acepta whatsapp|instagram|messenger|prueba.
alter table ed_mensajes drop constraint if exists ed_mensajes_canal_check;
alter table ed_mensajes add constraint ed_mensajes_canal_check
  check (canal in ('whatsapp','instagram','messenger','prueba','correo'));

-- 2) Lo propio del correo. Mismo patrón aditivo que 270_media_mensajes.
alter table ed_mensajes
  add column if not exists correo_message_id  text,
  add column if not exists correo_thread_id   text,
  add column if not exists correo_in_reply_to text,
  add column if not exists correo_asunto      text,
  add column if not exists correo_de          text,
  add column if not exists correo_para        text[],
  add column if not exists correo_cc          text[],
  add column if not exists texto_html         text;

-- 3) EL ANTÍDOTO CONTRA DUPLICADOS. Si el proveedor reintenta, esto lo frena en seco.
create unique index if not exists ed_mensajes_correo_msgid_uniq
  on ed_mensajes (empleado_id, correo_message_id)
  where correo_message_id is not null;

create index if not exists idx_ed_mensajes_thread
  on ed_mensajes (empleado_id, correo_thread_id)
  where correo_thread_id is not null;
```

**`chat_id` para correo = la dirección del contacto en minúsculas.** Así el inbox agrupa
igual que con un número de WhatsApp y no hay que tocar ni una consulta existente.
`texto` sigue siendo el **texto plano ya limpio** (lo que lee Gemini y lo que se muestra);
`texto_html` es para renderizar.

### Buzones (tabla nueva)

Un negocio tiene **varias** casillas (`ventas@`, `contacto@`, `soporte@`) — a diferencia
del WhatsApp, que es uno. Por eso tabla, no columnas en `ed_clientes`.

```sql
create table if not exists ed_buzones (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  empleado_id     uuid not null references ed_empleados(id) on delete cascade,
  direccion       text not null,              -- ventas@empresa.cl (la real del negocio)
  alias_entrada   text not null unique,       -- cliente-abc@in.respon-do.com
  responder_desde text,                       -- null = usar `direccion`
  firma_html      text,
  modo            text not null default 'borrador' check (modo in ('borrador','envio')),
  presupuesto_dia integer not null default 50, -- tope duro de respuestas automáticas/día
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_ed_buzones_cliente on ed_buzones(cliente_id);
-- Sin RLS, como ed_integraciones (274): es configuración, solo la toca el servidor.
```

### Adjuntos (tabla nueva)

`ed_mensajes` tiene **un solo juego** de columnas `media_*` (270). Un correo trae varios.

```sql
create table if not exists ed_mensaje_adjuntos (
  id          uuid primary key default gen_random_uuid(),
  mensaje_id  uuid not null references ed_mensajes(id) on delete cascade,
  url         text not null,
  mime        text,
  nombre      text,
  bytes       integer,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_adjuntos_mensaje on ed_mensaje_adjuntos(mensaje_id);
```

Se guardan en el **bucket de 286**, con el mismo tope de 10 MB. Ojo con lo que ya está
documentado: el límite real de Supabase Free **no es la base de 500 MB sino el file
storage de 1 GB**, y el que lo llena son los PDF. El correo trae PDF pesados por
naturaleza — cotizaciones, facturas, planos. Descartar adjuntos de remitentes no
clasificados.

> ⚠ **Regla de la casa: deploy ANTES que migración.** El código debe tolerar que las
> columnas todavía no existan.

---

## 3. Estructura de componentes UI

**Ruta nueva `/correo`, hermana de `/conversaciones`. No mezclar en el mismo inbox.**
La burbuja de chat y el hilo de correo tienen ritmos distintos: asunto, CC, HTML, firmas,
citas plegadas. Meterlos en `InboxConversacion.tsx` rompe el inbox que ya funciona.

```
app/(portal)/correo/
  page.tsx              ← server component, mismo patrón que conversaciones/page.tsx
  acciones.ts           ← server actions (marcar leído, redactar, enviar)
  loading.tsx

components/correo/
  ColumnaBandeja.tsx    ← calcado de inbox/ColumnaLista.tsx (reusar filtro y orden)
  PanelHilo.tsx         ← hilo colapsado: último abierto, anteriores plegados
  MensajeCorreo.tsx     ← cabecera De/Para/CC/fecha + cuerpo
  RedactorCorreo.tsx    ← asunto bloqueado en respuesta, "Escribir con Tino", 3 estados
  AdjuntosCorreo.tsx    ← reusar inbox/Adjunto.tsx
  CitaPlegada.tsx       ← "··· mostrar contenido citado"
```

**Dos decisiones que no son de estilo:**

1. **El cuerpo HTML va en un `<iframe sandbox>`, nunca en `dangerouslySetInnerHTML`.**
   Es HTML escrito por un desconocido y servido dentro de la sesión autenticada del dueño:
   con `dangerouslySetInnerHTML` cualquiera que le escriba a `ventas@` puede ejecutar
   JavaScript en su portal. Además hay que sanitizar y bloquear imágenes remotas por
   defecto (los píxeles de rastreo le avisan al remitente que se abrió).

2. **El vivo se reusa, no se duplica.** Ya existen `useMensajesEnVivo.ts` y el SSE de
   `/api/whatsapp/stream`. Generalizar ese endpoint a `/api/inbox/stream` con parámetro
   de canal es una tarde; duplicarlo son dos streams que se desincronizan.

---

## 4. Los cuellos de botella reales

Ordenados por lo que más duele, no por lo que suena más técnico.

**1. Spam, newsletters y facturas — es un problema de PLATA, no de UX.**
A WhatsApp se entra por invitación. Una casilla de correo recibe publicidad todo el día.
Sin filtro, Tino contesta newsletters y **se pagan tokens por cada una**. Es el mismo
tipo de riesgo que el tope de gasto de los seguimientos (134 cotizaciones × $85 en una
pasada). Mitigación: descartar por cabeceras (`Precedence: bulk|list`, `List-Unsubscribe`),
remitentes `no-reply@`/`noreply@`, y **`presupuesto_dia` por buzón** — reusando el criterio
de `lib/presupuesto.ts` y `lib/cupoConversaciones.ts`.

**2. Bucles de autorespuesta.**
Tino responde un "Fuera de la oficina", el otro lado autorresponde otra vez, y así hasta
que se acaba el presupuesto. Descartar `Auto-Submitted: auto-replied`, `X-Autoreply`,
`X-Autorespond`. Además: **tope duro de respuestas automáticas por hilo por día**, no solo
por buzón.

**3. Firmas y citas del hilo anterior.**
Sin limpiar, cada respuesta le manda a Gemini el hilo completo repetido: el costo se
multiplica por mensaje y el modelo termina respondiéndole a un correo viejo. Cortar por
marcadores (`El ... escribió:`, `On ... wrote:`, `-----Mensaje original-----`,
`<div class="gmail_quote">`, `<blockquote>`) más heurística de líneas con `>`. Guardar
el crudo aparte por si hay que auditar qué se cortó.

**4. HTML → texto plano.** Con librería, no con regex casera. Y cuando el multipart trae
`text/plain` (la mayoría lo trae), usar ese y no adivinar.

**5. Entregabilidad.** Responder desde un dominio sin SPF/DKIM del cliente = carpeta de
spam, y el dueño concluye "esto no funciona". Es un paso de onboarding con un registro DNS,
igual que el método de pago del WABA: **hay que ponerlo en el formulario, no descubrirlo
con el cliente adentro.**

**6. Confirmación del reenvío.** Gmail manda un **código de confirmación** a la dirección
de destino antes de activar el reenvío. Ese correo llega al webhook. Si no se detecta y se
muestra en el portal, el onboarding se cuelga sin error visible y nadie sabe por qué.
**Esto hay que construirlo en F2, no descubrirlo en F5.**

**7. Ley 21.719 (1-dic-2026).** Un buzón trae datos personales de terceros que nunca
consintieron: currículums, reclamos, facturas con RUT. En WhatsApp la conversación la
inicia el titular; en correo, no siempre. Antes de leer el correo de un cliente hace falta
el **encargo de tratamiento firmado**. Esto es requisito de venta, no letra chica.

---

## 5. Lo único bueno que trae el correo (y es el argumento comercial)

**No hay ventana de 24 horas.** No hay plantillas que aprobar en Meta, no hay $85 por
mensaje de marketing, no hay método de pago del WABA. Beto y Vera pueden retomar una
cotización de hace tres semanas por correo, gratis, sin pedirle permiso a nadie.

Hoy Cecilia no puede retomar conversaciones viejas de ninguna forma desde que Impresora
migró a Cloud API. **Ese es el caso de uso que vende esto** — no "somos omnicanal".

---

## 6. Fases

| Fase | Qué | Depende de |
|---|---|---|
| **F0** | Subdominio `in.respon-do.com` + MX + elegir proveedor + dominio de envío aparte. Probar que un correo de prueba llega al webhook. **Sin escribir código.** | — |
| **F1** | Migración 290 + `ed_buzones` + `ed_mensaje_adjuntos`. Deploy antes que migración. | F0 |
| **F2** | `/api/correo/webhook` + `lib/inboundCorreo.ts` sobre `procesarConInbox`. **Solo ingesta**, sin responder. Incluye la detección del código de confirmación de reenvío. Probar con una casilla de Respondo. | F1 |
| **F3** | `/correo` en el portal, **solo lectura**. Iframe sandbox desde el día uno. | F2 |
| **F4** | Redactor + **modo borrador únicamente**. Nadie manda solo. | F3 |
| **F5** | Envío real vía `responderSiBot`, con filtro de autorespuestas y `presupuesto_dia`. | F4 |
| **F6** | Adjuntos, **en el cron, nunca en el webhook** (si el webhook tarda, el proveedor reintenta y duplica — misma lección que `archivarMedia`). | F5 |

---

## 7. La pregunta antes de F1

Al 2-sep no hay ningún cliente pagando. Están abiertos los dos circuitos de la cita y los
resultados, Supabase sigue en Free sin respaldos, Vercel Hobby prohíbe uso comercial y el
1-dic entra la 21.719. El correo **no apareció como objeción** en RS-Shop, Aleta, Mandalas
ni BIPAY.

Esta spec existe para que, el día que un prospecto ponga el correo como condición de
cierre, se construya en días y no se improvise. Antes de abrir F1:

> **¿Qué prospecto lo pidió, y era condición para firmar?**

Si la respuesta es "ninguno todavía", esto se queda acá escrito y no se toca.
