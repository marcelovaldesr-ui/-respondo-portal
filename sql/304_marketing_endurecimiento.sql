-- ============================================================================
-- 304 — ENDURECIMIENTO DE MARKETING (11-sep-2026)
--
-- Aditiva y segura. NO modifica la 302 ni la 303: cierra lo que dejaron
-- abierto. Se puede ejecutar más de una vez sin efectos distintos.
--
-- QUÉ CIERRA
--   1. El bucket `creatividades` era PÚBLICO. Una URL filtrada daba acceso
--      permanente al material publicitario de un negocio, sin sesión. Y la
--      ruta era adivinable: `<uuid del cliente>/<milisegundos>.jpg`, con el
--      uuid a la vista en la URL pública del logo del propio negocio.
--   2. `imagen_url` guardaba la URL pública completa. Ahora se guarda el
--      puntero `sb:<ruta>` y la imagen se sirve por `/api/marketing/imagen`,
--      que exige sesión y comprueba el negocio.
--   3. Los permisos de tabla para `anon` y `authenticated` quedaban en manos
--      de los privilegios por defecto de Supabase. Se revocan explícitamente.
--
-- ⚠️ ORDEN OBLIGATORIO: primero el DESPLIEGUE del código, después esta
-- migración. El código nuevo entiende las dos formas de `imagen_url` (URL
-- pública antigua → se ignora; `sb:` → se sirve), así que desplegar primero no
-- rompe nada. Al revés, entre la migración y el despliegue las imágenes
-- existentes no se verían.
-- ============================================================================

-- ── 1. El bucket pasa a privado ─────────────────────────────────────────────
-- Nadie lee un objeto de acá sin service_role, y service_role solo lo usa el
-- servidor después de comprobar la sesión y el negocio.
update storage.buckets
   set public = false
 where id = 'creatividades';

-- ⚠️ NOTA PARA QUIEN VUELVA A CORRER LA 303: su último `on conflict do update
-- set public = true` volvería a abrir el bucket. La 303 ya está aplicada y no
-- debe re-ejecutarse; si alguna vez hiciera falta, correr esta 304 después.

-- ── 2. Migrar los punteros de imagen existentes ─────────────────────────────
-- De `https://<proyecto>.supabase.co/storage/v1/object/public/creatividades/<ruta>`
-- a `sb:<ruta>`. Se hace con split por el marcador, no con una posición fija,
-- para no depender del largo del dominio del proyecto.
update ed_mk_creatividades
   set imagen_url = 'sb:' || split_part(imagen_url, '/object/public/creatividades/', 2)
 where imagen_url is not null
   and imagen_url like '%/object/public/creatividades/%';

-- Cualquier otro valor que no sea un puntero nuestro se descarta: si quedó una
-- URL externa guardada (la columna aceptaba cualquier cosa antes de la
-- validación de hoy), no se sirve ni se vuelve a pedir.
update ed_mk_creatividades
   set imagen_url = null
 where imagen_url is not null
   and imagen_url not like 'sb:%';

-- ── 3. Permisos explícitos de las tablas del módulo ─────────────────────────
-- Las tablas ya tienen RLS activado SIN policies, que en este portal es
-- deny-all deliberado (mismo patrón que 220_agenda, 289_pagos y 291_cierre):
-- el servidor entra con service_role, que no evalúa policies, y `anon` /
-- `authenticated` no entran. Esto lo hace explícito en vez de depender de los
-- privilegios por defecto del proyecto, que podrían cambiar.
--
-- NO se agregan policies a propósito: agregarlas volvería estas tablas MENOS
-- restrictivas de lo que están hoy, no más.
revoke all on ed_mk_creatividades from anon, authenticated;
revoke all on ed_mk_campanas      from anon, authenticated;
revoke all on ed_ads_conexion     from anon, authenticated;
revoke all on ed_ads_eventos      from anon, authenticated;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Se espera: bucket_publico = false · urls_publicas = 0 · permisos_sueltos = 0
select
  (select public from storage.buckets where id = 'creatividades') as bucket_publico,
  (select count(*) from ed_mk_creatividades
     where imagen_url is not null and imagen_url not like 'sb:%')  as urls_publicas,
  (select count(*) from information_schema.role_table_grants
     where table_name in ('ed_mk_creatividades','ed_mk_campanas','ed_ads_conexion','ed_ads_eventos')
       and grantee in ('anon','authenticated'))                    as permisos_sueltos;

-- ── Reversión, si hiciera falta ─────────────────────────────────────────────
-- El paso 1 se revierte con:
--   update storage.buckets set public = true where id = 'creatividades';
-- El paso 2 NO se revierte automáticamente: haría falta reconstruir la URL
-- pública con el dominio del proyecto. Por eso el código entiende las dos
-- formas — volver atrás es redesplegar el código anterior y reabrir el bucket,
-- sin tocar los datos.
-- El paso 3 se revierte con `grant` explícitos, pero no debería hacer falta.
