-- ============================================================================
-- 274_integraciones_salida.sql · Conector hacia el sistema del cliente
-- ----------------------------------------------------------------------------
-- QUÉ ES: una lista de destinos a los que el portal AVISA lo que va pasando en
-- las conversaciones (llegó un lead, entró un mensaje, cambió de etapa). Cada
-- destino es una URL con un secreto, configurada POR CLIENTE.
--
-- PARA QUÉ: hay clientes que ya tienen su propio sistema y no quieren mirar dos
-- pantallas. Con esto, el asistente alimenta ESE sistema y la persona que atiende
-- sigue trabajando donde siempre trabajó. El primer caso es Impresora Color, que
-- tiene su propia app de gestión, pero la objeción "ya tengo mi sistema" la pone
-- casi toda empresa mediana: por eso esto es una capacidad del producto y NO un
-- caso especial escrito en el código.
--
-- POR QUÉ EN LA BASE Y NO EN VARIABLES DE ENTORNO: si la URL viviera en el
-- entorno, habría UNA sola para todo el portal y agregar el segundo cliente
-- obligaría a tocar código y redeployar. Acá se da de alta un cliente nuevo con
-- un INSERT.
--
-- POR QUÉ NO SE GUARDA NADA DEL CONTENIDO: esta tabla es configuración, no
-- bitácora. Lo último que pasó se resume en dos columnas (ultimo_ok_en,
-- ultimo_error) para poder responder "¿está llegando?" sin abrir logs. Guardar
-- cada envío sería una tabla que crece para siempre y que nadie lee.
--
-- SEGURIDAD: `secreto` firma cada envío (HMAC-SHA256 del cuerpo) para que el
-- receptor pueda comprobar que el mensaje viene del portal y no de un tercero.
-- La tabla queda SIN políticas de RLS a propósito: es configuración de
-- infraestructura y solo la toca el servidor con service_role. Ningún navegador
-- debe poder leer un secreto.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor).
-- ============================================================================

create table if not exists ed_integraciones (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references ed_clientes(id) on delete cascade,

  -- Tipo de destino. Hoy solo 'webhook'; se deja abierto para no migrar después.
  tipo          text not null default 'webhook',

  -- Nombre para reconocerlo en pantalla ("App de gestión de Impresora Color").
  nombre        text not null,

  -- A dónde se manda. Debe ser https en producción.
  url           text not null,

  -- Con qué se firma el cuerpo del envío. Nunca se muestra en el navegador.
  secreto       text not null,

  -- Qué eventos quiere ese destino. Permite que un cliente reciba solo leads y
  -- otro además cada mensaje, sin ramas en el código.
  eventos       text[] not null default array['lead', 'mensaje', 'etapa'],

  activo        boolean not null default true,

  -- Salud del conector, para poder responder "¿está llegando?" de un vistazo.
  ultimo_ok_en  timestamptz,
  ultimo_error  text,
  ultimo_error_en timestamptz,

  creado_en     timestamptz not null default now()
);

alter table ed_integraciones drop constraint if exists ed_integraciones_tipo_check;
alter table ed_integraciones add constraint ed_integraciones_tipo_check
  check (tipo in ('webhook'));

-- Un cliente puede tener más de un destino, pero no dos veces la misma URL.
create unique index if not exists idx_ed_integraciones_cliente_url
  on ed_integraciones (cliente_id, url);

-- La consulta del camino caliente: "¿este cliente tiene destinos activos?".
create index if not exists idx_ed_integraciones_cliente_activo
  on ed_integraciones (cliente_id) where activo;

alter table ed_integraciones enable row level security;
-- Sin políticas: solo service_role (que se salta RLS) puede leer o escribir.
-- Si algún día el dueño configura esto desde el portal, la escritura debe pasar
-- por una server action, NUNCA por el cliente de navegador.

comment on table ed_integraciones is
  'Destinos a los que el portal avisa la actividad de las conversaciones, por cliente. Contiene secretos: solo service_role.';
comment on column ed_integraciones.secreto is
  'Clave para firmar el cuerpo (HMAC-SHA256). El receptor valida con la misma. No exponer al navegador.';
comment on column ed_integraciones.eventos is
  'Subconjunto de: lead | mensaje | etapa.';


-- ----------------------------------------------------------------------------
-- ALTA DE IMPRESORA COLOR (descomentar y completar los dos valores)
-- ----------------------------------------------------------------------------
-- El secreto debe ser el MISMO que quede en la variable RESPONDO_WEBHOOK_SECRET
-- del proyecto de la app de gestión en Vercel. Generar uno largo al azar, por
-- ejemplo con:  openssl rand -hex 32
--
-- insert into ed_integraciones (cliente_id, nombre, url, secreto)
-- values (
--   '33333333-3333-3333-3333-333333333333',
--   'App de gestión de Impresora Color',
--   'https://gestion-impresoracolor.vercel.app/api/tino/webhook',
--   '<PEGAR-EL-MISMO-SECRETO-QUE-EN-VERCEL>'
-- )
-- on conflict (cliente_id, url) do update
--   set secreto = excluded.secreto, activo = true;
