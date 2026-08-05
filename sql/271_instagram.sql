-- ═══════════════════════════════════════════════════════════════════════════
-- 271 · INSTAGRAM DIRECT — credenciales por cliente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ NO ALCANZA CON UNA VARIABLE DE ENTORNO
-- El primer impulso es guardar un IG_TOKEN en Vercel y listo. No sirve: en
-- Instagram el token pertenece a LA CUENTA del negocio, no a nuestra app. Cada
-- cliente que conecte su Instagram trae el suyo. Con una variable global solo
-- podría haber un negocio con Instagram en toda la plataforma — y el segundo
-- cliente que lo pidiera obligaría a rehacer esto con clientes en producción.
--
-- LA COLUMNA VIEJA NO SE BORRA
-- `ig_page_id` ya existía (del camino con Login de Facebook, que necesita una
-- página de Facebook vinculada). Se conserva por si algún cliente llega por ahí,
-- pero el camino que usamos es el de Login de Instagram, cuyo identificador es
-- la cuenta profesional: `ig_user_id`.
--
-- EL TOKEN VENCE A LOS 60 DÍAS
-- Y ese es el modo de falla más traicionero de este canal: no avisa. Un día
-- Instagram simplemente deja de responder y en el portal no se ve nada raro.
-- Por eso se guarda la fecha de vencimiento: permite renovarlo antes y avisar
-- si algo salió mal, en vez de enterarse por un cliente enojado.

alter table ed_clientes
  add column if not exists ig_user_id      text,
  add column if not exists ig_token        text,
  add column if not exists ig_token_vence  timestamptz,
  add column if not exists ig_conectado_en timestamptz;

-- Un mismo Instagram no puede estar en dos negocios: si lo estuviera, el
-- webhook no sabría a cuál pertenece un mensaje y elegiría uno al azar.
create unique index if not exists ed_clientes_ig_user_id_uniq
  on ed_clientes (ig_user_id)
  where ig_user_id is not null;

comment on column ed_clientes.ig_user_id is
  'ID de la cuenta profesional de Instagram. Llega como entry.id en el webhook.';
comment on column ed_clientes.ig_token is
  'Token de usuario de Instagram, larga duración (60 días). Se renueva solo.';
comment on column ed_clientes.ig_token_vence is
  'Cuándo expira ig_token. El cron lo renueva cuando faltan menos de 15 días.';
