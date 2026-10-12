-- 326 · Endurecimiento del pool WAHA de Kambak (v2)
-- Idempotente. NO se aplica solo: la aplica un humano en Supabase.
-- Incorpora:
--  - ed_waha_lids: cache para resolución de WhatsApp LIDs a teléfonos reales (P1)
--  - ed_waha_pool_estado: estado global del pool y último resumen diario (P2, P9)
--  - Columnas en ed_waha_numeros para salud y pausas transitorias (P2)
--  - Columnas en ed_envios_api para reintentos y justicia de cola (P3, P4)
--  - Funciones atómicas de reserva y devolución de cupos (P5)
--  - Soporte de waha_opt_in en canal_marketing (P11)

-- 1) Caché de resolución de LIDs (Linked IDs) de WhatsApp a teléfonos reales (P1)
create table if not exists ed_waha_lids (
  id           uuid primary key default gen_random_uuid(),
  sesion       text not null,
  lid          text not null,
  telefono     text not null,
  creado_en    timestamptz not null default now(),
  constraint ed_waha_lids_sesion_lid_key unique (sesion, lid)
);

create index if not exists ed_waha_lids_lookup_idx
  on ed_waha_lids (sesion, lid);

alter table ed_waha_lids enable row level security; -- deny-all

-- 2) Estado global del pool WAHA (P2)
create table if not exists ed_waha_pool_estado (
  id                          int primary key default 1 check (id = 1),
  pool_inalcanzable_desde    timestamptz,
  ultimo_chequeo_en           timestamptz not null default now(),
  alerta_inalcanzable_en      timestamptz,
  alerta_sin_capacidad_en     timestamptz,
  actualizado_en              timestamptz not null default now()
);

insert into ed_waha_pool_estado (id) values (1)
on conflict (id) do nothing;

alter table ed_waha_pool_estado enable row level security; -- deny-all

-- 3) Columnas para backoff, salud y pausas en ed_waha_numeros (P2)
alter table ed_waha_numeros
  add column if not exists pausado_hasta timestamptz,
  add column if not exists ultimo_ok_en timestamptz,
  add column if not exists ciclos_pausa int not null default 0;

-- (Poblado en las fases siguientes)

-- Rollback:
-- alter table ed_waha_numeros drop column if exists pausado_hasta;
-- alter table ed_waha_numeros drop column if exists ultimo_ok_en;
-- alter table ed_waha_numeros drop column if exists ciclos_pausa;
-- drop table if exists ed_waha_pool_estado;
-- drop table if exists ed_waha_lids;
