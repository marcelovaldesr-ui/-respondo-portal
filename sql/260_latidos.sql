-- ============================================================================
-- 260_latidos.sql · Registro de "esto corrió y a qué hora"
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
-- El 1-ago-2026 quedó una pregunta sin respuesta posible: ¿el cron externo
-- sigue llamando a /api/cron/seguimientos? La base no lo sabía. Se podía ver
-- que no había seguimientos vencidos, pero eso también pasa cuando no hay nada
-- que enviar. Nadie recordaba dónde estaba configurado el cron, y el endpoint
-- responde 403 sin la llave, así que desde afuera tampoco se distinguía "vivo"
-- de "muerto".
--
-- Eso es inaceptable para el módulo de agenda: los recordatorios de cita y las
-- confirmaciones dependen ENTERAMENTE de ese cron. Si deja de correr, no falla
-- nada visible — simplemente los clientes dejan de recibir su recordatorio y el
-- negocio se entera cuando alguien no llega.
--
-- LA SOLUCIÓN
-- Cada corrida deja un latido con la hora y un resumen. Con eso:
--   · /api/salud puede responder "el cron no corre hace 5 horas" y devolver 503,
--     que es lo que hace que el vigilante externo mande el correo de alerta.
--   · La pantalla /estado lo muestra en palabras.
-- Es UNA fila por proceso: no crece, no hay que limpiarla.
--
-- APLICAR EN SUPABASE (SQL Editor). Aditiva; no toca nada existente.
-- ============================================================================

create table if not exists ed_latidos (
  clave       text primary key,
  ultimo_en   timestamptz not null default now(),
  corridas    bigint      not null default 0,
  detalle     jsonb
);

comment on table ed_latidos is
  'Una fila por proceso periódico. Guarda cuándo corrió por última vez para '
  'poder detectar que DEJÓ de correr. Sin esto, un cron muerto es invisible.';

comment on column ed_latidos.clave is
  'Identificador del proceso. Hoy: "cron_seguimientos".';

comment on column ed_latidos.corridas is
  'Acumulado histórico de corridas. Sirve para distinguir "nunca corrió" de '
  '"corrió y se detuvo".';

comment on column ed_latidos.detalle is
  'Resumen de la última corrida (ej. cuántos seguimientos salieron). Nunca '
  'contenido de mensajes ni datos de contacto.';

-- RLS: la tabla se escribe y lee solo con service_role desde el servidor.
-- Se activa igual como segunda barrera, coherente con el resto del esquema ed_.
alter table ed_latidos enable row level security;
