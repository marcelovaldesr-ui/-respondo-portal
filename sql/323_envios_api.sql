-- 323 · Envíos por API para cuentas de solo mensajería (Kambak)
-- Idempotente. NO se aplica solo: la aplica un humano en Supabase.
-- Guarda: idempotencia por clave, tope mensual por número y registro de cada
-- envío. NO guarda el texto del mensaje (el texto vive en ed_mensajes, que es
-- lo que ve la bandeja). El teléfono se guarda solo mientras el envío está
-- en cola; al terminar se borra y queda únicamente su huella (hash).

create table if not exists ed_envios_api (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references ed_clientes(id) on delete cascade,
  clave            text not null,                -- idempotencyKey enviada por el cliente
  plantilla        text not null,
  categoria        text not null check (categoria in ('utility','marketing','authentication')),
  telefono_hash    text not null,                -- sha256(cliente_id || ':' || número)
  telefono         text,                         -- solo mientras estado = 'en_cola'
  variables        jsonb,                        -- solo mientras estado = 'en_cola'
  estado           text not null check (estado in ('en_cola','enviando','enviado','fallido','omitido')),
  motivo           text,                         -- omitido: baja | tope_mensual ; fallido: código/resumen
  wamid            text,                         -- id del mensaje en Meta (para empatar los estados)
  mes              text not null,                -- 'YYYY-MM' hora de Chile (para el tope mensual)
  programado_para  timestamptz,
  creado_en        timestamptz not null default now(),
  enviado_en       timestamptz,
  unique (cliente_id, clave)
);

create index if not exists ed_envios_api_tope_idx
  on ed_envios_api (cliente_id, telefono_hash, mes) where categoria = 'marketing';
create index if not exists ed_envios_api_cola_idx
  on ed_envios_api (programado_para) where estado = 'en_cola';
create index if not exists ed_envios_api_wamid_idx
  on ed_envios_api (wamid) where wamid is not null;

alter table ed_envios_api enable row level security;  -- deny-all: solo service_role (código del portal)

-- Rollback: drop table if exists ed_envios_api;
-- Verificación: select count(*) from ed_envios_api;
