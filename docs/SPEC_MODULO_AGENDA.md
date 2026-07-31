# SPEC · Módulo de Agenda y Reservas Online — respondo-portal

**Fecha:** 31-jul-2026 · **Decisión que implementa:** reunión de equipo 31-jul (agenda-first: 4 empleados IA + calendario/reservas en una plataforma, para clínicas, centros de estética, barberías/spa, kine y gimnasios de clases).

**Principio rector:** la agenda NO es un producto aparte — es lo que convierte `accion: "agendar"` (que hoy el motor emite y nadie ejecuta) en una cita real. El empleado IA sigue siendo el protagonista; la agenda es su herramienta de trabajo.

---

## 0. Qué existe hoy (verificado en el código, 31-jul)

| Pieza | Estado | Relevancia para la agenda |
|---|---|---|
| Contrato JSON del motor (`promptEmpleado.ts`) | `accion ∈ null\|"agendar"\|"cotizar"\|"registrar_lead"\|"seguimiento"` | **El gancho ya existe.** Hoy Tino "ofrece 2 horarios" inventándolos desde el texto de `ed_conocimiento`. Hay que darle disponibilidad real. |
| `ed_seguimientos` + cron + `lib/seguimientos.ts` | Funcionando (horario hábil Chile, tope diario, `no_contactar`, max_intentos, ruteo del inbound al empleado del seguimiento) | Recordatorios y confirmaciones de cita se montan AQUÍ, no en un sistema nuevo. |
| Migración `214_seguimientos_tipos.sql` | Escrita, ⚠ pendiente de aplicar | Ya agrega `recordatorio_cita`, `confirmacion_cita`, `encuesta_postventa`. |
| Transporte pluggable (`responderBot.ts` → `enviar`, `216_transporte_cliente.sql`) | Funcionando | Las confirmaciones salen por WAHA hoy y por Cloud API mañana sin tocar la lógica. |
| `lib/fechas.ts` (ZONA America/Santiago) | Funcionando, con bugs de UTC ya resueltos | TODA la generación de slots usa este patrón. Ninguna fecha se calcula en UTC "a mano". |
| Aislamiento multi-cliente (código + `portal_usuarios`) | Verificado | Toda tabla nueva lleva `cliente_id` y se filtra igual que el resto. |
| `ed_contactos` (etiquetas), `ed_resultados`, `ed_metricas` | Funcionando | La cita alimenta resultados/métricas existentes; no se inventan contadores nuevos. |
| Plantillas de rubro (`plantillasRubro.ts`) | Funcionando | Cada rubro nuevo trae también servicios/duraciones de ejemplo para demos. |

---

## 1. Modelo de datos — migración `220_agenda.sql`

Aditiva e inocua como las anteriores. Todo en el schema por defecto junto al resto de `ed_`.

