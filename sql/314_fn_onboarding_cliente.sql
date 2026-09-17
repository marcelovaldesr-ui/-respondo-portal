-- ============================================================================
-- 314_fn_onboarding_cliente.sql · Aprovisionamiento atómico de nuevo cliente
-- ----------------------------------------------------------------------------
-- PROPOSITO:
--   Unificar el alta de un nuevo tenant en UNA SOLA transacción PostgreSQL atómica,
--   idempotente y segura.
--
-- GARANTÍAS:
--   1. ATOMICIDAD TOTAL: ed_clientes + portal_usuarios (dueño + staff) + ed_empleados
--      ocurren en una sola transacción. Si falla cualquier paso, PostgreSQL hace
--      ROLLBACK completo de todo el tenant.
--   2. ESQUEMA REAL:
--      - ed_clientes exige plan explícito: 'tino_solo', 'inicial', 'crecimiento',
--        'empresa', 'a_medida' (constraint ed_clientes_plan_valido de migración 278).
--        NO se aplican defaults comerciales implícitos.
--      - Moneda validada contra formato ISO-4217 (^[A-Z]{3}$, migración 311).
--      - Módulo agenda activa 'reservas_online = true' en ed_clientes (migración 220).
--        NO existe tabla 'ed_citas_config' en el esquema vigente.
--      - Encapsula rol 'rita' en base de datos para el empleado público 'Beto'.
--   3. IDEMPOTENCIA REAL EXHAUSTIVA:
--      - La comparación cubre TODOS los campos relevantes de aprovisionamiento:
--        nombre, rubro, email_dueno, plan, cupo_conversaciones, moneda, transporte,
--        reservas_online (agenda), telefono_escalacion, staff (lista ordenada),
--        pago_link_base y pago_ref_etiqueta.
--      - Payload idéntico -> mismo tenant sin writes (idempotente = true).
--      - Mismo slug pero CUALQUIER dato relevante distinto -> CONFLICTO_IDEMPOTENCIA.
--   4. MANEJO DE CARRERAS (CONCURRENCY):
--      - Atrapa excepciones de 'unique_violation' (SQLSTATE 23505) producidas por
--        solicitudes simultáneas concurrentes y las mapea a errores estructurados
--        claros (CONFLICTO_CARRERA_SLUG, CONFLICTO_CARRERA_EMAIL, etc.).
--   5. SEGURIDAD INVOKER Y PRIVILEGIOS MÍNIMOS:
--      - La función es SECURITY INVOKER (ejecuta con permisos del llamador).
--      - Se otorgan privilegios DML mínimos (SELECT, INSERT) exclusivamente a service_role.
--      - Se revoca el acceso de ejecución a PUBLIC, anon y authenticated.
--      - Se otorga permiso de ejecución EXCLUSIVAMENTE a service_role (backend autorizado).
-- ============================================================================

