-- ============================================================================
-- 222_agenda_oauth.sql · Conexión "Conectar Google Calendar" (F5-OAuth)
-- ----------------------------------------------------------------------------
-- Aditiva e inocua, mismo patrón que 221. Agrega SOLO columnas nuevas con
-- default, sobre la misma tabla ed_profesionales que ya usa la cuenta de
-- servicio.
--
-- POR QUÉ ESTO EXISTE: la cuenta de servicio (221) le sirve a Marcelo hoy,
-- pero pedirle a cada cliente futuro que comparta su calendario a mano con un
-- correo robot y pegue un "ID de calendario" es fricción real — se vio en
-- vivo el 1-ago cuando el propio Marcelo pegó el campo equivocado y salió
-- "Not Found". El botón "Conectar Google Calendar" (OAuth) resuelve eso: el
-- dueño hace clic, entra a su Google, aprieta "Permitir", listo — cero
-- campos que llenar. Los dos mecanismos conviven: cada profesional usa uno
-- u otro según gcal_modo.
--
-- APLICAR después de 221_agenda_calendarios.sql.
-- ============================================================================

alter table ed_profesionales
  add column if not exists gcal_modo text
  check (gcal_modo in ('cuenta_servicio', 'oauth'));

-- Refresh token de Google, CIFRADO (nunca en texto plano). Con esto se pide
-- un access token nuevo cada vez que hace falta, sin volver a pedirle
-- permiso al dueño. Se cifra con AES-256-GCM derivado de un secreto que ya
-- existe en el entorno (ver lib/googleOAuth.ts) — no se agrega ninguna
-- variable de entorno nueva para esto.
alter table ed_profesionales add column if not exists gcal_oauth_refresh_cifrado text;

-- Solo para mostrarle al dueño "Conectado como fulano@gmail.com" en el
-- portal. No es un dato sensible ni se usa para nada funcional.
alter table ed_profesionales add column if not exists gcal_oauth_email text;

-- ---------------------------------------------------------------------------
-- Verificación (debe devolver 3)
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_name = 'ed_profesionales'
       and column_name in ('gcal_modo', 'gcal_oauth_refresh_cifrado', 'gcal_oauth_email')) as cols_oauth;
