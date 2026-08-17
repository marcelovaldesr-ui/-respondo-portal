-- 281_instagram_token_cifrado.sql
--
-- El token de Instagram, cifrado y con el usuario a la vista.
--
-- La migración 271 dejó `ed_clientes.ig_token` en TEXTO PLANO, el mismo problema
-- que las migraciones 279/280 acaban de cerrar para WhatsApp. Con ese token se
-- pueden leer y responder los mensajes directos del negocio. Se corrige ahora,
-- ANTES de que haya cuentas conectadas de verdad — que es mucho más barato que
-- corregirlo después.
--
-- Se agrega además `ig_usuario` (el @ de la cuenta) para que el portal pueda
-- mostrar "conectado como @rsshop.cl" en vez de un número de 17 dígitos que no
-- le dice nada a nadie.
--
-- Mismo mecanismo que WhatsApp: AES-256-GCM en la aplicación (lib/cifrado.ts),
-- propósito "ig-token", clave derivada de SUPABASE_SERVICE_ROLE_KEY.

alter table ed_clientes
  add column if not exists ig_token_cifrado text,
  add column if not exists ig_usuario       text;

comment on column ed_clientes.ig_token_cifrado is
  'Token de Instagram (60 días) cifrado con AES-256-GCM, propósito "ig-token". Lo escribe /api/instagram/callback.';
comment on column ed_clientes.ig_usuario is
  'Nombre de usuario de Instagram (@) de la cuenta conectada. Solo para mostrar en el portal.';
comment on column ed_clientes.ig_token is
  'OBSOLETA — token en TEXTO PLANO. Nadie la escribe desde la 281. Se limpia abajo.';

-- A diferencia de WhatsApp, acá NO hace falta migración en dos tiempos: hoy no
-- hay ninguna cuenta de Instagram conectada en producción, así que no hay nada
-- que preservar y no existe el riesgo de dejar a un cliente mudo.
update ed_clientes set ig_token = null where ig_token is not null;

-- Verificación
select
  (select count(*) from information_schema.columns
    where table_name='ed_clientes' and column_name in ('ig_token_cifrado','ig_usuario')) as cols_nuevas, -- espera 2
  (select count(*) from ed_clientes where ig_token is not null)                          as en_claro,    -- espera 0
  (select count(*) from ed_clientes where ig_token_cifrado is not null)                  as conectados;  -- espera 0 por ahora
