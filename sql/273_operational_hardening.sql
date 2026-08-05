-- ============================================================================
-- 273_operational_hardening.sql · rate limit, inbox de webhooks e integridad
-- Aditiva. Probar primero en staging; no elimina datos.
-- ============================================================================

begin;

-- Rate limit global para Vercel/serverless.
create table if not exists public.ed_rate_limits (
  clave text primary key check (length(clave) between 16 and 128),
  ventana_inicio timestamptz not null default now(),
  cantidad integer not null default 0 check (cantidad >= 0),
  actualizado_en timestamptz not null default now()
);
alter table public.ed_rate_limits enable row level security;

create or replace function public.ed_consumir_limite(
  p_clave text,
  p_max integer,
  p_ventana_seg integer
)
returns table(permitido boolean, restantes integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cantidad integer;
begin
  if length(p_clave) not between 16 and 128
     or p_max not between 1 and 10000
     or p_ventana_seg not between 1 and 86400 then
    raise exception 'parámetros de límite inválidos';
  end if;

  insert into public.ed_rate_limits as r (clave, ventana_inicio, cantidad, actualizado_en)
  values (p_clave, now(), 1, now())
  on conflict (clave) do update set
    ventana_inicio = case
      when r.ventana_inicio <= now() - make_interval(secs => p_ventana_seg) then now()
      else r.ventana_inicio
    end,
    cantidad = case
      when r.ventana_inicio <= now() - make_interval(secs => p_ventana_seg) then 1
      else least(r.cantidad + 1, p_max + 1)
    end,
    actualizado_en = now()
  returning cantidad into v_cantidad;

  return query select v_cantidad <= p_max, greatest(0, p_max - v_cantidad);
end;
$$;
revoke all on function public.ed_consumir_limite(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ed_consumir_limite(text, integer, integer) to service_role;

-- Inbox durable de webhooks. El payload se conserva solo para reintentos; el
-- cron debe vaciar el payload después de 7 días sin borrar la clave idempotente.
create table if not exists public.ed_webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null check (proveedor in ('meta_whatsapp', 'waha', 'instagram')),
  evento_id text not null,
  payload jsonb not null,
  estado text not null default 'procesando'
    check (estado in ('procesando', 'procesado', 'error')),
  intentos integer not null default 1 check (intentos between 1 and 1000),
  ultimo_error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  procesado_en timestamptz,
  payload_purgado_en timestamptz,
  unique (proveedor, evento_id)
);
alter table public.ed_webhook_eventos
  add column if not exists payload_purgado_en timestamptz;
create index if not exists idx_ed_webhook_reintentos
  on public.ed_webhook_eventos (estado, actualizado_en)
  where estado = 'error' and intentos < 8;
alter table public.ed_webhook_eventos enable row level security;

create or replace function public.ed_reclamar_webhook(
  p_proveedor text,
  p_evento_id text,
  p_payload jsonb
)
returns table(evento_uuid uuid, procesar boolean, estado_actual text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_estado text;
begin
  if p_proveedor not in ('meta_whatsapp', 'waha', 'instagram')
     or length(p_evento_id) not between 16 and 128
     or pg_column_size(p_payload) > 1048576 then
    raise exception 'evento webhook inválido';
  end if;

  insert into public.ed_webhook_eventos (proveedor, evento_id, payload)
  values (p_proveedor, p_evento_id, p_payload)
  on conflict (proveedor, evento_id) do nothing
  returning id, estado into v_id, v_estado;

  if v_id is not null then
    return query select v_id, true, 'procesando'::text;
    return;
  end if;

  update public.ed_webhook_eventos e
     set estado = 'procesando', intentos = e.intentos + 1,
         ultimo_error = null, actualizado_en = now()
   where e.proveedor = p_proveedor and e.evento_id = p_evento_id
     and e.intentos < 8
     and (e.estado = 'error' or (e.estado = 'procesando' and e.actualizado_en < now() - interval '5 minutes'))
  returning e.id, e.estado into v_id, v_estado;

  if v_id is not null then
    return query select v_id, true, v_estado;
  else
    select e.id, e.estado into v_id, v_estado
      from public.ed_webhook_eventos e
     where e.proveedor = p_proveedor and e.evento_id = p_evento_id;
    return query select v_id, false, coalesce(v_estado, 'error');
  end if;
end;
$$;
revoke all on function public.ed_reclamar_webhook(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ed_reclamar_webhook(text, text, jsonb) to service_role;

-- La unión servicio/profesional no tenía tenant propio. El trigger impide
-- nuevas relaciones cruzadas y completa cliente_id sin confiar en el caller.
alter table public.ed_servicio_profesional add column if not exists cliente_id uuid;
update public.ed_servicio_profesional sp
   set cliente_id = s.cliente_id
  from public.ed_servicios s, public.ed_profesionales p
 where sp.servicio_id = s.id and sp.profesional_id = p.id
   and s.cliente_id = p.cliente_id and sp.cliente_id is null;

create or replace function public.ed_validar_servicio_profesional_tenant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_servicio uuid;
  v_profesional uuid;
begin
  select cliente_id into v_servicio from public.ed_servicios where id = new.servicio_id;
  select cliente_id into v_profesional from public.ed_profesionales where id = new.profesional_id;
  if v_servicio is null or v_profesional is null or v_servicio <> v_profesional then
    raise exception 'servicio y profesional deben pertenecer al mismo cliente';
  end if;
  new.cliente_id := v_servicio;
  return new;
end;
$$;
drop trigger if exists trg_ed_servicio_profesional_tenant on public.ed_servicio_profesional;
create trigger trg_ed_servicio_profesional_tenant
before insert or update on public.ed_servicio_profesional
for each row execute function public.ed_validar_servicio_profesional_tenant();
revoke all on function public.ed_validar_servicio_profesional_tenant() from public, anon, authenticated;

-- Auditoría mínima de acciones sensibles del portal. No guarda correos en
-- claro, cuerpos, tokens ni mensajes.
create table if not exists public.ed_auditoria_portal (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.ed_clientes(id) on delete cascade,
  actor_hash text,
  actor_rol text check (actor_rol in ('dueno', 'staff', 'sistema')),
  accion text not null check (length(accion) between 3 and 100),
  recurso_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index if not exists idx_ed_auditoria_cliente_fecha
  on public.ed_auditoria_portal (cliente_id, creado_en desc);
alter table public.ed_auditoria_portal enable row level security;

-- Bandeja paginada: filtros, estado y total se resuelven en Postgres sin traer
-- todos los contactos al runtime serverless.
create or replace function public.ed_listar_conversaciones_portal(
  p_cliente_id uuid,
  p_q text default null,
  p_estado text default null,
  p_etiqueta text default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table(
  empleado_id uuid,
  empleado_nombre text,
  empleado_rol text,
  chat_id text,
  contacto text,
  ultimo_mensaje text,
  ultimo_en timestamptz,
  ultimo_rol text,
  mensajes bigint,
  modo text,
  esperando_humano boolean,
  etiquetas text[],
  total bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with base as (
    select
      emp.id as empleado_id,
      emp.nombre_publico as empleado_nombre,
      emp.rol as empleado_rol,
      c.chat_id,
      coalesce(nullif(c.nombre, ''), '+' || c.chat_id) as contacto,
      coalesce(c.ultimo_mensaje_texto, '') as ultimo_mensaje,
      c.ultimo_mensaje_en as ultimo_en,
      coalesce(c.ultimo_mensaje_rol, 'cliente') as ultimo_rol,
      coalesce(c.total_mensajes, 0)::bigint as mensajes,
      coalesce(ce.modo, 'bot') as modo,
      exists (
        select 1 from public.ed_escalaciones esc
        where esc.empleado_id = emp.id and esc.chat_id = c.chat_id
          and esc.atendida_en is null
      ) as esperando_humano,
      coalesce(c.etiquetas, '{}'::text[]) as etiquetas
    from public.ed_contactos c
    join lateral (
      select e.id, e.nombre_publico, e.rol
      from public.ed_empleados e
      where e.cliente_id = p_cliente_id and e.activo = true
      order by
        case when e.id = c.ultimo_empleado_id then 0 else 1 end,
        case when e.rol = 'tino' then 0 else 1 end,
        e.id
      limit 1
    ) emp on true
    left join public.ed_chat_estado ce
      on ce.empleado_id = emp.id and ce.chat_id = c.chat_id
    where c.cliente_id = p_cliente_id
      and c.ultimo_mensaje_en is not null
      and (p_etiqueta is null or p_etiqueta = any(coalesce(c.etiquetas, '{}'::text[])))
      and (
        coalesce(nullif(trim(p_q), ''), '') = ''
        or lower(coalesce(c.nombre, '')) like '%' || lower(trim(p_q)) || '%'
        or (
          regexp_replace(p_q, '[^0-9]', '', 'g') <> ''
          and c.chat_id like '%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%'
        )
        or lower(coalesce(c.ultimo_mensaje_texto, '')) like '%' || lower(trim(p_q)) || '%'
      )
  ), filtrada as (
    select * from base b
    where p_estado is null
       or (p_estado = 'espera' and b.esperando_humano)
       or (p_estado = 'humano' and b.modo = 'humano' and not b.esperando_humano)
       or (p_estado = 'bot' and b.modo = 'bot' and not b.esperando_humano)
  )
  select f.*, count(*) over() as total
  from filtrada f
  order by f.ultimo_en desc, f.chat_id
  limit least(greatest(p_limite, 1), 100)
  offset greatest(p_offset, 0);
$$;
revoke all on function public.ed_listar_conversaciones_portal(uuid, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ed_listar_conversaciones_portal(uuid, text, text, text, integer, integer)
  to service_role;

create or replace function public.ed_resumen_conversaciones_portal(p_cliente_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with base as (
    select c.chat_id, coalesce(ce.modo, 'bot') as modo,
      exists (
        select 1 from public.ed_escalaciones esc
        where esc.empleado_id = emp.id and esc.chat_id = c.chat_id
          and esc.atendida_en is null
      ) as espera,
      coalesce(c.etiquetas, '{}'::text[]) as etiquetas
    from public.ed_contactos c
    join lateral (
      select e.id
      from public.ed_empleados e
      where e.cliente_id = p_cliente_id and e.activo = true
      order by case when e.id = c.ultimo_empleado_id then 0 else 1 end,
               case when e.rol = 'tino' then 0 else 1 end, e.id
      limit 1
    ) emp on true
    left join public.ed_chat_estado ce on ce.empleado_id = emp.id and ce.chat_id = c.chat_id
    where c.cliente_id = p_cliente_id and c.ultimo_mensaje_en is not null
  ), tags as (
    select tag, count(*)::integer as n from base, unnest(etiquetas) tag group by tag
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'espera', (select count(*) from base where espera),
    'humano', (select count(*) from base where modo = 'humano' and not espera),
    'bot', (select count(*) from base where modo = 'bot' and not espera),
    'etiquetas', coalesce((select jsonb_object_agg(tag, n) from tags), '{}'::jsonb)
  );
$$;
revoke all on function public.ed_resumen_conversaciones_portal(uuid)
  from public, anon, authenticated;
grant execute on function public.ed_resumen_conversaciones_portal(uuid) to service_role;

commit;

-- Preflight: cualquier fila indica corrupción histórica a corregir manualmente.
-- select sp.servicio_id, sp.profesional_id
-- from ed_servicio_profesional sp
-- join ed_servicios s on s.id = sp.servicio_id
-- join ed_profesionales p on p.id = sp.profesional_id
-- where s.cliente_id <> p.cliente_id or sp.cliente_id is null;
