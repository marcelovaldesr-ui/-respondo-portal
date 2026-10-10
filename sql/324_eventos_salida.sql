-- 324 · Cola de eventos de salida (webhook hacia el sistema de Kambak)
-- Idempotente. NO se aplica solo: la aplica un humano en Supabase.
-- Cada evento se entrega firmado; si falla, se reintenta con espera creciente
-- y, agotados los intentos, queda en estado 'fallido' (la "bandeja de fallidos").
-- Al entregarse bien, el contenido (payload) se borra.

create table if not exists ed_eventos_salida (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references ed_clientes(id) on delete cascade,
  clave            text not null,            -- evita duplicar el mismo evento (Meta reintenta webhooks)
  tipo             text not null check (tipo in ('message.status','message.inbound','contact.optout')),
  payload          jsonb,                    -- se vacía al entregarse
  estado           text not null default 'pendiente' check (estado in ('pendiente','enviado','fallido')),
  intentos         integer not null default 0,
  proximo_intento  timestamptz not null default now(),
  ultimo_error     text,
  creado_en        timestamptz not null default now(),
  entregado_en     timestamptz,
  unique (cliente_id, clave)
);

create index if not exists ed_eventos_salida_pend_idx
  on ed_eventos_salida (proximo_intento) where estado = 'pendiente';
create index if not exists ed_eventos_salida_fallidos_idx
  on ed_eventos_salida (cliente_id, creado_en) where estado = 'fallido';

alter table ed_eventos_salida enable row level security;  -- deny-all: solo service_role

-- Rollback: drop table if exists ed_eventos_salida;
-- Ver fallidos: select id, tipo, intentos, ultimo_error, creado_en from ed_eventos_salida where estado = 'fallido' order by creado_en desc;
