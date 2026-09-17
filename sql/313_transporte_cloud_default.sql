-- ============================================================================
-- 313_transporte_cloud_default.sql · Default Cloud API para nuevos clientes
-- ----------------------------------------------------------------------------
-- MOTIVO:
--   La migración 216 definió `transporte text not null default 'waha'`.
--   Hoy Respondo es Tech Provider oficial de Meta y todos los clientes nuevos
--   deben operar en WhatsApp Cloud API por defecto.
--
-- SEGURIDAD & COMPATIBILIDAD:
--   - Es 100% aditiva e idempotente.
--   - NO ejecuta ningún UPDATE masivo sobre clientes existentes (Impresora Color
--     u otros clientes legacy con 'waha' se mantienen INTACTOS).
--   - Solo altera el valor por defecto de la columna para inserts futuros.
-- ============================================================================

alter table ed_clientes alter column transporte set default 'cloud';

comment on column ed_clientes.transporte is
  'Canal de SALIDA de mensajes: cloud (WhatsApp Cloud API oficial, default para nuevos clientes) | waha (no oficial, legacy).';
