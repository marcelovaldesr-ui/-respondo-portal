-- 278_cupo_conversaciones.sql
--
-- MEDIR LA UNIDAD QUE VENDEMOS.
--
-- Desde el 12-ago-2026 Respondo vende por CONVERSACIONES incluidas
-- (800 / 1.200 / 3.000 / 6.000 según plan, ver
-- estrategia-comercial/PLANES_Y_PRECIOS_RESPONDO.md). Hasta hoy el portal no
-- contaba conversaciones: el número de referencia de Impresora Color (357 al
-- mes) salió de un script suelto. Vender un cupo que no se mide es la receta
-- para una discusión con el cliente en el mes 3.
--
-- DEFINICIÓN OFICIAL (la misma que Meta, Vambe y Cliengo):
--   Una conversación es todo el contacto con un mismo cliente dentro de una
--   ventana de 24 horas corridas, sin importar cuántos mensajes incluya.
--
-- Con dos reglas finas que decidimos nosotros:
--   1. La ventana se ancla en el PRIMER mensaje y dura 24 h corridas. No es
--      "24 h desde el mensaje anterior": si alguien escribe cada 20 h para
--      siempre, eso son conversaciones distintas, no una eterna.
--   2. Si NADIE respondió, no se cuenta. Un "hola" suelto, un número
--      equivocado o spam no le consumen cupo al cliente. Alinea el cobro con
--      el trabajo que hizo el asistente y nos saca de discutir por spam.
--
-- NO CORTAMOS EL SERVICIO al pasarse del cupo. Cliengo sí lo hace; una pyme
-- sin atención a mitad de mes pierde ventas y nos culpa a nosotros. Se avisa
-- al 80% y al 100% y se cobra el excedente.

-- ---------------------------------------------------------------------------
-- 1. Plan y cupo por cliente
-- ---------------------------------------------------------------------------

alter table ed_clientes
  add column if not exists plan text,
  add column if not exists cupo_conversaciones integer,
  add column if not exists conversaciones_extra integer not null default 0;

-- Nombres de plan tal como se venden. 'a_medida' existe para el trato que no
-- calza en ninguno: ahí el cupo se escribe a mano en cupo_conversaciones.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ed_clientes_plan_valido') then
    alter table ed_clientes add constraint ed_clientes_plan_valido
      check (plan is null or plan in ('tino_solo','inicial','crecimiento','empresa','a_medida'));
  end if;
end $$;

comment on column ed_clientes.plan is
  'Plan comercial contratado. NULL = todavía sin plan asignado (no se avisa ni se mide cupo).';
comment on column ed_clientes.cupo_conversaciones is
  'Conversaciones incluidas al mes. NULL = sin límite configurado; el portal muestra el consumo pero no avisa.';
comment on column ed_clientes.conversaciones_extra is
  'Packs adicionales comprados para el ciclo en curso. Se suman al cupo del plan.';

-- Backfill: nadie queda con cupo por accidente. Los clientes existentes siguen
-- exactamente igual que antes (plan NULL = medición visible, cero avisos)
-- hasta que Marcelo les asigne el plan a mano. FAIL-SAFE a propósito: si el
-- contador tuviera un error, no le llega un aviso equivocado a ningún cliente.

-- ---------------------------------------------------------------------------
-- 2. El contador
-- ---------------------------------------------------------------------------

-- Se calcula al vuelo en vez de materializar una tabla de conversaciones.
-- Con el volumen real (Impresora Color, el cliente más cargado, hace ~4.200
-- mensajes al mes) esto recorre unas pocas miles de filas y responde en
-- milisegundos. Materializar traería un problema de sincronización a cambio de
-- nada. Si algún día un cliente hace 100k mensajes al mes, se revisa.
--
-- Va en plpgsql y no en TypeScript porque la ventana se ancla en el primer
-- mensaje: es un recorrido secuencial con estado, que en SQL de conjuntos
-- queda ilegible, y traerse 4.000 filas por HTTP para contarlas en Node sería
-- peor (PostgREST pagina de a 1.000: cinco viajes para un número).

