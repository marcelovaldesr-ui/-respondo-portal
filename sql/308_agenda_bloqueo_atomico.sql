-- ─────────────────────────────────────────────────────────────────────────────
-- 308 · AGENDA — garantía atómica cita ↔ bloqueo (auditoría externa, 13-sep-2026)
--
-- QUÉ ARREGLA. El EXCLUDE de ed_citas (220, reescrito en 260) impide que dos
-- CITAS del mismo profesional se solapen — pero un EXCLUDE vive dentro de una
-- sola tabla. ed_bloqueos es una tabla aparte, así que nada en la base impedía
-- que una cita se confirmara ENCIMA de un bloqueo. lib/agenda.ts::disponibilidad
-- ya excluye los bloqueos al calcular los cupos ofrecidos, pero leer y después
-- escribir no es una transacción: cabe una ventana real.
--
-- LA CARRERA EXACTA:
--   T0  cliente consulta disponibilidad → 10:00 aparece libre
--   T1  el dueño crea un bloqueo 10:00–12:00 (vacaciones, imprevisto)
--   T2  el cliente confirma el cupo que vio en T0
--   T3  crearCita inserta en ed_citas → nada en la base lo impide
--
-- Con más de un proceso escribiendo a la vez (web pública + Tino + portal) el
-- simple "SELECT bloqueos antes del INSERT" that lib/agenda.ts podría hacer
-- NO alcanza: sigue siendo dos sentencias, así que sigue habiendo ventana
-- (TOCTOU). La única forma de cerrarla de verdad es en la base, en la misma
-- transacción que hace el INSERT/UPDATE.
--
-- LA SOLUCIÓN: un advisory lock transaccional por NEGOCIO (cliente_id).
-- Antes de comprobar el solape, la fila toma pg_advisory_xact_lock(cliente_id).
-- Postgres bloquea a cualquier OTRA transacción que pida el mismo lock hasta
-- que la primera termine (commit o rollback) — el lock se libera solo, no hace
-- falta un UNLOCK explícito ni hay riesgo de dejarlo pegado. Con el lock ya
-- tomado, la lectura de ed_bloqueos que sigue es segura: ninguna otra
-- transacción de ESTE negocio puede estar insertando una cita o un bloqueo en
-- paralelo.
--
-- POR QUÉ POR CLIENTE_ID Y NO POR PROFESIONAL_ID. Sería más fino (más
-- concurrencia entre profesionales del mismo negocio), pero un bloqueo con
-- profesional_id NULL afecta a TODOS los profesionales del negocio a la vez, y
-- serializar correctamente ese caso exigiría tomar el lock de cada profesional
-- uno por uno (riesgo de deadlock por orden distinto entre transacciones). Un
-- solo lock por negocio es simple, siempre correcto, y el costo es minúsculo:
-- se sostiene solo durante el INSERT/UPDATE de una fila, milisegundos, y el
-- volumen de escritura de agenda de un negocio chico nunca lo va a notar.
--
-- POR QUÉ NO TOCA A LAS CLASES GRUPALES (clase_id no nulo). El solape ENTRE
-- inscripciones de la MISMA clase es el producto, no un bug (ver 260); el
-- horario de la clase en sí ya se fija una sola vez en ed_clases. Se excluye
-- con el mismo predicado que ya usa ed_citas_sin_solape, a propósito: es el
-- límite que el propio modelo de datos ya trazó, no uno nuevo.
--
-- POR QUÉ NO TOCA A crearCitaManual. La cita del portal sigue pudiendo
-- agendarse FUERA DE HORARIO si el dueño quiere (esa permisividad es
-- deliberada — ver el comentario en acciones.ts) porque `horario` nunca se
-- valida acá, solo en el cálculo de disponibilidad. Lo que esta migración
-- agrega es distinto: un BLOQUEO es una decisión explícita del propio dueño
-- ("acá no atiendo"), y que su propia agenda manual lo pise en silencio no es
-- parte de esa permisividad — es el bug que se está cerrando.
--
-- LA GARANTÍA INVERSA. Crear un bloqueo ENCIMA de una cita activa tampoco es
-- gratis: hoy pasa en silencio y el dueño puede no darse cuenta de que ya
-- tiene gente agendada en ese rango. Se aplica el mismo candado simétrico. El
-- portal (crearBloqueo, en acciones.ts) hoy no tiene forma de mostrar este
-- error en pantalla —eso es un cambio de interfaz, fuera del alcance de este
-- fix—, así que por ahora el bloqueo simplemente NO se crea y el detalle queda
-- en los logs del servidor. Preferible a que se cree e ignore la cita: fallar
-- en silencio es más seguro que tener éxito en silencio. Documentado como
-- pendiente en el cierre de esta auditoría.
--
-- ANTES DE APLICAR: no borra ni modifica filas existentes. Si YA hay una cita
-- activa encima de un bloqueo (deuda de antes de este fix), esta migración no
-- la toca — solo impide que pase una MÁS a partir de ahora. Para ver las que
-- ya existen:
--
--   select c.id as cita_id, c.inicio, c.fin, b.id as bloqueo_id, b.motivo
--     from ed_citas c
--     join ed_bloqueos b
--       on b.cliente_id = c.cliente_id
--      and (b.profesional_id = c.profesional_id or b.profesional_id is null)
--      and tstzrange(b.desde, b.hasta) && tstzrange(c.inicio, c.fin)
--    where c.estado in ('agendada','confirmada','reagendada')
--      and c.clase_id is null;
--
-- Revisar a mano cada fila (puede ser legítima: un bloqueo cargado después
-- para otra cosa, un ajuste manual ya conversado con el cliente).
-- ─────────────────────────────────────────────────────────────────────────────

