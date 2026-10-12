-- ============================================================================
-- kambak_pool_operacion.sql · Consultas y operaciones de mantenimiento del Pool
-- NO es una migración. Lo ejecuta UN HUMANO en el SQL editor de Supabase cuando
-- sea necesario monitorear o intervenir números del pool.
-- ============================================================================

-- 1) Monitorear estado general de números del pool
select
  id,
  sesion,
  etiqueta,
  estado,
  rol,
  tope_diario,
  enviados_hoy,
  dia,
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

-- 2) Ver estado de conectividad global del pool
select * from ed_waha_pool_estado where id = 1;

-- 3) Reactivar un número bloqueado tras resolver el problema en WAHA
-- (Reemplazar 'kambak_chip_1' con la sesión respectiva)
update ed_waha_numeros
set
  estado = 'activo',
  fallos_seguidos = 0,
  ciclos_pausa = 0,
  pausado_hasta = null,
  ultimo_error = null,
  proximo_envio_en = null
where sesion = 'kambak_chip_1'
  and estado = 'bloqueado';

-- 4) Pausar manualmente un número por mantenimiento / descanso
update ed_waha_numeros
set
  estado = 'pausado',
  pausado_hasta = now() + interval '2 hours',
  ultimo_error = 'Pausa manual por mantenimiento'
where sesion = 'kambak_chip_1'
  and estado in ('activo', 'calentando');

-- 5) Reanudar inmediatamente un número pausado
update ed_waha_numeros
set
  estado = 'activo',
  pausado_hasta = null,
  proximo_envio_en = null,
  ultimo_error = null
where sesion = 'kambak_chip_1'
  and estado = 'pausado';

-- 6) Retirar definitivamente un chip del pool
update ed_waha_numeros
set
  estado = 'retirado',
  ultimo_error = 'Retirado definitivamente del pool'
where sesion = 'kambak_chip_1';

-- 7) Ajustar tope diario manualmente para un número maduro
update ed_waha_numeros
set tope_diario = 200
where sesion = 'kambak_chip_1';

-- 8) Dar de alta un nuevo chip en fase de calentamiento
insert into ed_waha_numeros (
  cliente_id,
  sesion,
  etiqueta,
  estado,
  rol,
  calentamiento_desde,
  tope_diario,
  enviados_hoy,
  fallos_seguidos
) values (
  (select id from ed_clientes where slug = 'kambak'),
  'kambak_chip_nuevo',
  'Chip nuevo +569XXXXXXXX',
  'calentando',
  'envio',
  current_date,
  20,
  0,
  0
);

