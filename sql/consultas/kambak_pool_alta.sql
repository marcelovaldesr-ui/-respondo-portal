-- ============================================================================
-- kambak_pool_alta.sql · Alta manual de números WAHA para el pool de Kambak
-- NO es una migración. Lo ejecuta UN HUMANO en el SQL editor de Supabase,
-- DESPUÉS de aplicar sql/325_waha_pool.sql.
-- ============================================================================

-- 1) Opcional: Activar canal WAHA para marketing en Kambak
--    (por defecto sigue en 'meta'). Descomentar al iniciar el piloto.
-- update ed_clientes
--    set canal_marketing = 'waha'
--  where slug = 'kambak';

-- 2) Dar de alta los números del pool
-- Reemplazar <<SESION_1>>, <<ETIQUETA_1>>, etc., con los nombres de sesión en WAHA.
-- Estado inicial recomendado: 'calentando' (o 'activo' si ya llevan 5-7 días con tráfico manual).
insert into ed_waha_numeros (
  cliente_id,
  sesion,
  etiqueta,
  estado,
  rol,
  calentamiento_desde,
  tope_diario
)
values
  (
    (select id from ed_clientes where slug = 'kambak'),
    'kambak_chip_1',
    'Chip 1 - Entel Piloto',
    'calentando',
    'envio',
    current_date,
    150
  ),
  (
    (select id from ed_clientes where slug = 'kambak'),
    'kambak_chip_2',
    'Chip 2 - Movistar Piloto',
    'calentando',
    'envio',
    current_date,
    150
  )
on conflict (sesion) do update set
  etiqueta = excluded.etiqueta,
  tope_diario = excluded.tope_diario;

-- 3) Verificación
select id, nombre, slug, canal_marketing
  from ed_clientes
 where slug = 'kambak';

select id, sesion, etiqueta, estado, rol, tope_diario, calentamiento_desde, creado_en
  from ed_waha_numeros
 where cliente_id = (select id from ed_clientes where slug = 'kambak');
