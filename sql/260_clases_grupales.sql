-- ============================================================================
-- 260_clases_grupales.sql · Clases con cupo (pilates, crossfit, spinning)
-- ----------------------------------------------------------------------------
-- QUÉ RESUELVE
-- Hasta ahora la agenda era estrictamente 1:1: una hora, un profesional, una
-- persona. Sirve para barbería y clínica, pero no para un gimnasio, donde la
-- unidad no es "una hora libre" sino "la clase de las 19:00, con 12 lugares".
--
-- LA DIFERENCIA NO ES DE TAMAÑO, ES DE MODELO
-- En 1:1 la regla es que NADA se solape. En una clase, el solape ES el
-- producto: doce personas ocupan exactamente el mismo bloque. Por eso no basta
-- con subir un número — hace falta que la sesión exista como entidad propia,
-- con su cupo, y que la inscripción sea otra cosa que una cita.
--
-- DECISIÓN QUE VALE LA PENA CONOCER: EL ALUMNO NO TIENE CUENTA
-- No se crea registro de usuario para quien reserva. La identidad es su
-- teléfono, que ya llega verificado por WhatsApp y ya vive en ed_contactos.
-- Plataformas como Vita o Mindbody sí piden cuenta, pero porque son productos
-- web donde el gimnasio empuja a sus socios a una app. Acá el alumno ya está
-- en una conversación: pedirle además que se registre es el mayor asesino de
-- conversión que existe en reservas, y de paso tirar a la basura la ventaja.
--
-- APLICAR EN SUPABASE (SQL Editor). Aditiva y reversible.
-- Requiere: migración 220 (agenda) aplicada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) La sesión existe como entidad
-- ---------------------------------------------------------------------------
create table if not exists ed_clases (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  servicio_id     uuid not null references ed_servicios(id),
  profesional_id  uuid not null references ed_profesionales(id),
  inicio          timestamptz not null,
  fin             timestamptz not null,
  cupo_maximo     int not null check (cupo_maximo > 0 and cupo_maximo <= 500),
  cupo_ocupado    int not null default 0 check (cupo_ocupado >= 0),
  estado          text not null default 'activa'
                  check (estado in ('activa','cancelada')),
  notas           text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  check (inicio < fin),
  -- Nunca más inscritos que lugares. Es la garantía que hace innecesario
  -- confiar en que el código JS contó bien.
  constraint ed_clases_cupo_coherente check (cupo_ocupado <= cupo_maximo),

  -- Un profesional no puede dictar dos clases encimadas. Mismo mecanismo que
  -- ed_citas. El solape ENTRE inscripciones de la MISMA clase es el punto del
  -- diseño, no un problema — por eso esta regla vive acá y no en ed_citas.
  constraint ed_clases_sin_solape exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado = 'activa')
);

create index if not exists idx_ed_clases_cliente_dia
  on ed_clases (cliente_id, inicio) where estado = 'activa';
create index if not exists idx_ed_clases_servicio
  on ed_clases (servicio_id, inicio);

-- ---------------------------------------------------------------------------
-- 2) Una inscripción es una cita que apunta a una clase
-- ---------------------------------------------------------------------------
-- Se reutiliza ed_citas entera —nombre, teléfono, estado, cancelación,
-- recordatorios, encuesta— en vez de crear una tabla paralela. Así todo lo que
-- ya funciona para una hora 1:1 funciona igual para una inscripción, sin
-- duplicar código ni tener dos formas de cancelar.
alter table ed_citas add column if not exists clase_id uuid references ed_clases(id);
create index if not exists idx_ed_citas_clase on ed_citas (clase_id) where clase_id is not null;

-- ---------------------------------------------------------------------------
-- 3) EL AJUSTE CRÍTICO: el anti-solape deja de aplicar a las inscripciones
-- ---------------------------------------------------------------------------
-- Sin esto, la PRIMERA persona que se inscribe a la clase de las 19:00 bloquea
-- a todas las demás — por exactamente la misma regla que hoy impide el doble
-- agendamiento. El constraint sigue intacto para las citas 1:1, que es donde
-- tiene que seguir siendo implacable.
alter table ed_citas drop constraint if exists ed_citas_sin_solape;
alter table ed_citas add constraint ed_citas_sin_solape exclude using gist (
  profesional_id with =,
  tstzrange(inicio, fin) with &&
) where (estado in ('agendada','confirmada','reagendada') and clase_id is null);