-- TRANSACCIONAL (microfix 14-sep-2026, cierre Antigravity). Todo el DDL de
-- abajo corre dentro de una sola transacción: si algo falla a mitad de
-- camino (por ejemplo, un permiso que no existiera), Postgres deshace TODO
-- —ninguna función o trigger a medio crear— en vez de dejar la migración a
-- medio aplicar. No cambia funciones, locks, predicados, código de error,
-- permisos ni comportamiento: solo envuelve el mismo DDL en BEGIN/COMMIT.
-- Sigue siendo re-ejecutable las veces que haga falta gracias a
-- CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS / CREATE TRIGGER.
begin;

-- ── 1) Cita → no puede caer dentro de un bloqueo activo ────────────────────
create or replace function public.ed_citas_verificar_bloqueo()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Serializa contra cualquier otra escritura de citas/bloqueos de ESTE
  -- negocio. Se libera solo al terminar la transacción (commit o rollback).
  perform pg_advisory_xact_lock(hashtextextended(new.cliente_id::text, 0));

  if exists (
    select 1
      from public.ed_bloqueos b
     where b.cliente_id = new.cliente_id
       and (b.profesional_id = new.profesional_id or b.profesional_id is null)
       and tstzrange(b.desde, b.hasta) && tstzrange(new.inicio, new.fin)
  ) then
    raise exception 'Ese horario está bloqueado para este profesional.'
      using errcode = 'ED001';
  end if;

  return new;
end;
$$;
revoke all on function public.ed_citas_verificar_bloqueo() from public, anon, authenticated;

drop trigger if exists trg_ed_citas_verificar_bloqueo on public.ed_citas;
create trigger trg_ed_citas_verificar_bloqueo
  before insert or update of inicio, fin, profesional_id, estado on public.ed_citas
  for each row
  -- Mismo predicado que ed_citas_sin_solape (260): solo citas 1:1 activas.
  -- Cancelada/no_show/completada no ocupan agenda; las inscripciones a clase
  -- (clase_id no nulo) tienen su propio modelo de solape, ver 260.
  when (new.estado in ('agendada', 'confirmada', 'reagendada') and new.clase_id is null)
  execute function public.ed_citas_verificar_bloqueo();

-- ── 2) Bloqueo → no puede caer encima de una cita activa ───────────────────
create or replace function public.ed_bloqueos_verificar_cita()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.cliente_id::text, 0));

  if exists (
    select 1
      from public.ed_citas c
     where c.cliente_id = new.cliente_id
       and c.clase_id is null
       and c.estado in ('agendada', 'confirmada', 'reagendada')
       and (new.profesional_id is null or c.profesional_id = new.profesional_id)
       and tstzrange(c.inicio, c.fin) && tstzrange(new.desde, new.hasta)
  ) then
    raise exception 'Ese rango ya tiene una cita activa; revisa antes de bloquearlo.'
      using errcode = 'ED001';
  end if;

  return new;
end;
$$;
revoke all on function public.ed_bloqueos_verificar_cita() from public, anon, authenticated;

drop trigger if exists trg_ed_bloqueos_verificar_cita on public.ed_bloqueos;
create trigger trg_ed_bloqueos_verificar_cita
  before insert on public.ed_bloqueos
  for each row execute function public.ed_bloqueos_verificar_cita();

-- ── permisos: el service_role es el único que escribe estas tablas ─────────
grant execute on function public.ed_citas_verificar_bloqueo() to service_role;
grant execute on function public.ed_bloqueos_verificar_cita() to service_role;

commit;
