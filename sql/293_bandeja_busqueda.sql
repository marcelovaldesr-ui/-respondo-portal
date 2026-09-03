-- ============================================================================
-- 293 · BANDEJA: búsqueda sin acentos, comodines escapados, "te espera" por chat
-- ============================================================================
--
-- Auditoría de Conversaciones (3-sep-2026), lote 3. Reemplaza las dos funciones
-- de la migración 273 con tres arreglos:
--
-- 1. BÚSQUEDA SIN ACENTOS. «Sebastián» no aparecía buscando «sebastian», y
--    al revés. La mitad de los nombres de la base vienen del perfil de WhatsApp
--    (con acento) y la persona escribe rápido (sin). Se normaliza con una
--    función propia inmutable (`ed_sin_acentos`) para no depender de la
--    extensión `unaccent`, que en Supabase vive en otro esquema y complica el
--    search_path de las funciones security definer.
--
-- 2. COMODINES DE `LIKE` ESCAPADOS. Buscar «100%» o «_» hacía que el patrón
--    dejara de significar lo que la persona escribió (`%` = cualquier cosa).
--
-- 3. «TE ESPERA» POR CHAT, NO POR EMPLEADO. La derivación la abre el empleado
--    que atendía (Tino); si `ultimo_empleado_id` pasa a Beto tras un
--    seguimiento, la fila dejaba de mostrarse como "te espera" aunque la
--    escalación siguiera abierta. Ahora se mira cualquier empleado del cliente.
--    Mismo criterio que lib/escalaciones.ts (cierra por chat).
-- ============================================================================

begin;

create or replace function public.ed_sin_acentos(t text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select translate(
    lower(coalesce(t, '')),
    'áéíóúàèìòùäëïöüâêîôûãõñç',
    'aeiouaeiouaeiouaeiouaonc'
  );
$$;

comment on function public.ed_sin_acentos(text) is
  'Minúsculas y sin acentos, para comparar nombres como los escribe una persona. Inmutable: sirve para índices.';

/** Patrón LIKE seguro: escapa \, % y _ y agrega los comodines de "contiene". */
create or replace function public.ed_patron_contiene(t text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select '%' || replace(replace(replace(public.ed_sin_acentos(trim(coalesce(t, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

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
  with emps as (
    select e.id from public.ed_empleados e where e.cliente_id = p_cliente_id
  ), base as (
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
        where esc.chat_id = c.chat_id
          and esc.empleado_id in (select id from emps)
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
        or public.ed_sin_acentos(coalesce(c.nombre, '')) like public.ed_patron_contiene(p_q) escape '\'
        or (
          regexp_replace(p_q, '[^0-9]', '', 'g') <> ''
          and c.chat_id like '%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%'
        )
        or public.ed_sin_acentos(coalesce(c.ultimo_mensaje_texto, '')) like public.ed_patron_contiene(p_q) escape '\'
      )
  ), filtrada as (
    select * from base b
    where p_estado is null
       or (p_estado = 'espera' and b.esperando_humano)
       or (p_estado = 'humano' and b.modo = 'humano' and not b.esperando_humano)
       or (p_estado = 'bot' and b.modo = 'bot' and not b.esperando_humano)
       or (p_estado = 'pausado' and b.modo = 'pausado')
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
  with emps as (
    select e.id from public.ed_empleados e where e.cliente_id = p_cliente_id
  ), base as (
    select c.chat_id, coalesce(ce.modo, 'bot') as modo,
      exists (
        select 1 from public.ed_escalaciones esc
        where esc.chat_id = c.chat_id
          and esc.empleado_id in (select id from emps)
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
    'pausado', (select count(*) from base where modo = 'pausado' and not espera),
    'etiquetas', coalesce((select jsonb_object_agg(tag, n) from tags), '{}'::jsonb)
  );
$$;
revoke all on function public.ed_resumen_conversaciones_portal(uuid)
  from public, anon, authenticated;
grant execute on function public.ed_resumen_conversaciones_portal(uuid) to service_role;

-- Los helpers no exponen datos, pero tampoco tienen por qué ser públicos.
revoke all on function public.ed_sin_acentos(text) from public, anon, authenticated;
revoke all on function public.ed_patron_contiene(text) from public, anon, authenticated;
grant execute on function public.ed_sin_acentos(text) to service_role;
grant execute on function public.ed_patron_contiene(text) to service_role;

commit;

-- ── Verificación ────────────────────────────────────────────────────────────
select
  public.ed_sin_acentos('Sebastián Núñez') as sin_acentos,        -- sebastian nunez
  public.ed_patron_contiene('100%_x') as patron,                  -- %100\%\_x%
  (select count(*) from pg_proc where proname = 'ed_listar_conversaciones_portal') as fn_lista;
