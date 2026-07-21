-- ============================================================================
-- 211_etiquetas.sql  ·  Etiquetas de conversación (inbox)
-- ----------------------------------------------------------------------------
-- Etiquetas por conversación, estilo WhatsApp Business pero automáticas:
-- el asistente las sugiere y el humano (Cecilia) puede agregar/quitar.
-- Se guardan como arreglo de texto en ed_contactos (una fila por chat).
--
-- Aditivo e inocuo. Idempotente. El backfill etiqueta las conversaciones demo
-- a partir de ed_resultados (lo que ya logró cada empleado).
-- ============================================================================

alter table ed_contactos add column if not exists etiquetas text[] not null default '{}';

-- Índice para filtrar rápido por etiqueta
create index if not exists idx_ed_contactos_etiquetas on ed_contactos using gin (etiquetas);

-- ---------------------------------------------------------------------------
-- Backfill demo: derivar etiquetas de los resultados ya registrados.
-- El "not ... = any()" evita duplicados si se corre más de una vez.
-- ---------------------------------------------------------------------------

-- Cliente nuevo: hubo lead capturado
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'cliente_nuevo')
from ed_resultados r join ed_empleados e on e.id = r.empleado_id
where e.cliente_id = c.cliente_id and r.chat_id = c.chat_id
  and r.tipo = 'lead_capturado' and not ('cliente_nuevo' = any(c.etiquetas));

-- Cotización: se envió o se retomó una cotización
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'cotizacion')
from ed_resultados r join ed_empleados e on e.id = r.empleado_id
where e.cliente_id = c.cliente_id and r.chat_id = c.chat_id
  and r.tipo in ('cotizacion_enviada','cotizacion_retomada') and not ('cotizacion' = any(c.etiquetas));

-- Agendado: hubo un agendamiento
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'agendado')
from ed_resultados r join ed_empleados e on e.id = r.empleado_id
where e.cliente_id = c.cliente_id and r.chat_id = c.chat_id
  and r.tipo = 'agendamiento' and not ('agendado' = any(c.etiquetas));

-- Posible comprador: se recuperó/concretó una venta
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'posible_comprador')
from ed_resultados r join ed_empleados e on e.id = r.empleado_id
where e.cliente_id = c.cliente_id and r.chat_id = c.chat_id
  and r.tipo in ('venta_recuperada','cliente_reactivado') and not ('posible_comprador' = any(c.etiquetas));

-- Reclamo: cliente molesto detectado
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'reclamo')
from ed_resultados r join ed_empleados e on e.id = r.empleado_id
where e.cliente_id = c.cliente_id and r.chat_id = c.chat_id
  and r.tipo = 'cliente_molesto' and not ('reclamo' = any(c.etiquetas));

-- Necesita atención: hay una escalación sin atender
update ed_contactos c set etiquetas = array_append(c.etiquetas, 'necesita_atencion')
from ed_escalaciones es join ed_empleados e on e.id = es.empleado_id
where e.cliente_id = c.cliente_id and es.chat_id = c.chat_id
  and es.atendida_en is null and not ('necesita_atencion' = any(c.etiquetas));

-- Verificación: cuántas conversaciones quedaron con al menos una etiqueta
select count(*) filter (where cardinality(etiquetas) > 0) as con_etiqueta,
       count(*) as total
from ed_contactos;
