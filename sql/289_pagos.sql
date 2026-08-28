-- ============================================================================
-- 289 · COBRAR DENTRO DE LA CONVERSACIÓN
-- ============================================================================
--
-- LA APUESTA
-- ----------
-- Es la función que convirtió a Vita en «el equipo que opera tu centro» y le
-- permitió cobrar $199.990–$699.990: la conversación no termina en «te paso los
-- datos», termina en plata. En el plan de plataforma está como Ola 1.
--
-- El caso real que la valida: Cecilia dicta los datos de transferencia A MANO
-- (90 veces en un mes de mensajes) y después persigue el comprobante.
--
-- QUÉ ES (v1): el negocio configura UNA VEZ su enlace de pago (Mercado Pago,
-- Flow, Getnet — todos permiten crear un link sin API). Desde la bandeja se
-- cobra con monto + concepto: sale un mensaje con el enlace y una referencia
-- P-XXXXXX, y queda una fila con estado. NO somos pasarela: la plata va directo
-- del cliente final al negocio, sin tocarnos — cero regulación financiera.
--
-- ⚠️ INERTE POR DISEÑO: sin `pago_link_base` configurado, el botón Cobrar
-- explica qué falta y no hace nada. Aplicar esta migración no cambia el
-- comportamiento de ningún cliente.
-- ============================================================================

alter table ed_clientes
  add column if not exists pago_link_base text;
comment on column ed_clientes.pago_link_base is
  'Enlace de pago del negocio (Mercado Pago/Flow/Getnet). Sin él, Cobrar está apagado.';

create table if not exists ed_pagos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references ed_clientes(id) on delete cascade,
  empleado_id  uuid not null references ed_empleados(id) on delete cascade,
  chat_id      text not null,
  -- Referencia legible P-XXXXXX: une el mensaje de WhatsApp, esta fila y la
  -- transferencia que el negocio ve llegar a su cuenta. UNIQUE por cliente.
  referencia   text not null,
  monto        int  not null check (monto > 0),
  concepto     text not null,
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','pagado','anulado')),
  creado_por   text,          -- email de quien cobró
  creado_en    timestamptz not null default now(),
  pagado_en    timestamptz,
  anulado_en   timestamptz,
  unique (cliente_id, referencia)
);

alter table ed_pagos enable row level security;
-- Sin políticas a propósito: solo entra el servidor con service_role. El
-- aislamiento es por código, como en todo el portal (auditoría 11-ago-2026).

-- La consulta de siempre: los cobros de UNA conversación, y los pendientes de
-- un cliente para el panel.
create index if not exists idx_ed_pagos_chat
  on ed_pagos (cliente_id, chat_id, creado_en desc);
create index if not exists idx_ed_pagos_pendientes
  on ed_pagos (cliente_id, creado_en desc)
  where estado = 'pendiente';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name='ed_clientes' and column_name='pago_link_base') as col_link,
  (select count(*) from information_schema.tables
    where table_name='ed_pagos') as tabla_pagos;
