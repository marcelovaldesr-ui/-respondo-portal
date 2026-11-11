-- ============================================================================
-- 331 · Conversiones a Meta (Conversions API for Business Messaging), por tenant
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA
--   1. ed_clientes.conversiones_meta_activo — el FLAG. Apagado por defecto: un
--      negocio que no lo enciende no cambia en nada.
--   2. ed_clientes.conversiones_meta — la configuración del tenant (qué eventos,
--      regla de calificación, test_event_code, partner_agent). Nada de esto va
--      escrito en el código.
--   3. ed_contactos.cotizacion — los datos estructurados que la IA extrae de la
--      conversación (producto, cantidad, tipo, fecha, logo, empresa) y las marcas
--      manuales. Columna propia y no `datos`: `datos` lo escriben otros procesos
--      y un read-modify-write podría pisar `datos.campana` (el ctwa_clid).
--   4. ed_ads_eventos — nombres de evento oficiales de Meta para mensajería, y el
--      registro completo de cada envío (payload sin datos personales, respuesta
--      de Meta, si fue de prueba y de dónde salió).
--
-- Aditiva e idempotente. Sin la 331 el código no rompe: el cron no encuentra
-- tenants con el flag (PostgREST devuelve error y se trata como «ninguno»).
-- APLICAR EN SUPABASE «hq respoboto» (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1 y 2. Flag y configuración por tenant ──────────────────────────────────
alter table ed_clientes
  add column if not exists conversiones_meta_activo boolean not null default false;
alter table ed_clientes
  add column if not exists conversiones_meta jsonb;

comment on column ed_clientes.conversiones_meta_activo is
  'Flag: devolver resultados de conversaciones de anuncios CTWA a Meta. Apagado por defecto.';
comment on column ed_clientes.conversiones_meta is
  'Config: {eventos:{LeadSubmitted,QualifiedLead,Purchase}, reglas:[{producto,sinonimos,cantidadMinima}], testEventCode, partnerAgent}. Ver lib/ads/conversionesConfig.ts';

-- ── 3. Datos estructurados de la cotización ────────────────────────────────
alter table ed_contactos add column if not exists cotizacion jsonb;
alter table ed_contactos add column if not exists cotizacion_revisada_en timestamptz;

comment on column ed_contactos.cotizacion is
  'Extracción estructurada de la cotización (IA) + marcas manuales. Ver lib/ads/cotizacionCore.ts';

-- ── 4. Cola de eventos: tipos oficiales y registro completo ────────────────
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'ed_ads_eventos'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table ed_ads_eventos drop constraint %I', r.conname);
  end loop;
end $$;

-- Lead/Schedule se conservan SOLO para no invalidar filas viejas (hoy hay 0);
-- el código ya no los genera porque Meta no los acepta para mensajería.
alter table ed_ads_eventos add constraint ed_ads_eventos_tipo_check
  check (tipo in ('LeadSubmitted','QualifiedLead','Purchase','Lead','Schedule'));

alter table ed_ads_eventos add column if not exists payload    jsonb;
alter table ed_ads_eventos add column if not exists respuesta  jsonb;
alter table ed_ads_eventos add column if not exists es_prueba  boolean not null default false;
alter table ed_ads_eventos add column if not exists origen     text;

comment on column ed_ads_eventos.payload is
  'Lo que se le mandó a Meta. Sin datos personales: solo WABA id y ctwa_clid.';
comment on column ed_ads_eventos.respuesta is
  'Respuesta de Meta (cuerpo JSON), recortada. Nunca tokens ni encabezados.';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name='ed_clientes' and column_name='conversiones_meta_activo') as flag,
  (select count(*) from information_schema.columns
    where table_name='ed_clientes' and column_name='conversiones_meta')        as config,
  (select count(*) from information_schema.columns
    where table_name='ed_contactos' and column_name='cotizacion')              as cotizacion,
  (select count(*) from information_schema.columns
    where table_name='ed_ads_eventos' and column_name='payload')               as registro,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname='ed_ads_eventos_tipo_check')                                 as tipos;
