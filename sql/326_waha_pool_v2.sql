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

-- (Poblado en las fases siguientes)

-- Rollback:
-- drop table if exists ed_waha_lids;
