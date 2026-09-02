-- ============================================================================
-- 290 · BITÁCORA DEL VIGILANTE: QUÉ MIRÓ Y QUÉ DECIDIÓ, CHAT POR CHAT
-- ============================================================================
--
-- POR QUÉ EXISTE
-- --------------
-- El 2-sep-2026 se descubrió que el vigilante de conversaciones abandonadas
-- (lib/reingresoTino.ts) llevaba una semana encendido para Impresora Color,
-- había "revisado" 94 conversaciones y había callado en las 94 — por un bug de
-- parseo, no por criterio. Nadie lo notó porque no había dónde mirar: la única
-- huella era `ed_chat_estado.reingreso_en` (una fecha) y un conteo en la
-- respuesta del cron que se pierde al instante.
--
-- Esta tabla guarda cada decisión, incluidas las de callar y su motivo. Con
-- ella, "¿está funcionando el vigilante?" se responde con una consulta:
--
--   select accion, motivo, count(*) from ed_reingresos
--    where creado_en > now() - interval '7 days' group by 1, 2 order by 3 desc;
--
-- ⚠️ ES ADITIVA Y OPCIONAL. El código escribe acá en modo best-effort: si la
-- tabla no existe, avisa por consola y sigue. Se puede aplicar antes o después
-- del despliegue.
-- ============================================================================

create table if not exists ed_reingresos (
  id                 bigint generated always as identity primary key,
  cliente_id         uuid        not null,
  empleado_id        uuid        not null,
  chat_id            text        not null,
  -- Cuánto llevaba esperando el cliente cuando se revisó.
  minutos_esperando  int         not null,
  -- responder | preguntar | callar
  accion             text        not null,
  -- Categoría propuesta por el modelo (aunque la reja la haya rechazado).
  categoria          text,
  -- Solo cuando accion = callar: por qué.
  motivo             text,
  -- Lo que se mandó — o lo que el modelo propuso y NO se mandó, si calló.
  texto              text,
  creado_en          timestamptz not null default now()
);

comment on table ed_reingresos is
  'Cada revisión del vigilante de conversaciones abandonadas, con su decisión y motivo.';

-- Consultas típicas: "qué pasó con este chat" y "qué pasó esta semana".
create index if not exists idx_ed_reingresos_chat
  on ed_reingresos (cliente_id, chat_id, creado_en desc);
create index if not exists idx_ed_reingresos_fecha
  on ed_reingresos (creado_en desc);

-- Solo el servidor (service_role) escribe y lee esto. Misma política que el
-- resto de tablas internas: sin acceso anónimo.
alter table ed_reingresos enable row level security;

-- ── Verificación ────────────────────────────────────────────────────────────
select count(*) as filas from ed_reingresos;
