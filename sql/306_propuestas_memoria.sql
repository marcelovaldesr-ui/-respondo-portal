-- ============================================================================
-- 306 · PROPUESTAS DE BETO: MEMORIA DEL JUEZ (Fase 0, 11-sep-2026)
-- ============================================================================
--
-- Requiere la 297. Idempotente: se puede correr dos veces.
--
-- (Renumerada de 304 a 306 el 12-sep-2026: el número 304 ya lo tenía
-- `304_marketing_endurecimiento.sql` —aplicada— y el 305 la autorización
-- fail-closed. El contenido no cambió.)
--
-- POR QUÉ
-- -------
-- El generador de seguimientos de cotización corre cada 5 minutos. Cuando el
-- juez frenaba un candidato no quedaba registro, así que en la corrida
-- siguiente se le volvía a pagar al modelo por leer el mismo hilo. En modo
-- aprobación era peor: las propuestas no gastan cupo del día, y el juez se
-- consultaba hasta `cotizacion_tope_diario` veces cada 5 minutos.
--
-- Ahora el "no" del juez se guarda como una fila `frenado` (resuelta al
-- instante, por 'juez'). Un candidato frenado o rechazado no se vuelve a
-- evaluar hasta que la conversación tenga un mensaje nuevo.
--
-- ⚠️ No envía nada ni enciende nada. `cotizacion_seguimiento` sigue en false.
-- ============================================================================

alter table ed_propuestas_seguimiento
  drop constraint if exists ed_propuestas_seguimiento_estado_check;
alter table ed_propuestas_seguimiento
  add constraint ed_propuestas_seguimiento_estado_check
  check (estado in ('propuesto', 'aprobado', 'rechazado', 'vencido', 'frenado'));

-- La consulta del generador: la última decisión por chat de un negocio y tipo.
create index if not exists idx_ed_propuestas_memoria
  on ed_propuestas_seguimiento (cliente_id, tipo, chat_id, creado_en desc);

-- Verificación: debe listar 'frenado' dentro del check.
select pg_get_constraintdef(oid) as check_estado
from pg_constraint
where conname = 'ed_propuestas_seguimiento_estado_check';
