-- ============================================================================
-- 215_indices_rendimiento.sql · Índices de las consultas calientes
-- ----------------------------------------------------------------------------
-- HALLAZGO (auditoría 30-jul-2026): ed_mensajes NO tenía índice para su patrón
-- de consulta principal. Hoy no se nota (pocos chats), pero al conectar el
-- WhatsApp real —cientos de chats, miles de mensajes— cada una de estas
-- consultas haría un recorrido secuencial de la tabla completa:
--
--   1. Abrir una conversación:      where empleado_id + chat_id order by creado_en
--   2. Polling del inbox (cada 4s): la MISMA consulta, repetida sin parar
--   3. Bandeja completa:            where empleado_id in (...) order by creado_en desc
--   4. Idempotencia de cada entrante: where empleado_id + wa_message_id (ya tiene índice)
--
-- El #2 es el crítico: con el inbox abierto son ~900 consultas/hora por usuario.
-- Sin índice, eso degrada toda la base a medida que crece el historial.
--
-- APLICAR EN SUPABASE (SQL editor). Es seguro y reversible (drop index).
-- ============================================================================

-- 1) Conversación abierta + polling en vivo (el más caliente).
create index if not exists idx_ed_mensajes_emp_chat_fecha
  on ed_mensajes (empleado_id, chat_id, creado_en desc);

-- 2) Listado de la bandeja (mensajes recientes de todos los chats del empleado).
create index if not exists idx_ed_mensajes_emp_fecha
  on ed_mensajes (empleado_id, creado_en desc);

-- 3) Estado del chat (modo bot/humano) — se consulta en cada mensaje entrante
--    y en cada refresco del inbox.
create index if not exists idx_ed_chat_estado_emp_chat
  on ed_chat_estado (empleado_id, chat_id);

-- 4) Escalaciones pendientes (badge "te esperan" del dashboard y la bandeja).
create index if not exists idx_ed_escalaciones_pendientes
  on ed_escalaciones (empleado_id, chat_id) where atendida_en is null;

-- 5) Contactos por chat (nombre a mostrar; se resuelve en cada listado).
create index if not exists idx_ed_contactos_cliente_chat
  on ed_contactos (cliente_id, chat_id);

-- 6) Motor de seguimientos: los pendientes vencidos que busca el cron.
create index if not exists idx_ed_seguimientos_pendientes
  on ed_seguimientos (programado_para) where enviado_en is null;

-- 7) Ruteo de respuestas a Beto/Vera (seguimiento activo de un chat).
create index if not exists idx_ed_seguimientos_chat_envio
  on ed_seguimientos (chat_id, enviado_en desc);
