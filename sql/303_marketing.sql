-- ============================================================================
-- 303 · Marketing: creatividades y borradores de campaña
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA
--   1. `ed_mk_creatividades` — los anuncios que el negocio crea en el Estudio
--      (concepto, gancho, titular, texto, CTA, imagen). Con o sin campaña.
--   2. `ed_mk_campanas`      — borradores de campaña armados con el asistente:
--      objetivo, oferta, audiencia, presupuesto, copies, creatividades.
--   3. Bucket `creatividades` para las imágenes generadas o subidas.
--
-- ⚠️ LO QUE NO AGREGA, Y ES UNA DECISIÓN
-- No hay tabla de campañas/anuncios de Meta ni métricas diarias: eso lo sirve
-- Meta por API y duplicarlo obliga a sincronizarlo para siempre (misma regla
-- que la 302). Lo que SÍ es nuestro —lo que el negocio escribió y diseñó— sí
-- se guarda, porque no existe en ninguna otra parte.
--
-- NO ES BLOQUEANTE: sin esta migración el centro de marketing muestra
-- resultados, atribución y leads; lo único que no puede es GUARDAR
-- creatividades ni borradores (las pantallas lo dicen en vez de fallar).
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1. Creatividades ────────────────────────────────────────────────────────
create table if not exists ed_mk_creatividades (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,

  nombre         text not null,
  objetivo       text not null default 'conversaciones',
  producto       text not null default '',
  oferta         text not null default '',
  plataforma     text not null default 'ambas'
                 check (plataforma in ('instagram','facebook','ambas')),
  formato        text not null default '1:1'
                 check (formato in ('1:1','4:5','9:16','16:9')),

  -- El paquete creativo. Todo texto, editable a mano después de generado.
  concepto       text not null default '',
  gancho         text not null default '',
  titular        text not null default '',
  texto          text not null default '',
  cta            text not null default '',

  -- Imagen: puntero `sb:<ruta>` al bucket privado (la 304 migró las URLs
  -- públicas que guardaba antes), y el prompt con que se generó (para poder
  -- regenerar o variar sin volver a escribirlo).
  imagen_url     text,
  imagen_prompt  text,

  estado         text not null default 'borrador'
                 check (estado in ('borrador','lista','en_campana','archivada')),
  campana_id     uuid,
  -- De qué creatividad salió, si es una variación. Permite ver la familia.
  variante_de    uuid references ed_mk_creatividades(id) on delete set null,

  -- Id del anuncio de Meta cuando la creatividad ya corrió; es lo que permite
  -- cruzarla con su rendimiento real. Lo escribe la persona o una sincronización futura.
  meta_ad_id     text,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_ed_mk_creatividades_cliente
  on ed_mk_creatividades (cliente_id, actualizado_en desc);

alter table ed_mk_creatividades enable row level security;

comment on table ed_mk_creatividades is
  'Creatividades de anuncios hechas en el Estudio de Marketing. La imagen vive en el bucket creatividades.';

-- ── 2. Borradores de campaña ────────────────────────────────────────────────
create table if not exists ed_mk_campanas (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references ed_clientes(id) on delete cascade,

  nombre             text not null,
  objetivo           text not null default 'conversaciones',
  oferta             text not null default '',
  -- {ubicacion, edadDesde, edadHasta, intereses[], nota}
  audiencia          jsonb not null default '{}'::jsonb,
  presupuesto_diario numeric,
  presupuesto_total  numeric,
  moneda             text not null default 'CLP',
  destino            text not null default 'whatsapp',
  creatividad_ids    uuid[] not null default '{}',
  -- [{titular, texto, cta}]
  copies             jsonb not null default '[]'::jsonb,

  -- ⭐ Estados HONESTOS. `publicada` solo la escribe una publicación real por
  -- API (que hoy no existe). Nunca se marca a mano.
  estado             text not null default 'borrador'
                     check (estado in ('borrador','lista','requiere_meta','requiere_permiso','publicada')),
  meta_campaign_id   text,
  notas              text not null default '',

  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);

create index if not exists idx_ed_mk_campanas_cliente
  on ed_mk_campanas (cliente_id, actualizado_en desc);

alter table ed_mk_campanas enable row level security;

comment on table ed_mk_campanas is
  'Borradores de campaña del asistente de Marketing. estado=publicada solo lo escribe una publicación real por API.';

-- ── 3. El bucket de imágenes ────────────────────────────────────────────────
-- PRIVADO. 4 MB de tope: una imagen generada pesa 60-200 KB en JPEG.
--
-- Esta migración decía `public = true` —el razonamiento era que una creatividad
-- termina publicada en Meta de todos modos—. Estaba mal: entre que se genera y
-- que se publica es un borrador del negocio, y una URL de bucket público no
-- caduca ni pide sesión, así que una sola filtración dejaba el archivo expuesto
-- para siempre. La 304 lo cerró y movió las imágenes detrás de
-- /api/marketing/imagen.
--
-- Corregido acá, en el origen, y no solo en la 304 (auditoría 11-sep-2026):
-- el `on conflict do update set public = true` volvía a ABRIR el bucket cada
-- vez que alguien re-ejecutara este archivo. Una política de seguridad que
-- depende de que nadie vuelva a correr una migración no es una política.
-- Corriendo 303 y 304 en orden desde cero el resultado es el mismo; corriendo
-- 303 sola, hoy, el bucket queda cerrado en vez de abierto.
insert into storage.buckets (id, name, public, file_size_limit)
values ('creatividades', 'creatividades', false, 4194304)
on conflict (id) do update set public = false, file_size_limit = 4194304;

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_name = 'ed_mk_creatividades') as creatividades,
  (select count(*) from information_schema.tables where table_name = 'ed_mk_campanas')      as campanas,
  (select count(*) from storage.buckets where id = 'creatividades')                          as bucket;