create or replace function public.ed_aprovisionar_cliente(p_datos jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_nombre text;
  v_rubro text;
  v_email_dueno text;
  v_slug text;
  v_plan text;
  v_cupo integer;
  v_moneda text;
  v_transporte text;
  v_con_agenda boolean;
  v_telefono_raw text;
  v_arr_escalacion text[];
  v_pago_base text;
  v_pago_etiqueta text;
  v_cliente_id uuid;
  v_final_id uuid;

  -- Variables de comprobación de existencia exhaustiva para idempotencia
  v_existing_id uuid;
  v_existing_nombre text;
  v_existing_rubro text;
  v_existing_plan text;
  v_existing_cupo integer;
  v_existing_moneda text;
  v_existing_transporte text;
  v_existing_con_agenda boolean;
  v_existing_escalacion text[];
  v_existing_pago_base text;
  v_existing_pago_etiqueta text;
  v_existing_owner_email text;
  v_existing_staff_emails text[];
  v_sorted_request_staff text[];
  v_existing_by_email uuid;

  -- Variables para staff
  v_staff_elem jsonb;
  v_staff_email text;
  v_staff_emails text[] := array[]::text[];

  -- Variables para manejo de carreras
  v_err_constraint text;
  v_err_detail text;
  v_err_msg text;
begin
  -- ── 1. EXTRACCIÓN Y VALIDACIÓN BÁSICA DE DATOS ──────────────────────────────
  v_nombre := trim(coalesce(p_datos->>'nombre', ''));
  if length(v_nombre) < 2 then
    raise exception 'PARAMETRO_INVALIDO: El nombre de la empresa debe tener al menos 2 caracteres.';
  end if;

  v_rubro := trim(coalesce(p_datos->>'rubro', 'general'));
  if length(v_rubro) < 2 then
    v_rubro := 'general';
  end if;

  v_email_dueno := lower(trim(coalesce(p_datos->>'email_dueno', '')));
  if length(v_email_dueno) < 5 or v_email_dueno !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALIDO: El email del dueño no es válido: "%"', v_email_dueno;
  end if;

  -- ── 2. PLAN EXPLICITO (SIN DEFAULTS COMERCIALES IMPLÍCITOS) ────────────────
  v_plan := lower(trim(coalesce(p_datos->>'plan', '')));
  if length(v_plan) = 0 then
    raise exception 'PLAN_REQUERIDO: Debe especificar un plan comercial explícito ("tino_solo", "inicial", "crecimiento", "empresa", "a_medida").';
  end if;

  if v_plan not in ('tino_solo', 'inicial', 'crecimiento', 'empresa', 'a_medida') then
    raise exception 'PLAN_INVALIDO: El plan "%" no es válido. Debe ser tino_solo, inicial, crecimiento, empresa o a_medida.', v_plan;
  end if;

  if p_datos ? 'cupo_conversaciones' and p_datos->>'cupo_conversaciones' is not null then
    v_cupo := (p_datos->>'cupo_conversaciones')::integer;
    if v_cupo < 0 then
      raise exception 'CUPO_INVALIDO: El cupo de conversaciones no puede ser negativo.';
    end if;
  else
    -- Asignar cupo canónico según migración 278 y lib/cupoConversaciones.ts
    v_cupo := case v_plan
      when 'tino_solo' then 800
      when 'inicial' then 1200
      when 'crecimiento' then 3000
      when 'empresa' then 6000
      else null -- 'a_medida'
    end;
  end if;

  -- ── 3. MONEDA ISO-4217 ─────────────────────────────────────────────────────
  v_moneda := upper(trim(coalesce(p_datos->>'moneda', 'CLP')));
  if v_moneda !~ '^[A-Z]{3}$' then
    raise exception 'MONEDA_INVALIDA: La moneda debe ser código ISO de 3 letras (ej: CLP, USD): "%"', v_moneda;
  end if;

  -- ── 4. TRANSPORTE ──────────────────────────────────────────────────────────
  v_transporte := lower(trim(coalesce(p_datos->>'transporte', 'cloud')));
  if v_transporte not in ('cloud', 'waha', 'ambos') then
    raise exception 'TRANSPORTE_INVALIDO: Transporte debe ser cloud, waha o ambos: "%"', v_transporte;
  end if;

  -- ── 5. SLUG ────────────────────────────────────────────────────────────────
  v_slug := lower(trim(coalesce(p_datos->>'slug', '')));
  if length(v_slug) = 0 then
    -- Generar slug limpio a partir del nombre
    v_slug := lower(v_nombre);
    v_slug := regexp_replace(v_slug, '[áàäâ]', 'a', 'g');
    v_slug := regexp_replace(v_slug, '[éèëê]', 'e', 'g');
    v_slug := regexp_replace(v_slug, '[íìïî]', 'i', 'g');
    v_slug := regexp_replace(v_slug, '[óòöô]', 'o', 'g');
    v_slug := regexp_replace(v_slug, '[úùüû]', 'u', 'g');
    v_slug := regexp_replace(v_slug, '[ñ]', 'n', 'g');
    v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
  end if;

  if length(v_slug) < 2 or v_slug !~ '^[a-z0-9-]+$' then
    raise exception 'SLUG_INVALIDO: El slug "%" no es válido (solo letras minúsculas, números y guiones).', v_slug;
  end if;

  -- ── 6. TELÉFONO DE ESCALACIÓN ──────────────────────────────────────────────
  if p_datos ? 'telefono_escalacion' then
    if jsonb_typeof(p_datos->'telefono_escalacion') = 'array' then
      select array_agg(trim(x.val)) into v_arr_escalacion
      from jsonb_array_elements_text(p_datos->'telefono_escalacion') as x(val)
      where length(regexp_replace(x.val, '\D', '', 'g')) >= 8;
    else
      v_telefono_raw := trim(p_datos->>'telefono_escalacion');
      if length(regexp_replace(v_telefono_raw, '\D', '', 'g')) >= 8 then
        v_arr_escalacion := array[v_telefono_raw];
      end if;
    end if;
  end if;

  if v_arr_escalacion is null or array_length(v_arr_escalacion, 1) is null or array_length(v_arr_escalacion, 1) = 0 then
    raise exception 'TELEFONO_INVALIDO: Teléfono de escalación requerido con al menos 8 dígitos.';
  end if;

  -- ── 7. VALIDACIÓN DE STAFF ─────────────────────────────────────────────────
  if p_datos ? 'email_staff' and p_datos->'email_staff' is not null then
    if jsonb_typeof(p_datos->'email_staff') = 'array' then
      for v_staff_elem in select * from jsonb_array_elements(p_datos->'email_staff')
      loop
        v_staff_email := lower(trim(v_staff_elem#>>'{}'));
        if length(v_staff_email) > 0 then
          if v_staff_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
            raise exception 'EMAIL_STAFF_INVALIDO: Email de staff con formato incorrecto: "%"', v_staff_email;
          end if;
          if v_staff_email = v_email_dueno then
            raise exception 'STAFF_DUPLICADO: El email de staff "%" no puede ser el mismo del dueño.', v_staff_email;
          end if;
          if v_staff_email = any(v_staff_emails) then
            raise exception 'STAFF_DUPLICADO: El email de staff "%" está duplicado en la solicitud.', v_staff_email;
          end if;
          v_staff_emails := array_append(v_staff_emails, v_staff_email);
        end if;
      end loop;
    elsif jsonb_typeof(p_datos->'email_staff') = 'string' and length(trim(p_datos->>'email_staff')) > 0 then
      v_staff_email := lower(trim(p_datos->>'email_staff'));
      if v_staff_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'EMAIL_STAFF_INVALIDO: Email de staff con formato incorrecto: "%"', v_staff_email;
      end if;
      if v_staff_email = v_email_dueno then
        raise exception 'STAFF_DUPLICADO: El email de staff no puede ser el mismo del dueño.';
      end if;
      v_staff_emails := array[v_staff_email];
    end if;
  end if;

  -- Ordenar staff solicitado para comparación canónica exacta
  if array_length(v_staff_emails, 1) > 0 then
    select coalesce(array_agg(s order by s), array[]::text[])
    into v_sorted_request_staff
    from unnest(v_staff_emails) as s;
  else
    v_sorted_request_staff := array[]::text[];
  end if;

  -- ── 8. CONFIGURACIÓN OPCIONAL PREVIA A IDEMPOTENCIA ─────────────────────────
  v_con_agenda := coalesce((p_datos->>'con_agenda')::boolean, false);
  v_pago_base := nullif(trim(coalesce(p_datos->>'pago_link_base', '')), '');
  v_pago_etiqueta := nullif(trim(coalesce(p_datos->>'pago_ref_etiqueta', '')), '');

  if p_datos ? 'cliente_id' and p_datos->>'cliente_id' is not null and length(trim(p_datos->>'cliente_id')) > 0 then
    v_cliente_id := (p_datos->>'cliente_id')::uuid;
  end if;

  -- ── 9. CONTRATO DE IDEMPOTENCIA REAL EXHAUSTIVO ─────────────────────────────
  -- Comprobar si el slug ya existe
  select
    id,
    nombre,
    rubro,
    plan,
    cupo_conversaciones,
    moneda,
    transporte,
    reservas_online,
    telefono_escalacion,
    pago_link_base,
    pago_ref_etiqueta
  into
    v_existing_id,
    v_existing_nombre,
    v_existing_rubro,
    v_existing_plan,
    v_existing_cupo,
    v_existing_moneda,
    v_existing_transporte,
    v_existing_con_agenda,
    v_existing_escalacion,
    v_existing_pago_base,
    v_existing_pago_etiqueta
  from public.ed_clientes
  where slug = v_slug;

  if v_existing_id is not null then
    -- Obtener email del dueño registrado para este tenant
    select email into v_existing_owner_email
    from public.portal_usuarios
    where cliente_id = v_existing_id and rol = 'dueno' and activo = true
    limit 1;

    -- Obtener lista ordenada de staff registrados para este tenant
    select coalesce(array_agg(email order by email), array[]::text[])
    into v_existing_staff_emails
    from public.portal_usuarios
    where cliente_id = v_existing_id and rol = 'staff' and activo = true;

    -- Comparación exhaustiva de TODOS los campos relevantes del aprovisionamiento:
    if lower(trim(v_existing_nombre)) = lower(v_nombre)
       and lower(trim(coalesce(v_existing_rubro, 'general'))) = lower(v_rubro)
       and v_existing_owner_email = v_email_dueno
       and v_existing_plan = v_plan
       and coalesce(v_existing_cupo, -1) = coalesce(v_cupo, -1)
       and v_existing_moneda = v_moneda
       and v_existing_transporte = v_transporte
       and v_existing_con_agenda = v_con_agenda
       and coalesce(v_existing_escalacion, array[]::text[]) = v_arr_escalacion
       and coalesce(v_existing_pago_base, '') = coalesce(v_pago_base, '')
       and coalesce(v_existing_pago_etiqueta, '') = coalesce(v_pago_etiqueta, '')
       and v_existing_staff_emails = v_sorted_request_staff
       and (v_cliente_id is null or v_cliente_id = v_existing_id)
    then
      -- Payload idéntico: Retorna tenant existente sin ningún write en la base de datos
      return jsonb_build_object(
        'ok', true,
        'idempotente', true,
        'status', 'EXISTENTE_NO_MODIFICADO',
        'cliente_id', v_existing_id,
        'nombre', v_existing_nombre,
        'slug', v_slug,
        'email_dueno', v_existing_owner_email,
        'transporte', v_existing_transporte,
        'moneda', v_existing_moneda,
        'plan', v_existing_plan,
        'cupo_conversaciones', v_existing_cupo,
        'agenda_activa', v_existing_con_agenda,
        'staff_count', coalesce(array_length(v_existing_staff_emails, 1), 0)
      );
    else
      -- Mismo slug pero algún dato relevante difiere: conflicto de idempotencia estricto
      raise exception 'CONFLICTO_IDEMPOTENCIA: El slug "%" ya existe pero con datos distintos a los solicitados.', v_slug;
    end if;
  end if;

  -- Comprobar si el email de dueño ya está en uso en otra empresa
  select cliente_id into v_existing_by_email
  from public.portal_usuarios
  where email = v_email_dueno
  limit 1;

  if v_existing_by_email is not null then
    raise exception 'EMAIL_EN_USO: El email del dueño "%" ya está registrado para otra empresa en el portal.', v_email_dueno;
  end if;

  -- Comprobar si algún email de staff ya está en uso
  if array_length(v_staff_emails, 1) > 0 then
    for i in 1 .. array_length(v_staff_emails, 1) loop
      if exists (select 1 from public.portal_usuarios where email = v_staff_emails[i]) then
        raise exception 'EMAIL_STAFF_EN_USO: El email de staff "%" ya está registrado en el portal.', v_staff_emails[i];
      end if;
    end loop;
  end if;

  -- Comprobar si el cliente_id solicitado ya existe
  if v_cliente_id is not null and exists (select 1 from public.ed_clientes where id = v_cliente_id) then
    raise exception 'ID_EN_USO: El ID de cliente especificado ya existe con otro slug.';
  end if;

  -- ── 10. EJECUCIÓN ATÓMICA CON CAPTURA DE CARRERAS CONCURRENTES ──────────────
  v_final_id := coalesce(v_cliente_id, gen_random_uuid());

  begin
    -- A. ed_clientes
    insert into public.ed_clientes (
      id,
      nombre,
      rubro,
      activo,
      transporte,
      telefono_escalacion,
      canal_escalacion,
      destino_leads,
      slug,
      reservas_online,
      moneda,
      plan,
      cupo_conversaciones,
      pago_link_base,
      pago_ref_etiqueta
    ) values (
      v_final_id,
      v_nombre,
      v_rubro,
      true,
      v_transporte,
      v_arr_escalacion,
      'whatsapp',
      'sheets',
      v_slug,
      v_con_agenda,
      v_moneda,
      v_plan,
      v_cupo,
      v_pago_base,
      v_pago_etiqueta
    );

    -- B. portal_usuarios (Dueño)
    insert into public.portal_usuarios (
      email,
      cliente_id,
      rol,
      activo
    ) values (
      v_email_dueno,
      v_final_id,
      'dueno',
      true
    );

    -- C. portal_usuarios (Staff solicitados)
    if array_length(v_staff_emails, 1) > 0 then
      for i in 1 .. array_length(v_staff_emails, 1) loop
        insert into public.portal_usuarios (
          email,
          cliente_id,
          rol,
          activo
        ) values (
          v_staff_emails[i],
          v_final_id,
          'staff',
          true
        );
      end loop;
    end if;

    -- D. ed_empleados (Terna de IA Canónica)
    -- 1. Tino (Atención y Ventas)
    insert into public.ed_empleados (
      cliente_id,
      rol,
      nombre_publico,
      activo,
      ficha_personalidad
    ) values (
      v_final_id,
      'tino',
      'Tino',
      true,
      jsonb_build_object(
        'tono', 'cálido, empático, claro y profesional',
        'emoji', 'moderado',
        'objetivo', 'atender consultas y agendar',
        'umbral_monto', 50000,
        'palabras_clave_escalacion', jsonb_build_array('reclamo', 'humano', 'gerente', 'abogado', 'urgencia')
      )
    );

    -- 2. Beto (Seguimiento — rol interno 'rita' encapsulado)
    insert into public.ed_empleados (
      cliente_id,
      rol,
      nombre_publico,
      activo,
      ficha_personalidad
    ) values (
      v_final_id,
      'rita',
      'Beto',
      true,
      jsonb_build_object(
        'tono', 'amable y proactivo',
        'emoji', 'moderado',
        'objetivo', 'retomar cotizaciones y reactivar clientes',
        'dias_espera_reactivacion', 30
      )
    );

    -- 3. Vera (Auditoría y Satisfacción)
    insert into public.ed_empleados (
      cliente_id,
      rol,
      nombre_publico,
      activo,
      ficha_personalidad
    ) values (
      v_final_id,
      'vera',
      'Vera',
      true,
      jsonb_build_object(
        'tono', 'empático y cuidadoso',
        'emoji', 'suave',
        'objetivo', 'postventa, NPS y reseñas',
        'criterio_estricto', true
      )
    );

  exception
    when unique_violation then
      get stacked diagnostics
        v_err_constraint = CONSTRAINT_NAME,
        v_err_detail = PG_EXCEPTION_DETAIL,
        v_err_msg = MESSAGE_TEXT;

      if v_err_constraint ilike '%slug%' or v_err_detail ilike '%slug%' then
        raise exception 'CONFLICTO_CARRERA_SLUG: Conflicto de concurrencia: el slug "%" fue registrado por otra transacción simultánea.', v_slug;
      elsif v_err_constraint ilike '%email%' or v_err_detail ilike '%email%' then
        raise exception 'CONFLICTO_CARRERA_EMAIL: Conflicto de concurrencia: el email "%" fue registrado por otra transacción simultánea.', v_email_dueno;
      else
        raise exception 'CONFLICTO_CARRERA_UNIQUE: Violación de unicidad concurrente [%]: %', v_err_constraint, v_err_msg;
      end if;
  end;

  return jsonb_build_object(
    'ok', true,
    'idempotente', false,
    'status', 'CREADO',
    'cliente_id', v_final_id,
    'nombre', v_nombre,
    'slug', v_slug,
    'email_dueno', v_email_dueno,
    'transporte', v_transporte,
    'moneda', v_moneda,
    'plan', v_plan,
    'cupo_conversaciones', v_cupo,
    'agenda_activa', v_con_agenda,
    'staff_count', coalesce(array_length(v_staff_emails, 1), 0)
  );
end;
$$;

-- ── PRIVILEGIOS DML MÍNIMOS PARA service_role ────────────────────────────────
-- Como la función es SECURITY INVOKER, service_role (el rol llamador autorizado)
-- debe poseer permisos explícitos de SELECT e INSERT sobre las tablas core.
grant select, insert on table public.ed_clientes to service_role;
grant select, insert on table public.portal_usuarios to service_role;
grant insert on table public.ed_empleados to service_role;

-- ── SEGURIDAD Y PERMISOS DE EJECUCIÓN DE LA FUNCIÓN ──────────────────────────
-- Revocar ejecución de cualquier rol público, anónimo o autenticado estándar
revoke all on function public.ed_aprovisionar_cliente(jsonb) from public;
revoke all on function public.ed_aprovisionar_cliente(jsonb) from anon;
revoke all on function public.ed_aprovisionar_cliente(jsonb) from authenticated;

-- Conceder ejecución exclusivamente a service_role (backend autenticado)
grant execute on function public.ed_aprovisionar_cliente(jsonb) to service_role;

comment on function public.ed_aprovisionar_cliente(jsonb) is
  'Aprovisiona atómicamente un nuevo tenant (ed_clientes, portal_usuarios dueño y staff, empleados IA Tino/Beto/Vera y agenda opcional). Invocable exclusivamente por service_role con verificación de idempotencia exhaustiva y captura de carreras concurrentes.';
