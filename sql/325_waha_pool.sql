-- 325 · Grupo de números WAHA para campañas de Kambak (marketing)
-- Idempotente. NO se aplica solo: la aplica un humano en Supabase.
-- Permite que las campañas de marketing de Kambak roten sobre un grupo
-- de números propios conectados por WAHA (Railway), reduciendo costos
-- respecto a Meta sin tocar el tráfico oficial ni los otros clientes.

-- 1) Canal de marketing por cuenta: 'meta' (default actual) o 'waha'
alter table ed_clientes
  add column if not exists canal_marketing text not null default 'meta'
  check (canal_marketing in ('meta', 'waha'));

-- 2) Números del grupo WAHA
create table if not exists ed_waha_numeros (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references ed_clientes(id) on delete cascade,
  sesion               text not null unique,
  telefono_hash        text,
  etiqueta             text,
  estado               text not null check (estado in ('calentando','activo','pausado','caido','bloqueado','retirado')),
  rol                  text not null default 'envio' check (rol in ('envio','respuesta')),
  calentamiento_desde  date,
  tope_diario          int not null default 150,
  enviados_hoy         int not null default 0,
  dia                  date,
  ultimo_envio_en      timestamptz,
  proximo_envio_en     timestamptz,
  ultimo_error         text,
  fallos_seguidos      int not null default 0,
  creado_en            timestamptz not null default now()
);

create index if not exists ed_waha_numeros_cliente_idx
  on ed_waha_numeros (cliente_id, estado);
create index if not exists ed_waha_numeros_sesion_idx
  on ed_waha_numeros (sesion);

alter table ed_waha_numeros enable row level security;  -- deny-all: solo service_role

-- 3) Trazabilidad en envíos API: canal usado y número asignado si fue por WAHA
alter table ed_envios_api
  add column if not exists canal text not null default 'meta'
  check (canal in ('meta', 'waha'));

alter table ed_envios_api
  add column if not exists numero_id uuid references ed_waha_numeros(id);

create index if not exists ed_envios_api_numero_idx
  on ed_envios_api (numero_id) where numero_id is not null;

-- Rollback:
-- alter table ed_envios_api drop column if exists numero_id;
-- alter table ed_envios_api drop column if exists canal;
-- drop table if exists ed_waha_numeros;
-- alter table ed_clientes drop column if exists canal_marketing;

-- Verificación:
-- select estado, count(*) from ed_waha_numeros group by 1;