```sql
-- Extensión para impedir dobles reservas a nivel de base de datos
create extension if not exists btree_gist;

-- 1) Servicios que se pueden reservar
create table if not exists ed_servicios (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references ed_clientes(id) on delete cascade,
  nombre        text not null,             -- "Depilación axilas", "Clase de pilates"
  descripcion   text,
  duracion_min  int  not null default 30 check (duracion_min between 5 and 480),
  precio_clp    int,                       -- null = "según evaluación"
  cupo          int  not null default 1,   -- >1 = clase grupal (gimnasios)
  requiere_abono boolean not null default false,
  activo        boolean not null default true,
  orden         int not null default 0,
  creado_en     timestamptz not null default now()
);
create index if not exists idx_ed_servicios_cliente on ed_servicios(cliente_id);

-- 2) Profesionales / recursos (la "silla", el "box", la "sala")
create table if not exists ed_profesionales (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references ed_clientes(id) on delete cascade,
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_ed_profesionales_cliente on ed_profesionales(cliente_id);

-- Qué servicios atiende cada profesional (null en profesional_id = cualquiera)
create table if not exists ed_servicio_profesional (
  servicio_id     uuid not null references ed_servicios(id) on delete cascade,
  profesional_id  uuid not null references ed_profesionales(id) on delete cascade,
  primary key (servicio_id, profesional_id)
);

-- 3) Horario semanal recurrente por profesional (patrón simple, entendible)
create table if not exists ed_horarios (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references ed_profesionales(id) on delete cascade,
  dia_semana      int  not null check (dia_semana between 0 and 6),  -- 0=domingo
  desde           time not null,           -- hora LOCAL Chile (ej. 10:00)
  hasta           time not null,
  check (desde < hasta)
);
create index if not exists idx_ed_horarios_prof on ed_horarios(profesional_id);

-- 4) Bloqueos puntuales (feriado, vacaciones, almuerzo extendido)
create table if not exists ed_bloqueos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  profesional_id  uuid references ed_profesionales(id) on delete cascade, -- null = todo el negocio
  desde           timestamptz not null,
  hasta           timestamptz not null,
  motivo          text,
  check (desde < hasta)
);
create index if not exists idx_ed_bloqueos_cliente on ed_bloqueos(cliente_id);

-- 5) Citas
create table if not exists ed_citas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  servicio_id     uuid not null references ed_servicios(id),
  profesional_id  uuid not null references ed_profesionales(id),
  chat_id         text,                    -- teléfono WhatsApp del cliente final (nullable: reserva web sin WhatsApp)
  nombre_contacto text not null,
  telefono        text,
  inicio          timestamptz not null,
  fin             timestamptz not null,
  estado          text not null default 'agendada' check (estado in
    ('agendada','confirmada','reagendada','cancelada','no_show','completada')),
  origen          text not null default 'whatsapp' check (origen in
    ('whatsapp','web','portal','importada')),   -- quién la creó: empleado IA, página pública, dueño, migración
  empleado_id     uuid references ed_empleados(id),  -- qué empleado IA la agendó (si aplica)
  notas           text,
  gcal_event_id   text,                    -- Fase 5 (Google Calendar)
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  check (inicio < fin),

  -- LA GARANTÍA CENTRAL: dos citas activas del mismo profesional no pueden
  -- solaparse. Lo garantiza Postgres, no el código — inmune a carreras
  -- (dos clientes reservando el mismo cupo a la vez por web y WhatsApp).
  constraint ed_citas_sin_solape exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('agendada','confirmada','reagendada'))
);
create index if not exists idx_ed_citas_cliente_dia on ed_citas(cliente_id, inicio);
create index if not exists idx_ed_citas_chat on ed_citas(cliente_id, chat_id);
```

**Nota clases grupales (gimnasios):** para `cupo > 1` el EXCLUDE por profesional no aplica tal cual (la "clase" admite N personas). Fase 1–3 soporta cupo=1 (citas). El cupo grupal se activa en la fase de gimnasios: la clase se modela como cita "contenedora" (una fila por asistente + conteo contra `cupo` en la RPC de reserva). No bloquea el diseño.

**Config del cliente (columnas nuevas en `ed_clientes`):**

```sql
alter table ed_clientes add column if not exists slug text unique;             -- respondo.cl/reservar/estetica-aurora
alter table ed_clientes add column if not exists reservas_online boolean not null default false;
alter table ed_clientes add column if not exists confirmacion_automatica boolean not null default true;  -- false = el dueño aprueba cada reserva web
alter table ed_clientes add column if not exists anticipacion_min_horas int not null default 2;          -- no reservar con menos de X horas
alter table ed_clientes add column if not exists horizonte_dias int not null default 30;                 -- hasta cuántos días adelante
```

**RLS:** replicar el patrón de `202_rls.sql` sobre las 6 tablas nuevas (segunda barrera; el aislamiento primario sigue siendo por código con `cliente_id`).

---

## 2. La librería central: `lib/agenda.ts`

Un solo módulo con el **contrato de acciones** — la interfaz que después reimplementa el adaptador AgendaPro (Fase 6) sin tocar a los empleados:

```ts
export interface AccionesAgenda {
  listarServicios(clienteId): Promise<Servicio[]>;
  disponibilidad(clienteId, servicioId, desde, hasta): Promise<Slot[]>;
  crearCita(params): Promise<{ ok: true; cita: Cita } | { ok: false; motivo: "cupo_tomado" | ... }>;
  reagendar(citaId, nuevoInicio): Promise<...>;
  cancelar(citaId, motivo): Promise<...>;
  citasDe(clienteId, chatId): Promise<Cita[]>;       // las citas de ESTE contacto
  marcarEstado(citaId, estado): Promise<...>;         // confirmada / no_show / completada
}
```

