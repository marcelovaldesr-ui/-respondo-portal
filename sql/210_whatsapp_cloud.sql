-- ============================================================================
-- 210_whatsapp_cloud.sql  ·  Opción B (WhatsApp Cloud API oficial)
-- ----------------------------------------------------------------------------
-- Prepara la base para conectar números por la API oficial de Meta.
-- Aditivo e inocuo: no toca los datos existentes ni la Opción A.
--
-- El addendum 101 ya agregó ed_clientes.waba_phone_id (mapeo número Meta ->
-- cliente). Acá se completa lo que falta para el multi-cliente oficial.
-- ============================================================================

-- Identidad de la cuenta de WhatsApp Business del cliente en Meta
alter table ed_clientes add column if not exists waba_id text;               -- WhatsApp Business Account id

-- Token de acceso del cliente (el que devuelve Embedded Signup).
-- NOTA DE SEGURIDAD: en producción esto debe ir cifrado (Supabase Vault o
-- credencial por cliente). En desarrollo con el número de prueba se usa un
-- único token desde variable de entorno y esta columna queda null.
alter table ed_clientes add column if not exists waba_token text;

-- Canal del mensaje (hoy todo es whatsapp; se deja listo para IG/Messenger)
alter table ed_mensajes add column if not exists canal text not null default 'whatsapp'
  check (canal in ('whatsapp','instagram','messenger','prueba'));

-- Marca de tiempo del último mensaje ENTRANTE del cliente, para saber si la
-- ventana de 24h de WhatsApp está abierta sin recalcular sobre ed_mensajes.
alter table ed_chat_estado add column if not exists ultimo_entrante_en timestamptz;

-- Índice para resolver rápido "¿de qué cliente es este número de Meta?"
create index if not exists idx_ed_clientes_waba_phone on ed_clientes(waba_phone_id);

-- Verificación
select
  (select count(*) from information_schema.columns
     where table_name='ed_clientes' and column_name in ('waba_id','waba_token','waba_phone_id')) as cols_clientes,
  (select count(*) from information_schema.columns
     where table_name='ed_mensajes' and column_name='canal') as canal_mensajes,
  (select count(*) from information_schema.columns
     where table_name='ed_chat_estado' and column_name='ultimo_entrante_en') as ventana_col;
