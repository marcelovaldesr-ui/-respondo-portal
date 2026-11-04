-- 329 · Cola de la COPIA de eventos hacia BrainRoot (3-nov-2026)
-- Idempotente. NO se aplica sola: la aplica un humano en Supabase.
-- Gemela de ed_eventos_salida (324) pero aparte, para que BrainRoot y Kambak
-- tengan colas y reintentos independientes: si uno falla, el otro ni se entera.
-- Sin esta tabla el portal igual intenta entregar cada evento una vez (sin reintentos).

create table if not exists ed_eventos_brainroot (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references ed_clientes(id) on delete cascade,
  clave            text not null,            -- evita duplicar el mismo evento (Meta reintenta webhooks)
  tipo             text not null check (tipo in ('message.status','message.inbound','contact.optout','message.outbound')),
  payload          jsonb,                    -- se vacía al entregarse
  estado           text not null default 'pendiente' check (estado in ('pendiente','enviado','fallido')),
  intentos         integer not null default 0,
  proximo_intento  timestamptz not null default now(),
  ultimo_error     text,
  creado_en        timestamptz not null default now(),
  entregado_en     timestamptz,
  unique (cliente_id, clave)
);

create index if not exists ed_eventos_brainroot_pend_idx
  on ed_eventos_brainroot (proximo_intento) where estado = 'pendiente';

alter table ed_eventos_brainroot enable row level security;  -- deny-all: solo service_role

-- Rollback: drop table if exists ed_eventos_brainroot;
-- Ver fallidos: select id, tipo, intentos, ultimo_error, creado_en from ed_eventos_brainroot where estado = 'fallido' order by creado_en desc;
