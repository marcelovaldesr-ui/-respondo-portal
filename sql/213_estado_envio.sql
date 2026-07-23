-- =============================================================================
-- 213: Estado de entrega de los envíos (Fase 5 — blindaje WhatsApp Opción A)
-- -----------------------------------------------------------------------------
-- Los envíos de Tino ya no son "fire-and-forget": Evolution ahora reporta los
-- ACKs por webhook (evento MESSAGES_UPDATE, ya configurado en la instancia) y
-- el portal los guarda aquí. Con esto el portal puede distinguir un mensaje
-- ENTREGADO de uno que WhatsApp nunca entregó (estado ERROR o sin ack).
--
-- Valores de estado_envio (mapeados desde Evolution/Baileys):
--   'pendiente'  → aceptado por Evolution, sin confirmación del servidor aún
--   'server_ack' → el servidor de WhatsApp lo aceptó (1 tick)
--   'entregado'  → llegó al dispositivo del destinatario (2 ticks)
--   'leido'      → leído (2 ticks azules)
--   'error'      → WhatsApp NO lo pudo entregar (el modo de falla del 22-jul)
--   NULL         → mensaje anterior a esta migración, o entrante (rol != empleado)
-- =============================================================================

alter table ed_mensajes add column if not exists estado_envio text;
alter table ed_mensajes add column if not exists estado_envio_en timestamptz;

comment on column ed_mensajes.estado_envio is
  'Estado de entrega del envío (solo rol=empleado): pendiente|server_ack|entregado|leido|error';
comment on column ed_mensajes.estado_envio_en is
  'Momento del último cambio de estado de entrega';

-- Para encontrar rápido los "no entregados" de un empleado (ficha/alertas):
create index if not exists ed_mensajes_envio_error_idx
  on ed_mensajes (empleado_id, creado_en desc)
  where estado_envio = 'error';

-- Consulta de referencia para el portal ("mensajes posiblemente no entregados"):
--   select * from ed_mensajes
--   where empleado_id = :empleado
--     and rol = 'empleado'
--     and (estado_envio = 'error'
--          or (estado_envio is distinct from 'entregado'
--              and estado_envio is distinct from 'leido'
--              and creado_en < now() - interval '2 minutes'))
--   order by creado_en desc;