Reglas de implementación (las que ya costó aprender en el portal):

1. **Slots siempre en hora de Chile** con el patrón `Intl` de `lib/fechas.ts`. El horario semanal (`ed_horarios.desde/hasta`) es hora local; la conversión a `timestamptz` se hace por fecha concreta (así el cambio de hora de septiembre no corre las agendas).
2. **`crearCita` es una RPC de Postgres** (`insert` directo confiando en el EXCLUDE): si el constraint rechaza, se devuelve `cupo_tomado` y el empleado ofrece el siguiente slot. Nunca "verificar y luego insertar" en dos pasos desde JS.
3. Disponibilidad = horario semanal − bloqueos − citas activas − `anticipacion_min_horas`, cortada en pasos de `duracion_min`, dentro del `horizonte_dias`.
4. Todo filtrado por `cliente_id` (patrón `db.ts`), sin excepciones.

---

## 3. Cómo agendan los empleados IA (el corazón del módulo)

**Decisión de diseño: inyección de disponibilidad + validación server-side.** NO se monta un loop de function-calling (cambiaría `generarJSON` y toda la auditoría de Tino ya hecha). Se mantiene el ciclo actual de UNA llamada al modelo:

### 3.1 Entrada — bloque nuevo en el prompt (`promptEmpleado.ts`)

Cuando el cliente tiene agenda activa, `armarPrompt` agrega después del CONOCIMIENTO:

```
## AGENDA REAL (usa SOLO estos datos para agendar)
Servicios reservables:
- [svc:a1b2] Depilación axilas · 30 min · $15.000
- [svc:c3d4] Limpieza facial · 50 min · $25.000
Próximos cupos disponibles (hora de Chile):
- [slot:2026-08-03T15:00] lunes 3 ago, 15:00 (Carla)
- [slot:2026-08-03T16:30] lunes 3 ago, 16:30 (Carla)
- [slot:2026-08-04T10:00] martes 4 ago, 10:00 (María)
… (máx. 8 slots, 2–3 días distintos)
REGLAS DE AGENDA: ofrece máximo 2-3 cupos concretos de esta lista. Si el cliente
pide otro día/hora que no está aquí, di qué días cercanos SÍ tienes y ofrece.
NUNCA inventes un horario que no esté en la lista. Para agendar necesitas:
servicio + cupo elegido + nombre. El teléfono ya lo tienes (es este chat).
```

El costo extra de prompt es ~300 tokens. Los ids cortos (`svc:`/`slot:`) evitan que el modelo transcriba mal fechas.

### 3.2 Salida — el contrato JSON crece UNA llave

```json
{"respuesta": "...", "escalar": false, "accion": "agendar",
 "cita": {"servicio": "a1b2", "slot": "2026-08-03T15:00", "nombre": "Camila"}}
```

`accion: "agendar"` **sin** `cita` completa = el empleado sigue conversando (le falta un dato). Con `cita` completa = intención de reservar.

### 3.3 Ejecución en `responderBot.ts` (después de las anti-carreras existentes)

1. Validar que `servicio` y `slot` existen en lo que se le ofreció (nunca confiar en el texto del modelo).
2. `crearCita(...)` vía RPC. Si **ok** → se envía la respuesta del modelo + una línea de confirmación generada por código (fecha/hora formateada con `fechas.ts`, no por el modelo): *"✅ Listo, quedó reservado: Depilación axilas · lun 3 ago, 15:00 con Carla."* Y se programan los seguimientos (ver §4).
3. Si **cupo_tomado** (otro cliente ganó la carrera) → NO se envía la respuesta del modelo; se responde con código: *"¡Uy! Ese cupo se tomó recién 🙈 Te quedan estos: …"* con los 2 siguientes slots libres.
4. La cita registra `empleado_id`, `origen: 'whatsapp'`, `chat_id` → alimenta `ed_resultados` (tipo `agendamiento`, ya existe en el motor) y la tarjeta de Tino en `/inicio`.
5. **Reagendar/cancelar por WhatsApp:** si el contacto tiene citas activas (`citasDe`), el prompt incluye un bloque "CITAS VIGENTES DE ESTE CLIENTE" y el contrato acepta `accion: "reagendar" | "cancelar_cita"` con la misma mecánica.

