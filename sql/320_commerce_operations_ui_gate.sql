-- ============================================================================
-- 320 · COMMERCE OPERATIONS UI GATE
-- Fix forward para la identidad canónica de reservas y el ledger atómico.
-- ============================================================================

begin;

-- La UI, la membresía y los pagos usan ed_contactos como identidad canónica.
-- 319 recibía p_contacto_id, pero no lo persistía en la cita.
alter table ed_citas
  add column if not exists contacto_id uuid references ed_contactos(id) on delete set null;

create index if not exists idx_ed_citas_cliente_contacto_inicio
  on ed_citas (cliente_id, contacto_id, inicio desc)
  where contacto_id is not null;

-- Backfill conservador: sólo cuando chat_id identifica exactamente un contacto
-- dentro del mismo tenant. Los casos ambiguos quedan nulos para revisión manual.
update ed_citas c
   set contacto_id = (
     select x.id
       from ed_contactos x
      where x.cliente_id = c.cliente_id
        and x.chat_id = c.chat_id
      order by x.creado_en asc
      limit 1
   )
 where c.contacto_id is null
   and c.chat_id is not null
   and 1 = (
     select count(*)
       from ed_contactos x
      where x.cliente_id = c.cliente_id
        and x.chat_id = c.chat_id
   );

create unique index if not exists uq_ed_citas_clase_contacto_activa
  on ed_citas (clase_id, contacto_id)
  where clase_id is not null
    and contacto_id is not null
    and estado in ('agendada', 'confirmada', 'reagendada');

