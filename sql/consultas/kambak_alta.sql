-- ============================================================================
-- kambak_alta.sql · Alta del tenant "Kambak" (solo mensajería)
-- NO es una migración. Lo ejecuta UN HUMANO en el SQL editor de Supabase,
-- DESPUÉS de aplicar sql/322_solo_mensajeria.sql.
-- Reemplazar los 3 valores marcados con <<...>> antes de correr. No pegar claves.
-- ============================================================================

-- 1) Crear el tenant (idempotente: repetir con el mismo payload no duplica)
select public.ed_aprovisionar_cliente(jsonb_build_object(
  'nombre',               'Kambak',
  'rubro',                'fidelizacion',
  'email_dueno',          '<<EMAIL_DUENO>>',
  'plan',                 'a_medida',
  'cupo_conversaciones',  0,
  'moneda',               'CLP',
  'slug',                 'kambak',
  'telefono_escalacion',  '<<TELEFONO_ESCALACION_569XXXXXXXX>>',
  'email_staff',          jsonb_build_array('<<EMAIL_STAFF_1>>'),
  'transporte',           'cloud'
));

-- 2) Activar "Solo mensajería" (el guardia SQL impide activar IA a esta cuenta)
update ed_clientes set solo_mensajeria = true where slug = 'kambak';

-- 3) Verificar
select id, nombre, slug, plan, solo_mensajeria from ed_clientes where slug = 'kambak';
select email, rol from portal_usuarios
 where cliente_id = (select id from ed_clientes where slug = 'kambak');

-- Nota: si necesitas más personas en la bandeja, insértalas en portal_usuarios
-- (rol 'staff' o 'dueno') con la misma forma que las filas de arriba.
