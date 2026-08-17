-- 279_waba_token_cifrado.sql
--
-- SACAR EL TOKEN DE WHATSAPP DE TEXTO PLANO.
--
-- `ed_clientes.waba_token` guarda el token que devuelve el Embedded Signup de
-- cada cliente. Con ese token se puede ENVIAR MENSAJES DE WHATSAPP HACIÉNDOSE
-- PASAR POR EL NEGOCIO. Estaba en claro desde la migración 210.
--
-- Mientras solo había clientes demo era deuda tolerable. El 14-ago-2026
-- RS-Shop (importador de KTM, 118 trabajadores, 8 sucursales) quedó conectado
-- con su token real guardado así. Dejó de ser tolerable.
--
-- El hallazgo salió de la auditoría de seguridad de Vita: el mismo criterio con
-- que se les señaló que un runner no puede ser la única barrera, aplicado
-- puertas adentro.
--
-- CÓMO SE CIFRA: AES-256-GCM en la aplicación (lib/cifrado.ts), con clave
-- derivada de SUPABASE_SERVICE_ROLE_KEY y separada por propósito. Es el MISMO
-- mecanismo que ya protege el refresh token de Google desde la migración 222 —
-- no se inventa un esquema nuevo.
--
-- POR QUÉ NO SUPABASE VAULT: obliga a leer la columna por una vista y a
-- administrar llaves en la base. Este equipo es de dos personas y ya tiene un
-- mecanismo probado en producción. Menos piezas que mantener gana.
--
-- ⚠️ MIGRACIÓN EN DOS TIEMPOS, A PROPÓSITO.
-- Esta migración solo AGREGA la columna nueva. No borra nada. El orden es:
--   1) aplicar esta migración          → la columna existe, vacía
--   2) desplegar el código             → lee cifrado y, si no hay, cae al claro
--   3) correr scripts/cifrar_tokens.ts → llena la columna cifrada
--   4) VERIFICAR que RS-Shop sigue enviando mensajes de verdad
--   5) recién ahí correr la 280 que pone waba_token en null
-- Si se borra el texto plano antes del paso 4 y algo falla, el cliente queda
-- mudo y no hay de dónde recuperar el token: hay que rehacer el onboarding con
-- él al teléfono.

alter table ed_clientes
  add column if not exists waba_token_cifrado text;

comment on column ed_clientes.waba_token_cifrado is
  'Token de WhatsApp del cliente cifrado con AES-256-GCM (lib/cifrado.ts, propósito "waba-token"). Formato iv.tag.cifrado en base64url.';

comment on column ed_clientes.waba_token is
  'OBSOLETA — token en TEXTO PLANO. Se conserva solo durante la transición de la migración 279. La 280 la pone en null. No leer desde código nuevo: usar waba_token_cifrado.';

-- Verificación
select
  (select count(*) from information_schema.columns
    where table_name='ed_clientes' and column_name='waba_token_cifrado')      as col_nueva,      -- espera 1
  (select count(*) from ed_clientes where waba_token is not null)             as en_texto_plano, -- los que faltan cifrar
  (select count(*) from ed_clientes where waba_token_cifrado is not null)     as ya_cifrados;    -- espera 0 por ahora