-- Reemplaza P3 conservando la firma pública. La cita queda unida al contacto.
create or replace function ed_inscribir_con_credito(
  p_cliente_id   uuid,
  p_contacto_id  uuid,
  p_clase_id     uuid,
  p_nombre       text,
  p_telefono     text,
  p_chat_id      text,
  p_origen       text default 'whatsapp',
  p_empleado_id  uuid default null
)
returns table (
  ok boolean,
  motivo text,
  cita_id uuid,
  saldo_restante int,
  cupo_ocupado int,
  cupo_maximo int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membresia ed_membresias%rowtype;
  v_clase ed_clases%rowtype;
  v_cita_id uuid;
  v_nuevo_saldo int;
begin
  select * into v_membresia
    from ed_membresias
   where cliente_id = p_cliente_id
     and contacto_id = p_contacto_id
     and estado = 'activa'
     and fin > now()
     and (es_ilimitada or creditos_saldo > 0)
   order by fin asc
   limit 1
   for update;

  if not found then
    select * into v_membresia
      from ed_membresias
     where cliente_id = p_cliente_id and contacto_id = p_contacto_id
     order by fin desc limit 1;
    if v_membresia.id is null then
      return query select false, 'sin_membresia'::text, null::uuid, 0, 0, 0;
    elsif v_membresia.fin <= now() or v_membresia.estado = 'vencida' then
      return query select false, 'membresia_vencida'::text, null::uuid, 0, 0, 0;
    else
      return query select false, 'sin_creditos'::text, null::uuid, 0, 0, 0;
    end if;
    return;
  end if;

  update ed_clases c
     set cupo_ocupado = c.cupo_ocupado + 1, actualizado_en = now()
   where c.id = p_clase_id
     and c.cliente_id = p_cliente_id
     and c.estado = 'activa'
     and c.inicio > now()
     and c.cupo_ocupado < c.cupo_maximo
  returning * into v_clase;

  if not found then
    select * into v_clase from ed_clases
     where id = p_clase_id and cliente_id = p_cliente_id;
    if v_clase.id is null then
      return query select false, 'clase_no_existe'::text, null::uuid, v_membresia.creditos_saldo, 0, 0;
    elsif v_clase.estado <> 'activa' then
      return query select false, 'clase_cancelada'::text, null::uuid, v_membresia.creditos_saldo, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    elsif v_clase.inicio <= now() then
      return query select false, 'clase_ya_paso'::text, null::uuid, v_membresia.creditos_saldo, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    else
      return query select false, 'cupo_agotado'::text, null::uuid, v_membresia.creditos_saldo, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    end if;
    return;
  end if;

  insert into ed_citas (
    cliente_id, contacto_id, servicio_id, profesional_id, clase_id,
    chat_id, nombre_contacto, telefono, inicio, fin, estado, origen, empleado_id
  ) values (
    p_cliente_id, p_contacto_id, v_clase.servicio_id, v_clase.profesional_id, v_clase.id,
    p_chat_id, p_nombre, p_telefono, v_clase.inicio, v_clase.fin,
    'confirmada', p_origen, p_empleado_id
  ) returning id into v_cita_id;

  if v_membresia.es_ilimitada then
    v_nuevo_saldo := v_membresia.creditos_saldo;
  else
    v_nuevo_saldo := v_membresia.creditos_saldo - 1;
    insert into ed_creditos_ledger (
      cliente_id, membresia_id, tipo_movimiento, delta,
      saldo_resultante, referencia, idempotency_key, motivo
    ) values (
      p_cliente_id, v_membresia.id, 'consumo_reserva', -1,
      v_nuevo_saldo, v_cita_id::text, 'consumo-' || v_cita_id,
      'Inscripción a clase ' || p_clase_id
    );
    update ed_membresias
       set creditos_saldo = v_nuevo_saldo,
           estado = case when v_nuevo_saldo = 0 then 'agotada' else 'activa' end,
           actualizado_en = now()
     where id = v_membresia.id and cliente_id = p_cliente_id;
  end if;

  return query select true, 'ok'::text, v_cita_id,
                      v_nuevo_saldo, v_clase.cupo_ocupado, v_clase.cupo_maximo;
exception when unique_violation then
  return query select false, 'ya_inscrito'::text, null::uuid,
                      coalesce(v_membresia.creditos_saldo, 0),
                      coalesce(v_clase.cupo_ocupado, 0), coalesce(v_clase.cupo_maximo, 0);
end;
$$;

-- Mantiene la firma de la inscripción sin membresía y resuelve contacto_id
-- desde la identidad telefónica que ya recibe el RPC.
create or replace function ed_inscribir_en_clase(
  p_clase_id uuid,
  p_cliente_id uuid,
  p_nombre text,
  p_telefono text,
  p_chat_id text,
  p_origen text default 'web',
  p_empleado_id uuid default null
)
returns table (ok boolean, motivo text, cita_id uuid, cupo_ocupado int, cupo_maximo int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clase ed_clases%rowtype;
  v_cita_id uuid;
  v_contacto_id uuid;
begin
  select id into v_contacto_id
    from ed_contactos
   where cliente_id = p_cliente_id and chat_id = p_chat_id
   order by creado_en asc limit 1;

  update ed_clases c
     set cupo_ocupado = c.cupo_ocupado + 1, actualizado_en = now()
   where c.id = p_clase_id
     and c.cliente_id = p_cliente_id
     and c.estado = 'activa'
     and c.inicio > now()
     and c.cupo_ocupado < c.cupo_maximo
  returning * into v_clase;

  if not found then
    select * into v_clase from ed_clases
     where id = p_clase_id and cliente_id = p_cliente_id;
    if v_clase.id is null then
      return query select false, 'no_existe'::text, null::uuid, 0, 0;
    elsif v_clase.estado <> 'activa' then
      return query select false, 'cancelada'::text, null::uuid, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    elsif v_clase.inicio <= now() then
      return query select false, 'ya_paso'::text, null::uuid, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    else
      return query select false, 'cupo_tomado'::text, null::uuid, v_clase.cupo_ocupado, v_clase.cupo_maximo;
    end if;
    return;
  end if;

  insert into ed_citas (
    cliente_id, contacto_id, servicio_id, profesional_id, clase_id,
    chat_id, nombre_contacto, telefono, inicio, fin, estado, origen, empleado_id
  ) values (
    p_cliente_id, v_contacto_id, v_clase.servicio_id, v_clase.profesional_id, v_clase.id,
    p_chat_id, p_nombre, p_telefono, v_clase.inicio, v_clase.fin,
    'confirmada', p_origen, p_empleado_id
  ) returning id into v_cita_id;

  return query select true, 'ok'::text, v_cita_id,
                      v_clase.cupo_ocupado, v_clase.cupo_maximo;
exception when unique_violation then
  return query select false, 'ya_inscrito'::text, null::uuid,
                      coalesce(v_clase.cupo_ocupado, 0), coalesce(v_clase.cupo_maximo, 0);
end;
$$;

-- Movimiento y saldo cacheado se escriben bajo el mismo lock/transacción.
create or replace function ed_registrar_movimiento_credito(
  p_cliente_id uuid,
  p_membresia_id uuid,
  p_tipo_movimiento text,
  p_delta int,
  p_referencia text,
  p_idempotency_key text,
  p_motivo text
)
returns table (ok boolean, saldo_resultante int, ya_registrado boolean, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membresia ed_membresias%rowtype;
  v_existente int;
  v_nuevo_saldo int;
begin
  select l.saldo_resultante into v_existente
    from ed_creditos_ledger l
   where l.cliente_id = p_cliente_id and l.idempotency_key = p_idempotency_key;
  if found then
    return query select true, v_existente, true, 'ok'::text;
    return;
  end if;

  select * into v_membresia
    from ed_membresias
   where id = p_membresia_id and cliente_id = p_cliente_id
   for update;
  if not found then
    return query select false, 0, false, 'membresia_no_encontrada'::text;
    return;
  end if;

  if v_membresia.es_ilimitada and p_tipo_movimiento = 'consumo_reserva' then
    return query select true, v_membresia.creditos_saldo, false, 'ok'::text;
    return;
  end if;

  v_nuevo_saldo := v_membresia.creditos_saldo + p_delta;
  if v_nuevo_saldo < 0 then
    return query select false, v_membresia.creditos_saldo, false, 'saldo_insuficiente'::text;
    return;
  end if;

  insert into ed_creditos_ledger (
    cliente_id, membresia_id, tipo_movimiento, delta, saldo_resultante,
    referencia, idempotency_key, motivo
  ) values (
    p_cliente_id, p_membresia_id, p_tipo_movimiento, p_delta, v_nuevo_saldo,
    p_referencia, p_idempotency_key, p_motivo
  );

  update ed_membresias
     set creditos_saldo = v_nuevo_saldo,
         estado = case
           when v_nuevo_saldo = 0 and not es_ilimitada then 'agotada'
           else 'activa'
         end,
         actualizado_en = now()
   where id = p_membresia_id and cliente_id = p_cliente_id;

  return query select true, v_nuevo_saldo, false, 'ok'::text;
end;
$$;

revoke all on function ed_registrar_movimiento_credito(uuid, uuid, text, int, text, text, text)
  from public, anon, authenticated;
grant execute on function ed_registrar_movimiento_credito(uuid, uuid, text, int, text, text, text)
  to service_role;

-- La extensión de vigencia y la acreditación del plan se confirman juntas.
create or replace function ed_renovar_membresia_manual(
  p_cliente_id uuid,
  p_membresia_id uuid,
  p_idempotency_key text
)
returns table (ok boolean, nueva_fin timestamptz, saldo_resultante int, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membresia ed_membresias%rowtype;
  v_creditos int;
  v_vigencia_dias int;
  v_plan_nombre text;
  v_nueva_fin timestamptz;
  v_nuevo_saldo int;
begin
  select * into v_membresia
    from ed_membresias
   where id = p_membresia_id and cliente_id = p_cliente_id
   for update;
  if not found then
    return query select false, null::timestamptz, 0, 'membresia_no_encontrada'::text;
    return;
  end if;

  if exists (
    select 1 from ed_creditos_ledger l
     where l.cliente_id = p_cliente_id and l.idempotency_key = p_idempotency_key
  ) then
    return query select true, v_membresia.fin, v_membresia.creditos_saldo, 'ya_registrada'::text;
    return;
  end if;

  select p.creditos_totales, p.vigencia_dias, p.nombre
    into v_creditos, v_vigencia_dias, v_plan_nombre
    from ed_planes p
   where p.id = v_membresia.plan_id and p.cliente_id = p_cliente_id;
  if not found then
    return query select false, null::timestamptz, v_membresia.creditos_saldo, 'plan_no_encontrado'::text;
    return;
  end if;

  v_nueva_fin := greatest(now(), v_membresia.fin) + make_interval(days => v_vigencia_dias);
  v_nuevo_saldo := v_membresia.creditos_saldo + coalesce(v_creditos, 0);

  update ed_membresias
     set fin = v_nueva_fin,
         creditos_saldo = v_nuevo_saldo,
         estado = 'activa',
         actualizado_en = now()
   where id = p_membresia_id and cliente_id = p_cliente_id;

  if v_creditos is not null then
    insert into ed_creditos_ledger (
      cliente_id, membresia_id, tipo_movimiento, delta, saldo_resultante,
      idempotency_key, motivo
    ) values (
      p_cliente_id, p_membresia_id, 'renovacion', v_creditos, v_nuevo_saldo,
      p_idempotency_key, 'Renovación manual de plan: ' || v_plan_nombre
    );
  end if;

  return query select true, v_nueva_fin, v_nuevo_saldo, 'ok'::text;
end;
$$;

revoke all on function ed_renovar_membresia_manual(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function ed_renovar_membresia_manual(uuid, uuid, text)
  to service_role;

commit;
