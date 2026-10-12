-- ============================================================================
-- kambak_pool_estado.sql · Visibilidad Operativa y Calidad del Pool (P9 / H14)
-- NO es una migración. Lo ejecuta un operador en Supabase SQL Editor para ver
-- la salud, la cola, la entrega, las bajas y la calidad de los chips.
-- ============================================================================

-- 1) Estado general por número del pool (incluye días de calentamiento y pausas)
select
  sesion,
  etiqueta,
  estado,
  rol,
  enviados_hoy,
  tope_diario,
  case
    when calentamiento_desde is not null then
      greatest(0, (current_date - calentamiento_desde::date))
    else null
  end as dias_calentamiento,
  fallos_seguidos,
  ciclos_pausa,
  pausado_hasta,
  ultimo_ok_en,
  ultimo_envio_en,
  proximo_envio_en,
  ultimo_error
from ed_waha_numeros
where cliente_id = (select id from ed_clientes where slug = 'kambak')
order by creado_en asc;

-- 2) Estado de la cola de envíos WAHA (últimas 24 horas)
select
  estado,
  motivo,
  count(*) as cantidad,
  min(creado_en) as mas_antiguo,
  max(creado_en) as mas_reciente
from ed_envios_api
where canal = 'waha'
  and creado_en >= now() - interval '24 hours'
group by estado, motivo
order by cantidad desc;

-- 3) Tasa de entrega y lectura de mensajes del pool (últimas 24 horas)
with envios_24h as (
  select
    count(*) as total,
    count(*) filter (where estado = 'sent') as enviados,
    count(*) filter (where estado = 'fallido') as fallidos
  from ed_envios_api
  where canal = 'waha'
    and creado_en >= now() - interval '24 hours'
)
select
  total,
  enviados,
  fallidos,
  round((enviados::numeric / nullif(total, 0)) * 100, 2) as pct_exito,
  round((fallidos::numeric / nullif(total, 0)) * 100, 2) as pct_fallo
from envios_24h;

-- 4) Bajas registradas en las últimas 24 horas y últimos 7 días
select
  count(*) filter (where actualizado_en >= now() - interval '24 hours') as bajas_ultimas_24h,
  count(*) filter (where actualizado_en >= now() - interval '7 days') as bajas_ultimos_7d
from ed_contactos
where no_contactar = true
  and cliente_id = (select id from ed_clientes where slug = 'kambak');

-- 5) Estado de conectividad global del pool y último resumen diario
select
  id,
  pool_inalcanzable_desde,
  ultimo_chequeo_en,
  alerta_inalcanzable_en,
  alerta_sin_capacidad_en,
  ultimo_resumen_en,
  actualizado_en
from ed_waha_pool_estado
where id = 1;
