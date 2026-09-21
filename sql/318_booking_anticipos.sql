-- ============================================================================
-- 318 · BOOKING ANTICIPOS & HOLD TEMPORAL (P1)
-- ============================================================================
-- QUÉ AGREGA:
-- 1. Feature Flag en ed_clientes:
--    - `commerce_booking_v1_activo`: habilita el flujo de anticipos y membresías.
--
-- 2. Configuración de anticipo en ed_servicios:
--    - `requiere_anticipo`: boolean indicando si el servicio exige pago previo.
--    - `anticipo_monto_fijo`: monto en CLP a cobrar como anticipo fijo.
--
-- 3. Extensión de ed_citas para hold de 15 minutos:
--    - Ampliación de estados: 'pendiente_pago', 'expirada', 'requiere_atencion'.
--    - `hold_expira_en`: timestamptz de expiración del bloqueo temporal (TTL 15 min).
--    - `anticipo_pagado`: boolean que acredita el cobro del anticipo.
--    - `pago_id`: referencia al cobro en ed_pagos.
--    - `requiere_atencion`: flag cuando hubo pago confirmado pero el horario ya no está disponible.
--    - `motivo_atencion`: descripción para staff/reubicación manual.
--
-- 4. Constraint anti-solape actualizado:
--    - 'pendiente_pago' reserva activamente el horario mientras dure el hold.
--
-- ADITIVA E INERTE:
-- No modifica citas existentes ni afecta a clientes sin el flag activo.
-- ============================================================================

begin;

-- 1. Feature Flag en ed_clientes
alter table ed_clientes
  add column if not exists commerce_booking_v1_activo boolean not null default false;

comment on column ed_clientes.commerce_booking_v1_activo is
  'Flag de activación de Respondo Commerce & Booking V1 (anticipos, membresías, clases).';

-- 2. Configuración de anticipo en ed_servicios
alter table ed_servicios
  add column if not exists requiere_anticipo boolean not null default false,
  add column if not exists anticipo_monto_fijo int check (anticipo_monto_fijo is null or anticipo_monto_fijo > 0);

comment on column ed_servicios.requiere_anticipo is
  'Si true, el servicio requiere pago de anticipo para confirmar la reserva.';
comment on column ed_servicios.anticipo_monto_fijo is
  'Monto fijo en CLP exigido como anticipo (V1 monto fijo).';

-- 3. Extensión de ed_citas para hold temporal
alter table ed_citas
  add column if not exists hold_expira_en timestamptz,
  add column if not exists anticipo_pagado boolean not null default false,
  add column if not exists pago_id uuid references ed_pagos(id) on delete set null,
  add column if not exists requiere_atencion boolean not null default false,
  add column if not exists motivo_atencion text;

-- Ampliación de estados válidos de ed_citas
alter table ed_citas drop constraint if exists ed_citas_estado_check;
alter table ed_citas add constraint ed_citas_estado_check check (
  estado in (
    'agendada',
    'confirmada',
    'reagendada',
    'cancelada',
    'no_show',
    'completada',
    'pendiente_pago',
    'expirada',
    'requiere_atencion'
  )
);

-- 4. Actualización del constraint anti-solape en ed_citas
-- Incluye 'pendiente_pago' para bloquear el slot durante el TTL del hold
alter table ed_citas drop constraint if exists ed_citas_sin_solape;
alter table ed_citas add constraint ed_citas_sin_solape exclude using gist (
  profesional_id with =,
  tstzrange(inicio, fin) with &&
) where (
  clase_id is null and
  estado in ('agendada', 'confirmada', 'reagendada', 'pendiente_pago')
);

-- Índice para barrido de holds expirados en cron
create index if not exists idx_ed_citas_holds_expirados
  on ed_citas (cliente_id, hold_expira_en)
  where estado = 'pendiente_pago';

commit;
