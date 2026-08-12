-- ============================================================================
-- 276_purga_webhooks.sql · Acotar el crecimiento de ed_webhook_eventos
-- ----------------------------------------------------------------------------
-- HALLAZGO (auditoría 11-ago-2026, preparación para escalar):
-- la purga existente (lib/webhookInbox.ts) vacía el `payload` a los 7 días,
-- pero NUNCA borra la fila. La tabla crece para siempre.
--
-- Medido hoy con UN solo cliente en producción: 4.110 filas en 30 días, casi
-- una por mensaje. Proyectado:
--     1 cliente  →   ~50.000 filas/año
--    25 clientes → ~1.200.000 filas/año
--    50 clientes → ~2.500.000 filas/año
--
-- No es un problema de corrección (el índice único mantiene la idempotencia en
-- O(log n)), pero sí de costo y mantenimiento: Supabase cobra por tamaño de
-- base, y una tabla que solo crece termina siendo la que nadie se atreve a
-- tocar. Barato de arreglar ahora, molesto de arreglar con millones de filas.
--
-- Retención elegida: 30 días. Muy por encima de lo necesario — Meta y WAHA
-- reintentan un webhook durante horas, no semanas, así que la idempotencia
-- real solo necesita ~24 h. El payload ya se vacía a los 7 días.
--
-- APLICAR EN SUPABASE (SQL editor). Seguro: solo agrega un índice.
-- ============================================================================

-- Índice que hace barata la purga por antigüedad. El índice existente
-- (idx_ed_webhook_reintentos) es PARCIAL y solo cubre estado='error', así que
-- no sirve para recorrer los ya procesados.
create index if not exists idx_ed_webhook_purga
  on public.ed_webhook_eventos (procesado_en)
  where estado = 'procesado';

comment on index public.idx_ed_webhook_purga is
  'Soporta el borrado por antigüedad de eventos ya procesados (lib/webhookInbox.ts).';

-- Verificación: cuántas filas hay y cuántas serían purgables hoy.
select
  count(*)                                                        as filas_totales,
  count(*) filter (where estado = 'procesado'
                     and procesado_en < now() - interval '30 days') as purgables_hoy,
  pg_size_pretty(pg_total_relation_size('public.ed_webhook_eventos')) as tamano
from public.ed_webhook_eventos;
