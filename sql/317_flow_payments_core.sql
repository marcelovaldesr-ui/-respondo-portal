-- ============================================================================
-- 317 · FLOW PAYMENTS CORE (P0: Pagos reales Flow.cl)
-- ============================================================================
--
-- QUÉ AGREGA
-- ----------
-- 1. Credenciales de Flow.cl por tenant en `ed_clientes`:
--    - `flow_api_key`: API Key pública de Flow.
--    - `flow_secret_cifrado`: SecretKey de Flow cifrada con AES-256-GCM
--      (lib/cifrado.ts, propósito "flow-secret"). Nunca en texto plano.
--    - `flow_modo`: 'sandbox' (pruebas) o 'produccion'.
--    - `flow_estado`: estado de conexión con Flow.
--
-- 2. Extensión aditiva a `ed_pagos` (creada en 289, enriquecida en 294):
--    - `contacto_id`: identidad canónica del contacto (Guardrail 1).
--    - `proveedor`: 'manual' | 'flow'.
--    - `proveedor_orden`: ID numérico asignado por Flow (`flowOrder`).
--    - `proveedor_token`: Token temporal devuelto por `/payment/create`.
--    - `proveedor_url`: URL de checkout completa de Flow.
--    - `proveedor_datos`: JSON devuelto por `/payment/getStatus`.
--    - `proveedor_estado`: código de estado nativo de Flow (1, 2, 3, 4).
--    - `expira_en`: TTL de la orden.
--    - `tipo_transaccion`: categoría comercial del cobro.
--    - `metadata`: metadatos de contexto (idempotency key, etc.).
--    - Ampliación de estados válidos: 'rechazado' y 'expirado'.
--
-- 3. Tabla de eventos comerciales de dominio `ed_eventos_comerciales`:
--    - Permite registrar `PAYMENT_CONFIRMED` de forma desacoplada de publicidad
--      y sin sobrecargar `ed_resultados` ni `ed_ads_eventos` (Guardrail 3).
--    - Restricción única `(cliente_id, pago_id, tipo)` que garantiza
--      idempotencia estricta: un pago jamás emite dos veces el mismo evento.
--
-- ADITIVA E INERTE:
-- No destruye ningún pago histórico. Si un cliente no tiene Flow configurado,
-- el portal y los cobros manuales siguen operando exactamente igual que antes.
-- ============================================================================

begin;

-- ── 1. Credenciales Flow en ed_clientes ─────────────────────────────────────
alter table ed_clientes
  add column if not exists flow_api_key text,
  add column if not exists flow_secret_cifrado text,
  add column if not exists flow_modo text not null default 'sandbox'
    check (flow_modo in ('sandbox', 'produccion')),
  add column if not exists flow_estado text not null default 'no_configurado'
    check (flow_estado in ('no_configurado', 'conectado', 'error'));

comment on column ed_clientes.flow_api_key is
  'API Key de Flow.cl del negocio.';
comment on column ed_clientes.flow_secret_cifrado is
  'SecretKey de Flow.cl cifrada con AES-256-GCM (proposito "flow-secret").';
comment on column ed_clientes.flow_modo is
  'Ambiente Flow del negocio: sandbox (pruebas) o produccion.';

-- ── 2. Extensión de ed_pagos ────────────────────────────────────────────────
alter table ed_pagos
  add column if not exists contacto_id uuid references ed_contactos(id) on delete set null,
  add column if not exists proveedor text not null default 'manual'
    check (proveedor in ('manual', 'flow')),
  add column if not exists proveedor_orden text,
  add column if not exists proveedor_token text,
  add column if not exists proveedor_url text,
  add column if not exists proveedor_datos jsonb,
  add column if not exists proveedor_estado int,
  add column if not exists expira_en timestamptz,
  add column if not exists tipo_transaccion text not null default 'cobro_general'
    check (tipo_transaccion in (
      'cobro_general',
      'anticipo_cita',
      'pago_total_cita',
      'inscripcion_clase',
      'compra_membresia',
      'renovacion_membresia',
      'pack_creditos'
    )),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Ampliación de estados de ed_pagos (añadir 'rechazado' y 'expirado')
alter table ed_pagos drop constraint if exists ed_pagos_estado_check;
alter table ed_pagos add constraint ed_pagos_estado_check
  check (estado in ('pendiente', 'pagado', 'anulado', 'rechazado', 'expirado'));

-- Índice único por token de proveedor para resolución inmediata en webhooks
create unique index if not exists idx_ed_pagos_proveedor_token
  on ed_pagos (proveedor, proveedor_token)
  where proveedor_token is not null;

-- Índice para búsquedas por contacto canónico
create index if not exists idx_ed_pagos_contacto
  on ed_pagos (cliente_id, contacto_id)
  where contacto_id is not null;

-- Índice para conciliación y pagos pendientes Flow
create index if not exists idx_ed_pagos_flow_pendientes
  on ed_pagos (cliente_id, proveedor, estado)
  where estado = 'pendiente';

-- ── 3. Tabla de Eventos Comerciales de Dominio ─────────────────────────────
create table if not exists ed_eventos_comerciales (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references ed_clientes(id) on delete cascade,
  tipo             text not null, -- Ej: 'PAYMENT_CONFIRMED'
  pago_id          uuid references ed_pagos(id) on delete cascade,
  contacto_id      uuid references ed_contactos(id) on delete set null,
  monto            int not null check (monto > 0),
  moneda           text not null default 'CLP',
  proveedor        text not null default 'flow',
  proveedor_orden  text,
  chat_id          text,
  payload          jsonb not null default '{}'::jsonb,
  creado_en        timestamptz not null default now(),

  -- Idempotencia estricta: un mismo pago solo emite exactamente una vez cada tipo de evento
  constraint uq_ed_eventos_comerciales_pago_tipo unique (cliente_id, pago_id, tipo)
);

create index if not exists idx_ed_eventos_comerciales_cliente
  on ed_eventos_comerciales (cliente_id, creado_en desc);
create index if not exists idx_ed_eventos_comerciales_tipo
  on ed_eventos_comerciales (tipo, creado_en desc);

alter table ed_eventos_comerciales enable row level security;
-- Solo el backend con service_role interactúa con esta tabla

commit;
