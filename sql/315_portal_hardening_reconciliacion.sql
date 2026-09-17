-- ============================================================================
-- 315 · PORTAL HARDENING — RECONCILIACIÓN FORWARD
--
-- Inventario de producción verificado mediante Q01–Q11:
--   • 272: RLS, search_path, ACL, uniques y seis FK multi-tenant existen.
--   • 273: tablas, columnas, RPC, trigger tenant-safe e índices existen.
--   • 276: idx_ed_webhook_purga existe con la definición esperada.
--   • 293: las RPC canónicas conservan búsqueda sin acentos, escape de LIKE,
--          detección multi-empleado y estado pausado.
--   • 307: ed_citas_inscripcion_unica existe y no hay duplicados históricos.
--
-- Único estado pendiente: los seis FK multi-tenant de 272 están NOT VALID.
-- Q10 confirmó cero inconsistencias en las seis relaciones y en
-- ed_servicio_profesional; Q11 confirmó cero inscripciones duplicadas.
--
-- Esta migración no crea ni reemplaza objetos, no redefine RPC, no toca
-- 312/313/314 ni objetos hq_* y no elimina el índice antiguo redundante de 272.
-- ============================================================================

begin;

-- Preflight automático. Protege contra drift entre el inventario y el momento
-- de aplicación. Cualquier diferencia aborta la transacción antes de validar.
do $preflight$
declare
  v_fk record;
  v_def_lista text;
  v_def_resumen text;
