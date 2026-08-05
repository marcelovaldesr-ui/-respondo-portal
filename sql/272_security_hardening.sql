-- ============================================================================
-- 272_security_hardening.sql · Cierre de RPC y relaciones multi-tenant
-- ----------------------------------------------------------------------------
-- Aditiva y NO destructiva. No se aplica automáticamente: ejecutar primero en
-- staging/Supabase SQL Editor y revisar la consulta de preflight del final.
-- ============================================================================

begin;

-- ed_clases fue creada después de la migración RLS general y la versión
-- original de la 260 olvidó activar esta segunda barrera.
alter table public.ed_clases enable row level security;

-- SECURITY DEFINER usa los permisos del dueño de la función. Fijar search_path
-- evita que un objeto creado en otro schema suplante tablas/funciones esperadas.
alter function public.ed_actualizar_resumen_contacto()
  set search_path = pg_catalog, public;
alter function public.ed_inscribir_en_clase(uuid, uuid, text, text, text, text, uuid)
  set search_path = pg_catalog, public;
alter function public.ed_liberar_cupo_clase()
  set search_path = pg_catalog, public;

-- Postgres concede EXECUTE a PUBLIC por defecto. La inscripción se consume
-- exclusivamente desde el backend con service_role; exponerla por /rest/v1/rpc
-- permitiría saltarse el rate limit y las validaciones de la API pública.
revoke all on function public.ed_inscribir_en_clase(uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.ed_inscribir_en_clase(uuid, uuid, text, text, text, text, uuid)
  to service_role;
revoke all on function public.ed_actualizar_resumen_contacto()
  from public, anon, authenticated;
revoke all on function public.ed_liberar_cupo_clase()
  from public, anon, authenticated;

-- Un teléfono no puede consumir dos cupos activos de la misma clase por doble
-- clic/reintento concurrente. Si ya existen duplicados, CREATE INDEX falla sin
-- modificar datos: se deben revisar manualmente, nunca borrar a ciegas.
create unique index if not exists uq_ed_citas_clase_chat_activa
  on public.ed_citas (clase_id, chat_id)
  where clase_id is not null
    and chat_id is not null
    and estado in ('agendada', 'confirmada', 'reagendada');

-- Las FK originales garantizan que cada UUID exista, pero no que pertenezca al
-- mismo cliente. Las claves compuestas impiden nuevas relaciones cruzadas. Los
-- FK quedan NOT VALID para no bloquear el hardening por datos históricos; sí se
-- aplican inmediatamente a INSERT/UPDATE nuevos.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_servicios'::regclass and conname = 'ed_servicios_id_cliente_uniq') then
    alter table public.ed_servicios add constraint ed_servicios_id_cliente_uniq unique (id, cliente_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_profesionales'::regclass and conname = 'ed_profesionales_id_cliente_uniq') then
    alter table public.ed_profesionales add constraint ed_profesionales_id_cliente_uniq unique (id, cliente_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_empleados'::regclass and conname = 'ed_empleados_id_cliente_uniq') then
    alter table public.ed_empleados add constraint ed_empleados_id_cliente_uniq unique (id, cliente_id);
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_citas'::regclass and conname = 'ed_citas_servicio_cliente_fk') then
    alter table public.ed_citas add constraint ed_citas_servicio_cliente_fk
      foreign key (servicio_id, cliente_id) references public.ed_servicios (id, cliente_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_citas'::regclass and conname = 'ed_citas_profesional_cliente_fk') then
    alter table public.ed_citas add constraint ed_citas_profesional_cliente_fk
      foreign key (profesional_id, cliente_id) references public.ed_profesionales (id, cliente_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_citas'::regclass and conname = 'ed_citas_empleado_cliente_fk') then
    alter table public.ed_citas add constraint ed_citas_empleado_cliente_fk
      foreign key (empleado_id, cliente_id) references public.ed_empleados (id, cliente_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_clases'::regclass and conname = 'ed_clases_servicio_cliente_fk') then
    alter table public.ed_clases add constraint ed_clases_servicio_cliente_fk
      foreign key (servicio_id, cliente_id) references public.ed_servicios (id, cliente_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_clases'::regclass and conname = 'ed_clases_profesional_cliente_fk') then
    alter table public.ed_clases add constraint ed_clases_profesional_cliente_fk
      foreign key (profesional_id, cliente_id) references public.ed_profesionales (id, cliente_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ed_bloqueos'::regclass and conname = 'ed_bloqueos_profesional_cliente_fk') then
    alter table public.ed_bloqueos add constraint ed_bloqueos_profesional_cliente_fk
      foreign key (profesional_id, cliente_id) references public.ed_profesionales (id, cliente_id) not valid;
  end if;
end
$$;

commit;

-- Preflight para validar después de revisar cualquier fila devuelta:
-- select 'citas_servicio' as problema, c.id from ed_citas c
-- join ed_servicios s on s.id = c.servicio_id where s.cliente_id <> c.cliente_id
-- union all
-- select 'citas_profesional', c.id from ed_citas c
-- join ed_profesionales p on p.id = c.profesional_id where p.cliente_id <> c.cliente_id
-- union all
-- select 'clases_servicio', c.id from ed_clases c
-- join ed_servicios s on s.id = c.servicio_id where s.cliente_id <> c.cliente_id
-- union all
-- select 'clases_profesional', c.id from ed_clases c
-- join ed_profesionales p on p.id = c.profesional_id where p.cliente_id <> c.cliente_id;
