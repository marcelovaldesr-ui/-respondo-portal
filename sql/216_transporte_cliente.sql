-- ============================================================================
-- 216_transporte_cliente.sql · Interruptor WAHA ↔ Cloud API por cliente
-- ----------------------------------------------------------------------------
-- HALLAZGO (30-jul-2026): el código YA usa `ed_clientes.transporte` en dos
-- lugares —el envío del inbox (conversaciones/acciones.ts) y el cron de
-- seguimientos— pero la columna NUNCA se creó. Ambos son defensivos y caen a
-- 'waha', así que hoy funciona; el problema aparece DESPUÉS:
--
--   Cuando Meta apruebe la app y se conecte el número oficial de un cliente,
--   NO habrá forma de decirle al portal "este cliente ahora sale por Cloud API".
--   Seguiría mandando por WAHA (el canal no oficial), que es justo lo que se
--   quiere dejar atrás.
--
-- Con esta columna, migrar un cliente a la vía oficial es UNA línea:
--   update ed_clientes set transporte = 'cloud' where id = '<cliente>';
-- Y volver atrás es igual de simple (rollback instantáneo si algo falla).
--
-- APLICAR EN SUPABASE (SQL editor). Seguro: default 'waha' = comportamiento actual.
-- ============================================================================

alter table ed_clientes
  add column if not exists transporte text not null default 'waha';

alter table ed_clientes drop constraint if exists ed_clientes_transporte_check;
alter table ed_clientes add constraint ed_clientes_transporte_check
  check (transporte in ('waha', 'cloud'));

comment on column ed_clientes.transporte is
  'Canal de SALIDA de mensajes: waha (no oficial, pilotos) | cloud (WhatsApp Cloud API oficial).';
