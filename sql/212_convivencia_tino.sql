-- ============================================================================
-- 212_convivencia_tino.sql  ·  Convivencia Tino + atención humana (Opción A)
-- ----------------------------------------------------------------------------
-- Da soporte robusto a la atención híbrida (copiloto) sobre Evolution API:
--
-- 1) ed_mensajes.wa_message_id: guarda el id del mensaje de WhatsApp (data.key.id
--    del webhook de Evolution). Sirve para DOS cosas críticas:
--      a) IDEMPOTENCIA: si Evolution reenvía el mismo evento, no se procesa dos
--         veces (no hay respuestas duplicadas).
--      b) DISTINGUIR EL ECO DE TINO de un mensaje humano: cuando Tino envía,
--         guardamos el id devuelto por Evolution; el webhook 'fromMe' con ese
--         mismo id es el eco de Tino y se ignora. Un 'fromMe' con id desconocido
--         es un mensaje que escribió una PERSONA (Cecilia) desde el WhatsApp:
--         eso dispara la toma de control humana.
--
-- 2) Índice único parcial (empleado_id, wa_message_id): idempotencia a nivel de
--    base de datos. Un segundo INSERT con el mismo id falla en vez de duplicar.
--
-- Aditivo e inocuo. Idempotente (IF NOT EXISTS). No toca datos existentes ni la
-- Opción B (Cloud API), que simplemente deja wa_message_id en NULL.
-- ============================================================================

alter table ed_mensajes
  add column if not exists wa_message_id text;

comment on column ed_mensajes.wa_message_id is
  'ID del mensaje de WhatsApp (Evolution data.key.id). Idempotencia + distinción de eco de Tino vs. mensaje humano. NULL en Opción B / mensajes internos.';

-- Búsqueda rápida por id (idempotencia y detección de eco).
create index if not exists idx_ed_mensajes_wa_id
  on ed_mensajes (empleado_id, wa_message_id);

-- Idempotencia dura: no puede haber dos mensajes con el mismo id para el mismo
-- empleado. Parcial: solo aplica cuando wa_message_id no es NULL, así la Opción B
-- (que no llena esta columna) no se ve afectada.
create unique index if not exists uq_ed_mensajes_emp_waid
  on ed_mensajes (empleado_id, wa_message_id)
  where wa_message_id is not null;