**Regla de identidad intacta:** el empleado nunca dice "el sistema", "la plataforma": *"te agendé"*, *"te lo cambio altiro"*. La agenda es invisible; el empleado es quien trabaja.

---

## 4. Confirmación, recordatorio, no-show (lo que paga el ticket)

Todo sobre `ed_seguimientos` + cron existente. Al crear una cita se programan **por código**:

| Momento | Tipo (migración 214) | Mensaje (plantilla, no LLM) | Al responder |
|---|---|---|---|
| T−24h (si la cita se creó antes) | `confirmacion_cita` | "Hola {nombre} 👋 Te esperamos mañana {fecha} para tu {servicio}. ¿Confirmas? Responde SÍ o CAMBIAR." | "sí/confirmo" → `estado='confirmada'` (detección por código, sin LLM). "cambiar/no puedo" → entra el empleado con el bloque de agenda y reagenda. |
| T−3h | `recordatorio_cita` | "Te esperamos hoy a las {hora} 🙌 {dirección}" | — |
| T+2h después de `fin` | `encuesta_postventa` (**Vera**) | plantilla actual de Vera | flujo NPS existente |

- Si la cita nunca se confirmó y no llegó → el dueño la marca `no_show` en el portal (un toque) → se etiqueta el contacto y **Beto** la toma en su flujo de reactivación (*"¿te reagendo?"*). El no-show deja de ser plata perdida y pasa a ser cola de trabajo de Beto.
- Cancelada por el cliente → seguimiento de Beto a los 3 días para reagendar.
- Respetar como siempre: horario hábil, tope diario, `no_contactar`.
- **Ventana 24h de WhatsApp:** por WAHA no hay restricción; por Cloud API la confirmación T−24h típicamente cae fuera de ventana → requiere plantilla Meta aprobada (`plantilla_meta` ya existe en el esquema; registrar plantillas `confirmacion_cita` y `recordatorio_cita` cuando se active la Opción B — dato: los mensajes de utilidad DENTRO de ventana son gratis desde jul-2025).

**Métricas nuevas en `/inicio`** (misma tabla `ed_metricas`, columnas nuevas o `ed_resultados`): citas agendadas por empleado, % confirmadas, no-shows evitados (confirmadas/total), citas recuperadas por Beto. Es el número que justifica los $150–250k/mes.

---

## 5. Página pública de reservas — `app/(publico)/reservar/[slug]`

La pieza que abre el mercado "busco agenda online, no chatbot".

- **Sin login.** Server component + client widget. Se resuelve el cliente por `slug` (solo si `reservas_online = true`; si no, 404).
- Flujo: elegir servicio → elegir día (calendario del `horizonte_dias`) → elegir hora (slots reales de `disponibilidad()`) → nombre + teléfono → reservar.
- La reserva entra por la **misma RPC** `crearCita` (`origen: 'web'`) — mismo EXCLUDE, cero dobles reservas entre web y WhatsApp.
- Si `confirmacion_automatica = false`: queda `agendada` y el dueño aprueba desde el portal (aparece en "Te esperan").
- Tras reservar: pantalla de éxito + **botón wa.me al número del negocio** con texto precargado ("Hola, soy {nombre}, acabo de reservar {servicio} para el {fecha}") → la reserva web siembra la conversación de WhatsApp donde viven Tino/Beto/Vera. **Este es el puente estratégico**: el canal de reservas alimenta el canal conversacional.
- Anti-abuso: rate-limit por IP en la ruta (patrón simple en memoria/upstash), honeypot en el form, y tope de N reservas activas por teléfono.
- Branding: logo/colores del negocio (columna `ed_clientes.color_marca` opcional) + "Reservas por Respondo" al pie (loop de adquisición: cada página pública es un aviso).
- QR: en `/informacion` el dueño descarga el QR de su página (misma utilidad del generador QR ya hecho para la web).

---

## 6. Portal del dueño