-- ---------------------------------------------------------------------------
-- 4) Inscripción atómica — el último lugar lo gana uno solo
-- ---------------------------------------------------------------------------
-- Si dos personas tocan "reservar" en el mismo instante para el último cupo,
-- una tiene que perder. El UPDATE condicional bloquea la fila de la clase, así
-- que la segunda ve el cupo ya tomado y no afecta ninguna fila.
--
-- Va como función y no como dos consultas desde JS porque entre el "quedan
-- lugares" y el "insertar" no puede haber una ventana: es exactamente la
-- carrera que se quiere cerrar.
create or replace function ed_inscribir_en_clase(
  p_clase_id  uuid,
  p_cliente_id uuid,
  p_nombre    text,
  p_telefono  text,
  p_chat_id   text,
  p_origen    text default 'web',
  p_empleado_id uuid default null
)
returns table (ok boolean, motivo text, cita_id uuid, cupo_ocupado int, cupo_maximo int)
language plpgsql
security definer
as $$
declare
  v_clase   ed_clases%rowtype;
  v_cita_id uuid;
begin
  -- Reserva el lugar y bloquea la fila en un solo paso.
  update ed_clases c
     set cupo_ocupado = c.cupo_ocupado + 1,
         actualizado_en = now()
   where c.id = p_clase_id
     and c.cliente_id = p_cliente_id      -- barrera de acceso entre negocios
     and c.estado = 'activa'
     and c.inicio > now()                 -- no se inscribe a algo que ya pasó
     and c.cupo_ocupado < c.cupo_maximo
  returning * into v_clase;

  if not found then
    -- Se distingue el motivo para poder decirle algo útil a la persona.
    select * into v_clase from ed_clases
     where id = p_clase_id and cliente_id = p_cliente_id;
    if v_clase.id is null then
      return query select false, 'no_existe'::text, null::uuid, 0, 0;
    elsif v_clase.estado <> 'activa' then
      return query select false, 'cancelada'::text, null::uuid,
                          v_clase.cupo_ocupado, v_clase.cupo_maximo;
    elsif v_clase.inicio <= now() then
      return query select false, 'ya_paso'::text, null::uuid,
                          v_clase.cupo_ocupado, v_clase.cupo_maximo;
    else
      -- Mismo vocabulario que usa la agenda 1:1 para el cupo perdido, así el
      -- resto del sistema no necesita aprender un caso nuevo.
      return query select false, 'cupo_tomado'::text, null::uuid,
                          v_clase.cupo_ocupado, v_clase.cupo_maximo;
    end if;
    return;
  end if;

  -- Misma transacción: si esto falla, el cupo vuelve solo.
  insert into ed_citas (
    cliente_id, servicio_id, profesional_id, clase_id,
    chat_id, nombre_contacto, telefono, inicio, fin, origen, empleado_id
  ) values (
    p_cliente_id, v_clase.servicio_id, v_clase.profesional_id, v_clase.id,
    p_chat_id, p_nombre, p_telefono, v_clase.inicio, v_clase.fin,
    p_origen, p_empleado_id
  ) returning id into v_cita_id;

  return query select true, 'ok'::text, v_cita_id,
                      v_clase.cupo_ocupado, v_clase.cupo_maximo;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Al cancelar una inscripción, el lugar se libera solo
-- ---------------------------------------------------------------------------
-- Por trigger y no desde el código: una inscripción se puede cancelar desde el
-- portal, desde WhatsApp o desde la página pública, y el cupo tiene que volver
-- en los tres casos. Si dependiera de que cada camino se acuerde de
-- decrementar, tarde o temprano uno se olvida y la clase queda llena con
-- lugares libres — un error que nadie nota hasta que un alumno reclama.
create or replace function ed_liberar_cupo_clase()
returns trigger
language plpgsql
security definer
as $$
declare
  activos constant text[] := array['agendada','confirmada','reagendada'];
begin
  if new.clase_id is null then
    return new;
  end if;
  -- Pasó de activa a no activa → devuelve el lugar.
  if old.estado = any(activos) and not (new.estado = any(activos)) then
    update ed_clases
       set cupo_ocupado = greatest(0, cupo_ocupado - 1), actualizado_en = now()
     where id = new.clase_id;
  -- Reactivación (reabrir una inscripción cancelada) → lo vuelve a tomar, si hay.
  elsif not (old.estado = any(activos)) and new.estado = any(activos) then
    update ed_clases
       set cupo_ocupado = least(cupo_maximo, cupo_ocupado + 1), actualizado_en = now()
     where id = new.clase_id;
  end if;
  return new;
exception when others then
  -- Nunca impedir que una cancelación se guarde por culpa del contador.
  raise warning 'ed_liberar_cupo_clase falló: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_liberar_cupo_clase on ed_citas;
create trigger trg_liberar_cupo_clase
  after update of estado on ed_citas
  for each row execute function ed_liberar_cupo_clase();

comment on table ed_clases is
  'Sesión grupal con cupo. Una inscripción es una fila de ed_citas con clase_id.';
comment on column ed_citas.clase_id is
  'Si no es null, esta cita es la inscripción de una persona a una clase grupal.';
