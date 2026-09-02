-- ============================================================================
-- 291 · QUE LAS ETIQUETAS SE ACTUALICEN SOLAS: DETECTOR DE CIERRE DE VENTA
-- ============================================================================
--
-- EL PROBLEMA (Marcelo, 2-sep-2026)
-- ---------------------------------
-- «No tiene sentido que diga "te espera" pero yo ya lo atendí, o que diga
-- "cotización" pero se cerró la venta.» Las etiquetas automáticas solo se
-- sumaban, nadie las quitaba; y `venta_confirmada` existía en ed_resultados
-- desde la migración 201 pero nada lo escribía en producción.
--
-- Esta migración da soporte a dos piezas nuevas del cron (lib/cierreVentas.ts
-- y lib/reconciliarEstados.ts):
--
--  1. `ed_contactos.cierre_revisado_en`: hasta qué mensaje el detector ya leyó
--     esta conversación. Sin esto, cada latido volvería a consultar al modelo
--     por las mismas conversaciones.
--  2. `ed_cierres_detectados`: bitácora de cada decisión del detector, con la
--     evidencia que citó. Misma razón que ed_reingresos (290): poder responder
--     "¿está funcionando?" con una consulta y no con una semana de sospecha.
--
-- La etiqueta nueva "pago_pendiente" (Falta pago) no necesita columna: vive
-- en `ed_contactos.etiquetas` (text[]) como las demás.
--
-- ⚠️ ADITIVA. Sin esto aplicado, el detector avisa por consola y no hace
-- nada (la columna no existe → la consulta de candidatos falla en silencio).
-- Se puede aplicar antes o después del despliegue.
-- ============================================================================

alter table ed_contactos
  add column if not exists cierre_revisado_en timestamptz;
comment on column ed_contactos.cierre_revisado_en is
  'Hasta qué mensaje (ultimo_mensaje_en) el detector de cierres ya revisó esta conversación.';

create table if not exists ed_cierres_detectados (
  id          bigint generated always as identity primary key,
  cliente_id  uuid        not null,
  chat_id     text        not null,
  -- Lo que quedó después de la reja: pagado | aprobado_sin_pago | abierto
  estado      text        not null,
  -- Lo que propuso el modelo antes de la reja (para ver cuánto rechaza).
  propuesta   text,
  -- Cita literal de la conversación que sostiene la decisión.
  evidencia   text,
  creado_en   timestamptz not null default now()
);

comment on table ed_cierres_detectados is
  'Cada revisión del detector de cierre de venta, con la decisión y su evidencia.';

create index if not exists idx_ed_cierres_chat
  on ed_cierres_detectados (cliente_id, chat_id, creado_en desc);
create index if not exists idx_ed_cierres_fecha
  on ed_cierres_detectados (creado_en desc);

alter table ed_cierres_detectados enable row level security;
-- Sin políticas a propósito: solo entra el servidor con service_role.

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'ed_contactos' and column_name = 'cierre_revisado_en') as col_contactos,
  (select count(*) from ed_cierres_detectados) as filas_bitacora;
