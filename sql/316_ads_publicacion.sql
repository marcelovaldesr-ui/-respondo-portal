-- ============================================================================
-- 316 · Marketing: Publicación real en Meta Ads y Google Ads
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA:
--   1. `ed_mk_campanas.google_campaign_id` — identificador nativo de la campaña
--      en Google Ads (paralelo a `meta_campaign_id`), para búsquedas directas
--      y vinculación con atribución sin tener que desempaquetar el plan JSONB.
--   2. Índice sobre `ed_mk_campanas(cliente_id, estado)` para filtrar campañas
--      publicadas vs borradores rápidamente.
--
-- ⚠️ ADITIVA E IDEMPOTENTE:
-- No modifica datos existentes. Las columnas ya existentes `plan` y `datos`
-- siguen conteniendo el objeto de publicación completo (`ResultadoPublicacion`).
-- NO ES BLOQUEANTE: el código funciona con o sin esta migración.
--
-- APLICAR MANUALMENTE EN SUPABASE (SQL Editor, pestaña nueva con +).
-- ============================================================================

-- 1. Columna para ID de campaña de Google Ads
alter table ed_mk_campanas add column if not exists google_campaign_id text;

comment on column ed_mk_campanas.google_campaign_id is
  'Identificador nativo devuelto por Google Ads API v25 al crear la campaña.';

-- 2. Índice para estado de campañas por cliente
create index if not exists idx_ed_mk_campanas_cliente_estado
  on ed_mk_campanas (cliente_id, estado);

-- 3. Verificación
select
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_campanas' and column_name = 'google_campaign_id') as google_campaign_id,
  (select count(*) from pg_indexes
     where tablename = 'ed_mk_campanas' and indexname = 'idx_ed_mk_campanas_cliente_estado') as indice_estado;