1. **`/agenda` (página nueva):** vista día/semana de citas (server component + tabla simple primero, sin librería de calendario pesada), crear cita manual (`origen: 'portal'`), marcar confirmada / no-show / completada, bloquear horario. Mobile-first: el dueño la mira desde el celular.
2. **`/informacion` crece:** pestaña "Agenda": CRUD de servicios (nombre, duración, precio, cupo), profesionales y su horario semanal, toggle reservas online + slug, link y QR de la página pública.
3. **`/inicio`:** tarjeta de Tino suma "Citas agendadas"; tarjeta nueva de agenda con confirmadas vs no-show.
4. Plantillas de rubro (`plantillasRubro.ts`): cada rubro suma `servicios` de ejemplo (estética: axilas 30min/$15k…; barbería: corte 30min/$8k; kine: sesión 45min; pilates: clase cupo 8) → la demo del prospecto muestra la agenda funcionando con datos coherentes.

---

## 7. Fases de implementación (cada una entregable y vendible por sí sola)

| Fase | Contenido | Depende de | Tamaño* |
|---|---|---|---|
| **F0** | Migración `220_agenda.sql` + aplicar la 214 pendiente + `lib/agenda.ts` con tests de disponibilidad (casos: cambio de hora sept-2026, bloqueos, carrera de doble reserva) | — | 1 sesión |
| **F1** | Página pública `/reservar/[slug]` + config en `/informacion` (servicios, profesionales, horarios, toggle) | F0 | 1–2 sesiones |
| **F2** | Empleados agendan por WhatsApp (bloque de prompt + llave `cita` + ejecución en `responderBot`) + reagendar/cancelar | F0 | 1–2 sesiones |
| **F3** | Confirmación T−24h, recordatorio T−3h, no-show → Beto, encuesta → Vera + métricas en `/inicio` | F0 (cron ya existe) | 1 sesión |
| **F4** | `/agenda` del dueño (vista, cita manual, estados) | F0 | 1 sesión |
| **F5** | Google Calendar: export de citas (evento por cita, `gcal_event_id`) + import free/busy a `disponibilidad()`. ⚠ **Iniciar la verificación OAuth de Google YA** (demora semanas; scope `calendar.events`; mientras tanto funciona en modo test con los correos del equipo) | F0 | 1–2 sesiones |
| **F6** | Adaptador AgendaPro: `AccionesAgenda` contra su API (cliente necesita plan Pro; webhooks disponibles) → "tu empleado IA sobre tu AgendaPro de siempre" | F2 | 2 sesiones |

\* "Sesión" = una sesión de implementación de Claude con revisión de Marcelo, según la regla del proyecto (no estimar en horas de Marcelo).

**Orden comercial recomendado:** F0→F2→F3 primero (el pitch del empleado que agenda y confirma queda completo para las demos de Tomás), F1 enseguida (abre el mercado "agenda online"), F4–F6 según lo pidan los clientes que ya pagan (regla de oro).

## 8. Qué NO hace este módulo (a propósito)

- No cobra abonos ni integra pasarelas (Webpay/MercadoPago) — se anota como fase futura cuando un cliente pagando lo pida; `requiere_abono` solo muestra el texto de política.
- No hace membresías/planes recurrentes (gimnasios de membresía) — fase wellness 2027.
- No maneja tarifas por noche ni PMS (hoteles con PMS = cancha de WeSpeak, decisión 31-jul).
- No sincroniza bidireccional "en vivo" con Google Calendar en F5 (export + free/busy basta; el 2-way completo es un pozo de complejidad).
- No agrega un builder visual de flujos: el flujo ES el empleado conversando.

## 9. Riesgos técnicos y sus respuestas

| Riesgo | Respuesta |
|---|---|
| Doble reserva web/WhatsApp simultánea | EXCLUDE constraint en Postgres (no lógica JS) + manejo de `cupo_tomado` en ambos canales |
| El modelo inventa horarios | Solo puede elegir ids `slot:` de la lista inyectada; validación server-side; la confirmación final la redacta código, no el modelo |
| Fechas corridas por UTC (ya pasó en el portal) | Todo por `lib/fechas.ts`/Intl con America/Santiago; tests de F0 cubren el cambio de hora de septiembre |
| Confirmaciones fuera de ventana 24h en Cloud API | Plantillas Meta registradas cuando se active Opción B; por WAHA no aplica |
| Prompt crece y Tino se marea | Bloque de agenda acotado (8 slots máx); si el cliente no tiene agenda activa, el bloque no se inyecta y nada cambia |
| Verificación OAuth de Google demora | Se inicia YA aunque F5 sea posterior; modo test suficiente para demos |
