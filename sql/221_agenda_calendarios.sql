-- ============================================================================
-- 221_agenda_calendarios.sql · Sincronización de calendarios (F5)
-- ----------------------------------------------------------------------------
-- Aditiva e inocua, igual que la 220. Agrega SOLO columnas nuevas con default:
--   1) ed_clientes.ical_token      → URL secreta del feed iCal del negocio
--   2) ed_profesionales.gcal_id    → calendario de Google de cada profesional
--   3) ed_profesionales.gcal_sync  → interruptor por profesional
--
-- NADA de esto afecta a clientes sin agenda (Impresora Color incluido): las
-- columnas quedan con su default y ningún código las mira si no hay agenda.
--
-- APLICAR después de 220_agenda.sql.
-- ============================================================================

-- 1) Token del feed iCal (24 bytes aleatorios en hex = 48 caracteres).
--    Sirve como "contraseña en la URL": quien no la tiene, no ve nada.
--    gen_random_bytes viene de pgcrypto, ya disponible en Supabase.
create extension if not exists pgcrypto;

alter table ed_clientes
  add column if not exists ical_token text
  default encode(gen_random_bytes(24), 'hex');

-- Rellenar los que ya existían (el default solo aplica a filas nuevas).
update ed_clientes
   set ical_token = encode(gen_random_bytes(24), 'hex')
 where ical_token is null;

create unique index if not exists idx_ed_clientes_ical_token
  on ed_clientes(ical_token);

-- 2) Calendario de Google por profesional.
--    gcal_id = el "ID del calendario" que aparece en la configuración de
--    Google Calendar (suele ser el correo del dueño o un id largo @group.calendar.google.com).
alter table ed_profesionales add column if not exists gcal_id text;
alter table ed_profesionales add column if not exists gcal_sync boolean not null default false;

-- 3) Marca de la última sincronización, para diagnosticar sin adivinar.
alter table ed_profesionales add column if not exists gcal_ultimo_error text;
alter table ed_profesionales add column if not exists gcal_ultima_sync timestamptz;

-- ---------------------------------------------------------------------------
-- Verificación (debe devolver 1 y 4)
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_name = 'ed_clientes' and column_name = 'ical_token') as col_ical,
  (select count(*) from information_schema.columns
     where table_name = 'ed_profesionales'
       and column_name in ('gcal_id','gcal_sync','gcal_ultimo_error','gcal_ultima_sync')) as cols_gcal;