create index if not exists idx_ed_mensajes_empleado_creado
  on ed_mensajes (empleado_id, chat_id, creado_en);

create or replace function ed_contar_conversaciones(
  p_cliente uuid,
  p_desde   timestamptz,
  p_hasta   timestamptz
) returns integer
language plpgsql
stable
as $$
declare
  v_chat       text        := null;
  v_ancla      timestamptz := null;
  v_respondida boolean     := false;
  v_total      integer     := 0;
  r            record;
begin
  for r in
    select m.chat_id, m.creado_en, m.rol
      from ed_mensajes m
      join ed_empleados e on e.id = m.empleado_id
     where e.cliente_id = p_cliente
       and m.creado_en >= p_desde
       and m.creado_en <  p_hasta
     order by m.chat_id, m.creado_en
  loop
    -- Abre ventana nueva si cambió el contacto, o si pasaron 24 h desde el
    -- PRIMER mensaje de la ventana en curso (v_ancla), no desde el anterior.
    if v_chat is distinct from r.chat_id
       or r.creado_en - v_ancla >= interval '24 hours' then
      -- Se cierra la ventana anterior: solo suma si alguien respondió.
      if v_respondida then
        v_total := v_total + 1;
      end if;
      v_chat       := r.chat_id;
      v_ancla      := r.creado_en;
      v_respondida := false;
    end if;

    -- 'empleado' = respondió el asistente · 'humano' = respondió el equipo.
    -- Los dos cuentan como atención: al cliente le da igual quién escribió.
    if r.rol in ('empleado','humano') then
      v_respondida := true;
    end if;
  end loop;

  -- La última ventana del recorrido no la cierra nadie dentro del loop.
  if v_respondida then
    v_total := v_total + 1;
  end if;

  return v_total;
end;
$$;

comment on function ed_contar_conversaciones(uuid, timestamptz, timestamptz) is
  'Conversaciones de un cliente en un período. Ventana de 24 h anclada en el primer mensaje; no cuenta las que nadie respondió.';

-- ---------------------------------------------------------------------------
-- 3. Avisos de cupo (una sola vez por umbral y por ciclo)
-- ---------------------------------------------------------------------------

create table if not exists ed_avisos_cupo (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references ed_clientes(id) on delete cascade,
  ciclo      text not null,                 -- '2026-08'
  umbral     integer not null check (umbral in (80, 100)),
  consumo    integer not null,
  cupo       integer not null,
  avisado_en timestamptz not null default now()
);

-- LA BARRERA CONTRA EL SPAM. El cron corre cada 5 minutos; sin esto, un
-- cliente al 81% recibiría 288 mensajes al día. El insert del aviso va ANTES
-- del envío: si el envío falla, no se reintenta, y es lo correcto — mejor un
-- aviso perdido que una avalancha.
create unique index if not exists idx_ed_avisos_cupo_unico
  on ed_avisos_cupo (cliente_id, ciclo, umbral);

alter table ed_avisos_cupo enable row level security;

comment on table ed_avisos_cupo is
  'Registro de avisos de cupo enviados. El índice único es lo que impide reenviar el mismo aviso.';

-- ---------------------------------------------------------------------------
-- 4. Verificación
-- ---------------------------------------------------------------------------

select
  (select count(*) from information_schema.columns
    where table_name='ed_clientes'
      and column_name in ('plan','cupo_conversaciones','conversaciones_extra')) as cols_clientes,  -- espera 3
  (select count(*) from pg_proc where proname='ed_contar_conversaciones')       as fn_contador,    -- espera 1
  (select count(*) from information_schema.tables
    where table_name='ed_avisos_cupo')                                          as tabla_avisos;   -- espera 1
