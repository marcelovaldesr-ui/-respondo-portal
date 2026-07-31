-- ============================================================================
-- 220_agenda.sql · Módulo de Agenda y Reservas (F0)
-- ----------------------------------------------------------------------------
-- Implementa la decisión agenda-first del 31-jul-2026 (ver
-- docs/SPEC_MODULO_AGENDA.md). 100% ADITIVA E INOCUA:
--   - Solo CREA tablas nuevas y AGREGA columnas con default en ed_clientes.
--   - NO modifica ninguna tabla, fila, trigger ni constraint existente.
--   - NO toca el flujo de Tino (webhook Evolution/WAHA, responderBot,
--     seguimientos): Impresora Color sigue funcionando exactamente igual.
--   - Es IDEMPOTENTE: se puede correr más de una vez sin daño.
--
-- APLICAR EN SUPABASE (SQL editor), después de la 216. Independiente de la
-- 214 (esa se necesita recién en F3 para recordatorio/confirmación de cita).
-- ============================================================================

-- Necesaria para el constraint anti doble-reserva (EXCLUDE ... USING gist con
-- igualdad por uuid). Extensión estándar de Postgres, disponible en Supabase.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1) Servicios reservables del negocio
-- ---------------------------------------------------------------------------
create table if not exists ed_servicios (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,
  nombre         text not null,             -- "Depilación axilas", "Clase de pilates"
  descripcion    text,
  duracion_min   int  not null default 30 check (duracion_min between 5 and 480),
  precio_clp     int,                       -- null = "según evaluación"
  -- cupo > 1 = clase grupal (gimnasios). F0-F3 operan con cupo = 1 (citas);
  -- el soporte grupal llega con la fase wellness. Se deja la columna para no
  -- migrar de nuevo.
  cupo           int  not null default 1 check (cupo between 1 and 100),
  requiere_abono boolean not null default false,
  activo         boolean not null default true,
  orden          int  not null default 0,
  creado_en      timestamptz not null default now()
);
create index if not exists idx_ed_servicios_cliente on ed_servicios(cliente_id);

-- ---------------------------------------------------------------------------
-- 2) Profesionales / recursos (la persona, la silla, el box, la sala)
-- ---------------------------------------------------------------------------
create table if not exists ed_profesionales (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references ed_clientes(id) on delete cascade,
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_ed_profesionales_cliente on ed_profesionales(cliente_id);

-- Qué servicios atiende cada profesional. Si un servicio NO tiene filas aquí,
-- la capa de código lo interpreta como "lo atiende cualquier profesional
-- activo del cliente" (así el onboarding mínimo no obliga a mapear todo).
create table if not exists ed_servicio_profesional (
  servicio_id     uuid not null references ed_servicios(id) on delete cascade,
  profesional_id  uuid not null references ed_profesionales(id) on delete cascade,
  primary key (servicio_id, profesional_id)
);

-- ---------------------------------------------------------------------------
-- 3) Horario semanal recurrente por profesional
--    desde/hasta son HORA LOCAL DE CHILE (time sin zona). La conversión a
--    instantes reales la hace lib/agendaCore.ts por fecha concreta, de modo
--    que el cambio de hora (sept/abril) no corre las agendas.
-- ---------------------------------------------------------------------------
create table if not exists ed_horarios (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references ed_profesionales(id) on delete cascade,
  dia_semana      int  not null check (dia_semana between 0 and 6),  -- 0 = domingo
  desde           time not null,
  hasta           time not null,
  check (desde < hasta)
);
create index if not exists idx_ed_horarios_prof on ed_horarios(profesional_id);

-- ---------------------------------------------------------------------------
-- 4) Bloqueos puntuales (feriado, vacaciones, hora personal)
-- ---------------------------------------------------------------------------
create table if not exists ed_bloqueos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  profesional_id  uuid references ed_profesionales(id) on delete cascade, -- null = todo el negocio
  desde           timestamptz not null,
  hasta           timestamptz not null,
  motivo          text,
  check (desde < hasta)
);
create index if not exists idx_ed_bloqueos_cliente on ed_bloqueos(cliente_id, desde);

-- ---------------------------------------------------------------------------
-- 5) Citas
-- ---------------------------------------------------------------------------
create table if not exists ed_citas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  servicio_id     uuid not null references ed_servicios(id),
  profesional_id  uuid not null references ed_profesionales(id),
  chat_id         text,                    -- teléfono WhatsApp del cliente final (null si reservó por web sin WhatsApp)
  nombre_contacto text not null,
  telefono        text,
  inicio          timestamptz not null,
  fin             timestamptz not null,
  estado          text not null default 'agendada' check (estado in
    ('agendada','confirmada','reagendada','cancelada','no_show','completada')),
  origen          text not null default 'whatsapp' check (origen in
    ('whatsapp','web','portal','importada')),
  empleado_id     uuid references ed_empleados(id),  -- qué empleado IA la agendó (si aplica)
  notas           text,
  gcal_event_id   text,                    -- F5 (Google Calendar)
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  check (inicio < fin),

  -- LA GARANTÍA CENTRAL: dos citas ACTIVAS del mismo profesional no pueden
  -- solaparse en el tiempo. Lo garantiza Postgres, no el código JS — inmune a
  -- carreras (web y WhatsApp reservando el mismo cupo en el mismo segundo).
  -- La capa de código traduce el error 23P01 (exclusion_violation) a
  -- {ok:false, motivo:'cupo_tomado'} y ofrece el siguiente cupo.
  constraint ed_citas_sin_solape exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado in ('agendada','confirmada','reagendada'))
);
create index if not exists idx_ed_citas_cliente_dia on ed_citas(cliente_id, inicio);
create index if not exists idx_ed_citas_chat on ed_citas(cliente_id, chat_id);
create index if not exists idx_ed_citas_prof on ed_citas(profesional_id, inicio);

-- ---------------------------------------------------------------------------
-- 6) Configuración de agenda por cliente (columnas nuevas, defaults inocuos:
--    con reservas_online=false y sin servicios cargados, NADA cambia para los
--    clientes actuales — Impresora Color queda exactamente igual).
-- ---------------------------------------------------------------------------
alter table ed_clientes add column if not exists slug text unique;
alter table ed_clientes add column if not exists reservas_online boolean not null default false;
alter table ed_clientes add column if not exists confirmacion_automatica boolean not null default true;
alter table ed_clientes add column if not exists anticipacion_min_horas int not null default 2;
alter table ed_clientes add column if not exists horizonte_dias int not null default 30;

-- ---------------------------------------------------------------------------
-- 7) RLS — misma segunda barrera que el resto del portal (202_rls.sql):
--    se niega todo al rol anon/authenticated; el portal opera con service_role
--    filtrando por cliente_id en código.
-- ---------------------------------------------------------------------------
alter table ed_servicios            enable row level security;
alter table ed_profesionales        enable row level security;
alter table ed_servicio_profesional enable row level security;
alter table ed_horarios             enable row level security;
alter table ed_bloqueos             enable row level security;
alter table ed_citas                enable row level security;
-- (sin policies = nadie fuera de service_role lee ni escribe)

-- ---------------------------------------------------------------------------
-- Verificación (debe devolver 6 tablas y 5 columnas)
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_name in ('ed_servicios','ed_profesionales','ed_servicio_profesional',
                          'ed_horarios','ed_bloqueos','ed_citas')) as tablas_agenda,
  (select count(*) from information_schema.columns
     where table_name = 'ed_clientes'
       and column_name in ('slug','reservas_online','confirmacion_automatica',
                           'anticipacion_min_horas','horizonte_dias')) as cols_config;
