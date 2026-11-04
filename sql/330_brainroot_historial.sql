-- 330 · La cola de BrainRoot acepta los eventos del historial de Coexistencia (3-nov-2026)
-- Idempotente. NO se aplica sola: la aplica un humano en Supabase.
-- Sin esto el portal igual entrega el historial (intento directo, sin reintentos).

alter table ed_eventos_brainroot drop constraint if exists ed_eventos_brainroot_tipo_check;
alter table ed_eventos_brainroot add constraint ed_eventos_brainroot_tipo_check
  check (tipo in ('message.status','message.inbound','contact.optout','message.outbound','history.thread','history.error'));