begin
  -- 272: ed_clases debe conservar RLS.
  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ed_clases'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  ) then
    raise exception '315 preflight: public.ed_clases no existe o no tiene RLS habilitado';
  end if;

  -- 272/273: las funciones endurecidas deben existir y mantener search_path.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.ed_actualizar_resumen_contacto()')
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.ed_inscribir_en_clase(uuid,uuid,text,text,text,text,uuid)')
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.ed_liberar_cupo_clase()')
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.ed_consumir_limite(text,integer,integer)')
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.ed_reclamar_webhook(text,text,jsonb)')
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception '315 preflight: falta una función endurecida o cambió su search_path';
  end if;

  -- Ninguna función relevante puede recuperar EXECUTE para PUBLIC, anon o
  -- authenticated. service_role debe conservar acceso a las RPC del backend.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
    ) permisos
    left join pg_catalog.pg_roles beneficiario on beneficiario.oid = permisos.grantee
    where n.nspname = 'public'
      and p.proname in (
        'ed_actualizar_resumen_contacto', 'ed_inscribir_en_clase',
        'ed_liberar_cupo_clase', 'ed_consumir_limite', 'ed_reclamar_webhook',
        'ed_validar_servicio_profesional_tenant', 'ed_sin_acentos',
        'ed_patron_contiene', 'ed_listar_conversaciones_portal',
        'ed_resumen_conversaciones_portal'
      )
      and permisos.privilege_type = 'EXECUTE'
      and (permisos.grantee = 0 or beneficiario.rolname in ('anon', 'authenticated'))
  ) then
    raise exception '315 preflight: una función relevante expone EXECUTE a PUBLIC, anon o authenticated';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.ed_inscribir_en_clase(uuid,uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.ed_consumir_limite(text,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.ed_reclamar_webhook(text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception '315 preflight: service_role perdió EXECUTE sobre una RPC requerida';
  end if;

  -- 273: superficie estructural y trigger tenant-safe.
  if to_regclass('public.ed_rate_limits') is null
     or to_regclass('public.ed_webhook_eventos') is null
     or to_regclass('public.ed_servicio_profesional') is null
     or to_regclass('public.ed_auditoria_portal') is null then
    raise exception '315 preflight: falta una tabla base de 273';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ed_servicio_profesional'
      and column_name = 'cliente_id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ed_webhook_eventos'
      and column_name = 'payload_purgado_en' and udt_name = 'timestamptz'
  ) then
    raise exception '315 preflight: falta una columna requerida de 273';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ed_servicio_profesional'::regclass
      and t.tgname = 'trg_ed_servicio_profesional_tenant'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = to_regprocedure('public.ed_validar_servicio_profesional_tenant()')
  ) then
    raise exception '315 preflight: falta o está deshabilitado el trigger tenant-safe de 273';
  end if;

  -- 276: el índice de purga ya debe existir; 315 no lo duplica.
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.idx_ed_webhook_purga')
      and i.indrelid = 'public.ed_webhook_eventos'::regclass
      and pg_catalog.pg_get_indexdef(i.indexrelid) ilike '%(procesado_en)%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%estado%procesado%'
  ) then
    raise exception '315 preflight: falta idx_ed_webhook_purga de 276 o cambió su definición';
  end if;

  -- 293: conservar la versión posterior de bandeja y sus cuatro garantías.
  if to_regprocedure('public.ed_sin_acentos(text)') is null
     or to_regprocedure('public.ed_patron_contiene(text)') is null
     or to_regprocedure('public.ed_listar_conversaciones_portal(uuid,text,text,text,integer,integer)') is null
     or to_regprocedure('public.ed_resumen_conversaciones_portal(uuid)') is null then
    raise exception '315 preflight: falta la superficie canónica de bandeja de 293';
  end if;

  select pg_catalog.pg_get_functiondef(
    to_regprocedure('public.ed_listar_conversaciones_portal(uuid,text,text,text,integer,integer)')
  ) into v_def_lista;
  select pg_catalog.pg_get_functiondef(
    to_regprocedure('public.ed_resumen_conversaciones_portal(uuid)')
  ) into v_def_resumen;

  if position('ed_sin_acentos' in v_def_lista) = 0
     or position('ed_patron_contiene' in v_def_lista) = 0
     or position('esc.empleado_id in (select id from emps)' in lower(v_def_lista)) = 0
     or position('p_estado = ''pausado''' in lower(v_def_lista)) = 0
     or position('modo = ''pausado''' in lower(v_def_resumen)) = 0 then
    raise exception '315 preflight: las RPC de 293 perdieron una garantía funcional';
  end if;

  -- 307: debe existir el índice canónico. El índice antiguo equivalente de 272
  -- puede seguir presente; esta migración no elimina objetos en producción.
  if not exists (
    select 1
    from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.ed_citas_inscripcion_unica')
      and i.indrelid = 'public.ed_citas'::regclass
      and i.indisunique
      and pg_catalog.pg_get_indexdef(i.indexrelid) ilike '%(clase_id, chat_id)%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%agendada%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%confirmada%'
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) ilike '%reagendada%'
  ) then
    raise exception '315 preflight: falta ed_citas_inscripcion_unica de 307 o cambió su definición';
  end if;

  -- Los seis FK deben existir con la relación compuesta esperada. Pueden estar
  -- ya validados: VALIDATE CONSTRAINT es idempotente para ese estado.
  for v_fk in
    select * from (values
      ('ed_citas', 'ed_citas_servicio_cliente_fk', 'ed_servicios'),
      ('ed_citas', 'ed_citas_profesional_cliente_fk', 'ed_profesionales'),
      ('ed_citas', 'ed_citas_empleado_cliente_fk', 'ed_empleados'),
      ('ed_clases', 'ed_clases_servicio_cliente_fk', 'ed_servicios'),
      ('ed_clases', 'ed_clases_profesional_cliente_fk', 'ed_profesionales'),
      ('ed_bloqueos', 'ed_bloqueos_profesional_cliente_fk', 'ed_profesionales')
    ) as x(tabla, nombre, tabla_referenciada)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = format('public.%I', v_fk.tabla)::regclass
        and c.conname = v_fk.nombre
        and c.contype = 'f'
        and c.confrelid = format('public.%I', v_fk.tabla_referenciada)::regclass
        and pg_catalog.pg_get_constraintdef(c.oid, true) ilike '%cliente_id%'
    ) then
      raise exception '315 preflight: falta o cambió el FK %', v_fk.nombre;
    end if;
  end loop;

  -- Q10: cualquier fila nueva inconsistente aborta antes de validar.
  if exists (
    select 1 from public.ed_citas c
    join public.ed_servicios s on s.id = c.servicio_id
    where s.cliente_id is distinct from c.cliente_id
  ) or exists (
    select 1 from public.ed_citas c
    join public.ed_profesionales p on p.id = c.profesional_id
    where p.cliente_id is distinct from c.cliente_id
  ) or exists (
    select 1 from public.ed_citas c
    join public.ed_empleados e on e.id = c.empleado_id
    where e.cliente_id is distinct from c.cliente_id
  ) or exists (
    select 1 from public.ed_clases c
    join public.ed_servicios s on s.id = c.servicio_id
    where s.cliente_id is distinct from c.cliente_id
  ) or exists (
    select 1 from public.ed_clases c
    join public.ed_profesionales p on p.id = c.profesional_id
    where p.cliente_id is distinct from c.cliente_id
  ) or exists (
    select 1 from public.ed_bloqueos b
    join public.ed_profesionales p on p.id = b.profesional_id
    where p.cliente_id is distinct from b.cliente_id
  ) or exists (
    select 1 from public.ed_servicio_profesional sp
    join public.ed_servicios s on s.id = sp.servicio_id
    join public.ed_profesionales p on p.id = sp.profesional_id
    where s.cliente_id is distinct from p.cliente_id
       or sp.cliente_id is distinct from s.cliente_id
  ) then
    raise exception '315 preflight: aparecieron inconsistencias históricas multi-tenant después de Q10';
  end if;

  -- Q11: 307 debe poder seguir garantizando una inscripción activa por chat.
  if exists (
    select 1
    from public.ed_citas
    where clase_id is not null
      and chat_id is not null
      and estado in ('agendada', 'confirmada', 'reagendada')
    group by clase_id, chat_id
    having count(*) > 1
  ) then
    raise exception '315 preflight: aparecieron inscripciones activas duplicadas después de Q11';
  end if;
end
$preflight$;

-- Único cambio requerido por la reconciliación: validar los FK que 272 dejó
-- deliberadamente NOT VALID hasta comprobar los datos históricos.
alter table public.ed_citas
  validate constraint ed_citas_servicio_cliente_fk;
alter table public.ed_citas
  validate constraint ed_citas_profesional_cliente_fk;
alter table public.ed_citas
  validate constraint ed_citas_empleado_cliente_fk;
alter table public.ed_clases
  validate constraint ed_clases_servicio_cliente_fk;
alter table public.ed_clases
  validate constraint ed_clases_profesional_cliente_fk;
alter table public.ed_bloqueos
  validate constraint ed_bloqueos_profesional_cliente_fk;

commit;

-- Verificación read-only: las seis filas deben devolver validada = true.
select
  con.conrelid::regclass as tabla,
  con.conname as constraint,
  con.convalidated as validada,
  pg_catalog.pg_get_constraintdef(con.oid, true) as definicion
from pg_catalog.pg_constraint con
where con.conname in (
  'ed_citas_servicio_cliente_fk',
  'ed_citas_profesional_cliente_fk',
  'ed_citas_empleado_cliente_fk',
  'ed_clases_servicio_cliente_fk',
  'ed_clases_profesional_cliente_fk',
  'ed_bloqueos_profesional_cliente_fk'
)
order by con.conrelid::regclass::text, con.conname;
