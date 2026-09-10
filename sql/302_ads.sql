-- ============================================================================
-- 302 · Pauta: conexión con Meta y cola de eventos de conversión
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA
--   1. `ed_ads_conexion`  — la cuenta publicitaria conectada de cada negocio.
--   2. `ed_ads_eventos`   — la cola de conversiones que se le devuelven a Meta.
--
-- ⚠️ LO QUE **NO** AGREGA, Y ES UNA DECISIÓN:
-- No hay tablas de campañas, conjuntos, anuncios ni métricas diarias. La
-- tentación era copiar el modelo de Meta a nuestra base y sincronizarlo; se
-- descartó por tres razones concretas:
--   · Duplicar el catálogo de Meta obliga a mantenerlo sincronizado para
--     siempre, y cuando se desincroniza el panel miente sin avisar.
--   · Meta ya guarda esa historia y la sirve por API con el rango que le pidas.
--   · **Supabase Free topea en 500 MB** y `ed_mensajes` ya es la tabla que más
--     crece. Guardar métricas por anuncio y por día es la forma más rápida de
--     llenarlo con datos que Meta nos vuelve a dar cuando se los pidamos.
-- Si algún día hace falta caché, va a ser por lentitud medida, no por si acaso.
--
-- LA ATRIBUCIÓN TAMPOCO NECESITA TABLA: el anuncio de origen ya vive en
-- `ed_contactos.datos.campana` desde la migración 282, y ahí se queda. Duplicarlo
-- solo agregaría una segunda verdad que mantener.
--
-- NO ES BLOQUEANTE: sin esta migración Pauta funciona y muestra la atribución;
-- lo único que no se puede es conectar Meta ni encolar eventos. Misma regla que
-- la 282, 298, 299, 300 y 301.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1. La conexión ──────────────────────────────────────────────────────────
create table if not exists ed_ads_conexion (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,
  -- Hoy solo 'meta'. La columna existe para que agregar Google no obligue a
  -- migrar la tabla, no porque haya un segundo proveedor a la vista.
  proveedor      text not null default 'meta',

  -- Identificador de la cuenta TAL COMO lo pide la API («act_123456»), para no
  -- tener que recomponerlo en cada consulta y equivocarse una vez.
  cuenta_id      text,
  cuenta_nombre  text,
  -- ⭐ La moneda y la zona salen de la CUENTA, no se asumen. Una cuenta que
  -- factura en USD con cifras rotuladas en pesos es un error de decisión de
  -- plata; una zona equivocada corre el gasto del primer y último día.
  moneda         text not null default 'CLP',
  zona_horaria   text not null default 'America/Santiago',

  -- ⚠️ CIFRADO, nunca en claro. Este token lee el gasto publicitario del
  -- negocio: filtrado es peor que el de WhatsApp. Misma caja que la 279.
  token_cifrado  text,
  -- Cuándo vence el token largo de Meta (60 días). Sirve para avisar ANTES.
  token_vence    timestamptz,

  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','conectada','token_vencido','error')),
  ultima_sync    timestamptz,
  -- Último error legible. NUNCA guarda el token ni encabezados.
  ultimo_error   text,

  creado_por     text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Un negocio tiene UNA conexión por proveedor. Sin esto, dos autorizaciones
  -- seguidas dejarían dos filas y las consultas leerían una al azar.
  unique (cliente_id, proveedor)
);

alter table ed_ads_conexion enable row level security;

comment on table ed_ads_conexion is
  'Cuenta publicitaria conectada por negocio. El token va cifrado (lib/cifrado.ts, propósito ads-token).';
comment on column ed_ads_conexion.cuenta_id is
  'Como lo pide la Graph API: act_123456. Guardado con el prefijo a propósito.';
comment on column ed_ads_conexion.moneda is
  'Moneda de la CUENTA publicitaria. Puede ser distinta de la del negocio: nunca se suman.';

-- ── 2. La cola de eventos ───────────────────────────────────────────────────
create table if not exists ed_ads_eventos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references ed_clientes(id) on delete cascade,
  chat_id       text not null,

  tipo          text not null check (tipo in ('Lead','Schedule','Purchase')),
  -- ⭐ Identificador determinista del hecho. Es lo que impide que un reintento
  -- le sume una venta falsa a la cuenta del cliente: Meta deduplica por acá.
  evento_id     text not null,
  ocurrido_en   timestamptz not null,

  -- Sin el identificador del clic el evento no se puede atribuir: se guarda
  -- igual, en estado 'descartado', para poder EXPLICAR por qué no salió.
  ctwa_clid     text,
  valor         numeric,
  moneda        text,

  estado        text not null default 'pendiente'
                check (estado in ('pendiente','enviado','fallido','descartado')),
  motivo        text,
  intentos      int not null default 0,
  ultimo_intento timestamptz,
  enviado_en    timestamptz,

  creado_en     timestamptz not null default now(),

  -- La misma barrera, de este lado: aunque el código se equivoque y encole dos
  -- veces, la base solo deja uno. La idempotencia no puede depender solo del
  -- código que la calcula.
  unique (cliente_id, evento_id)
);

create index if not exists idx_ed_ads_eventos_pendientes
  on ed_ads_eventos (cliente_id, creado_en)
  where estado in ('pendiente','fallido');

create index if not exists idx_ed_ads_eventos_chat
  on ed_ads_eventos (cliente_id, chat_id, creado_en desc);

alter table ed_ads_eventos enable row level security;

comment on table ed_ads_eventos is
  'Cola de conversiones que se le devuelven a Meta (Conversions API para mensajería). Un evento sin ctwa_clid queda descartado con su motivo, no se manda.';
comment on column ed_ads_eventos.evento_id is
  'Determinista: mismo hecho = mismo id. Es lo que permite reintentar sin duplicar la conversión en Meta.';

-- ── 3. Dónde va el dataset de eventos ───────────────────────────────────────
-- Cuelga del cliente y no de la conexión publicitaria a propósito: son DOS
-- integraciones distintas que fallan por separado. Se puede medir (devolver
-- conversiones con el WABA que ya está conectado) sin haber conectado nunca una
-- cuenta publicitaria, y al revés.
alter table ed_clientes add column if not exists ads_dataset_id text;

comment on column ed_clientes.ads_dataset_id is
  'Dataset de Meta al que se le mandan las conversiones de WhatsApp. Sin esto, los eventos se encolan pero no salen.';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_name = 'ed_ads_conexion') as conexion,
  (select count(*) from information_schema.tables where table_name = 'ed_ads_eventos')  as eventos,
  (select count(*) from information_schema.columns
    where table_name = 'ed_clientes' and column_name = 'ads_dataset_id')                as dataset;
