-- ============================================================================
-- 250_resumen_contacto.sql · Resumen del contacto mantenido por la base
-- ----------------------------------------------------------------------------
-- EL PROBLEMA (medido el 31-jul-2026)
-- Tres pantallas —Conversaciones, Clientes y Embudo— necesitan lo mismo de cada
-- contacto: su último mensaje y cuántos lleva. Hoy eso se calcula trayendo TODOS
-- los mensajes del negocio y agregándolos en JavaScript. Con 1.467 mensajes son
-- 2 consultas (0,4 s). Pero crece lineal:
--
--     1.467 mensajes →  2 consultas → 0,4 s   (hoy)
--     6.000          →  6           → 1,2 s   (~4 meses)
--    20.000          → 20           → 4,0 s   (~1 año)
--    60.000          → 60           → 11,9 s  (cliente activo a 1 año)
--
-- Un portal que tarda 12 segundos en abrir no se usa. Y el arreglo no es traer
-- menos datos: es no traerlos. Postgres ya sabe cuál fue el último mensaje.
--
-- LA SOLUCIÓN
-- Tres columnas en ed_contactos que la propia base mantiene al día con un
-- trigger. Las pantallas pasan de "traer 60.000 filas y agregar" a "leer una
-- columna": O(1) en vez de O(n), sin importar cuánto crezca el historial.
--
-- POR QUÉ UN TRIGGER Y NO UNA VISTA MATERIALIZADA
-- La vista habría que refrescarla (otro cron que mantener) y quedaría desfasada
-- entre refrescos — inaceptable en una bandeja que se mira en vivo. El trigger
-- deja el dato correcto en el mismo instante en que entra el mensaje.
--
-- SEGURIDAD DEL TRIGGER (importante)
-- Corre en CADA inserción de mensaje, incluidas las respuestas del asistente en
-- vivo. Si fallara, dejaría de guardarse la conversación. Por eso va envuelto en
-- un manejo de excepciones: si algo sale mal, registra un aviso y deja pasar el
-- mensaje. Preferimos un resumen desactualizado antes que perder un mensaje.
--
-- APLICAR EN SUPABASE (SQL Editor). Aditiva y reversible.
-- ============================================================================

-- 1) Columnas del resumen -----------------------------------------------------
alter table ed_contactos add column if not exists ultimo_mensaje_en    timestamptz;
alter table ed_contactos add column if not exists ultimo_mensaje_texto text;
alter table ed_contactos add column if not exists ultimo_mensaje_rol   text;
alter table ed_contactos add column if not exists primer_mensaje_en    timestamptz;
alter table ed_contactos add column if not exists total_mensajes       integer not null default 0;
-- Qué empleado atiende el chat. La bandeja lo necesita para el enlace y el
-- avatar; sin esto habría que volver a mirar los mensajes.
alter table ed_contactos add column if not exists ultimo_empleado_id   uuid;

-- Orden por actividad reciente (el que usan las tres pantallas).
create index if not exists idx_ed_contactos_actividad
  on ed_contactos (cliente_id, ultimo_mensaje_en desc nulls last);

-- 2) Trigger que mantiene el resumen ------------------------------------------
create or replace function ed_actualizar_resumen_contacto()
returns trigger
language plpgsql
security definer
as $$
declare
  v_cliente uuid;
begin
  -- El mensaje conoce su empleado; el cliente sale de ahí.
  select cliente_id into v_cliente
  from ed_empleados
  where id = new.empleado_id;

  if v_cliente is null then
    return new; -- empleado huérfano: no hay ficha que actualizar
  end if;

  insert into ed_contactos as c (
    cliente_id, chat_id,
    ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol,
    ultimo_empleado_id, primer_mensaje_en, total_mensajes
  )
  values (
    v_cliente, new.chat_id,
    new.creado_en, left(coalesce(new.texto, ''), 300), new.rol,
    new.empleado_id, new.creado_en, 1
  )
  on conflict (cliente_id, chat_id) do update set
    -- Solo avanza si el mensaje es MÁS NUEVO que el registrado. Importa porque
    -- una importación de historial inserta mensajes viejos y no debe hacer
    -- retroceder el "último mensaje" de una conversación activa.
    ultimo_mensaje_en    = greatest(c.ultimo_mensaje_en, excluded.ultimo_mensaje_en),
    ultimo_mensaje_texto = case
                             when c.ultimo_mensaje_en is null
                               or excluded.ultimo_mensaje_en >= c.ultimo_mensaje_en
                             then excluded.ultimo_mensaje_texto
                             else c.ultimo_mensaje_texto
                           end,
    ultimo_mensaje_rol   = case
                             when c.ultimo_mensaje_en is null
                               or excluded.ultimo_mensaje_en >= c.ultimo_mensaje_en
                             then excluded.ultimo_mensaje_rol
                             else c.ultimo_mensaje_rol
                           end,
    ultimo_empleado_id   = case
                             when c.ultimo_mensaje_en is null
                               or excluded.ultimo_mensaje_en >= c.ultimo_mensaje_en
                             then excluded.ultimo_empleado_id
                             else c.ultimo_empleado_id
                           end,
    primer_mensaje_en    = least(coalesce(c.primer_mensaje_en, excluded.primer_mensaje_en),
                                 excluded.primer_mensaje_en),
    total_mensajes       = c.total_mensajes + 1,
    actualizado_en       = now();

  return new;
exception when others then
  -- NUNCA romper el guardado del mensaje por culpa del resumen.
  raise warning 'ed_actualizar_resumen_contacto falló: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_resumen_contacto on ed_mensajes;
create trigger trg_resumen_contacto
  after insert on ed_mensajes
  for each row execute function ed_actualizar_resumen_contacto();

-- 3) Relleno inicial con lo que ya existe -------------------------------------
-- Una sola pasada; después lo mantiene el trigger.
with agregado as (
  select
    e.cliente_id,
    m.chat_id,
    min(m.creado_en) as primero,
    max(m.creado_en) as ultimo,
    count(*)         as total
  from ed_mensajes m
  join ed_empleados e on e.id = m.empleado_id
  group by e.cliente_id, m.chat_id
),
ultimo_texto as (
  select distinct on (e.cliente_id, m.chat_id)
    e.cliente_id, m.chat_id, m.texto, m.rol, m.empleado_id
  from ed_mensajes m
  join ed_empleados e on e.id = m.empleado_id
  order by e.cliente_id, m.chat_id, m.creado_en desc
)
insert into ed_contactos as c (
  cliente_id, chat_id,
  ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol,
  ultimo_empleado_id, primer_mensaje_en, total_mensajes
)
select
  a.cliente_id, a.chat_id,
  a.ultimo, left(coalesce(t.texto, ''), 300), t.rol,
  t.empleado_id, a.primero, a.total
from agregado a
left join ultimo_texto t
  on t.cliente_id = a.cliente_id and t.chat_id = a.chat_id
on conflict (cliente_id, chat_id) do update set
  ultimo_mensaje_en    = excluded.ultimo_mensaje_en,
  ultimo_mensaje_texto = excluded.ultimo_mensaje_texto,
  ultimo_mensaje_rol   = excluded.ultimo_mensaje_rol,
  ultimo_empleado_id   = excluded.ultimo_empleado_id,
  primer_mensaje_en    = excluded.primer_mensaje_en,
  total_mensajes       = excluded.total_mensajes;

comment on column ed_contactos.total_mensajes is
  'Mantenido por trigger. Evita recorrer ed_mensajes para contar.';
