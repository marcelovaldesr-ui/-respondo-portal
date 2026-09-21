-- ============================================================================
-- 319 · MEMBERSHIPS, CREDITS LEDGER & ATOMIC BOOKING (P2 & P3)
-- ============================================================================
-- QUÉ AGREGA:
-- 1. Catálogo de Planes (`ed_planes`):
--    - Nombre, precio, créditos totales (null = ilimitado), vigencia en días.
--    - Servicios permitidos (array de uuid opcional).
--
-- 2. Membresías de Contactos (`ed_membresias`):
--    - Referencia canónica a ed_contactos(id) (Guardrail 1: no usar chat_id).
--    - Fechas de vigencia (inicio, fin), estado (activa, vencida, cancelada, agotada).
--    - Saldo cacheado sincronizado atómicamente con el ledger.
--
-- 3. Ledger Inmutable de Créditos (`ed_creditos_ledger`):
--    - Fuente única de verdad para auditoría contable.
--    - Movimientos: alta_plan, renovacion, consumo_reserva, devolucion_cancelacion, ajuste_manual.
--    - Idempotency key con constraint unique por tenant.
--
-- 4. Operación atómica de inscripción con crédito (`ed_inscribir_con_credito`):
--    - Lock transaccional sobre la membresía y la clase.
--    - Garantiza 0 sobrecupos y 0 consumos de crédito sin reserva.
-- ============================================================================

begin;

-- 1. Catálogo de Planes
create table if not exists ed_planes (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references ed_clientes(id) on delete cascade,
  nombre               text not null,
  descripcion          text,
  precio_clp           int not null check (precio_clp >= 0),
  creditos_totales     int check (creditos_totales is null or creditos_totales > 0), -- null = ilimitado
  vigencia_dias        int not null default 30 check (vigencia_dias > 0),
  servicios_permitidos uuid[] default null, -- null = todas las clases/servicios
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);

create index if not exists idx_ed_planes_cliente on ed_planes(cliente_id, activo);

-- 2. Membresías
create table if not exists ed_membresias (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  contacto_id     uuid not null references ed_contactos(id) on delete cascade,
  plan_id         uuid not null references ed_planes(id) on delete restrict,
  inicio          timestamptz not null default now(),
  fin             timestamptz not null,
  estado          text not null default 'activa'
                  check (estado in ('activa', 'vencida', 'cancelada', 'agotada')),
  creditos_saldo  int not null default 0 check (creditos_saldo >= 0),
  es_ilimitada    boolean not null default false,
  ultimo_pago_id  uuid references ed_pagos(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists idx_ed_membresias_cliente_contacto
  on ed_membresias(cliente_id, contacto_id, estado);
create index if not exists idx_ed_membresias_fin
  on ed_membresias(cliente_id, fin) where estado = 'activa';

-- 3. Ledger Inmutable de Créditos
create table if not exists ed_creditos_ledger (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references ed_clientes(id) on delete cascade,
  membresia_id     uuid not null references ed_membresias(id) on delete cascade,
  tipo_movimiento  text not null check (tipo_movimiento in (
    'alta_plan',
    'renovacion',
    'consumo_reserva',
    'devolucion_cancelacion',
    'ajuste_manual'
  )),
  delta            int not null,
  saldo_resultante int not null check (saldo_resultante >= 0),
  referencia       text, -- cita_id, pago_id, etc.
  idempotency_key  text not null,
  motivo           text,
  creado_en        timestamptz not null default now(),

  constraint uq_ed_creditos_ledger_idempotency unique (cliente_id, idempotency_key)
);

create index if not exists idx_ed_creditos_ledger_membresia
  on ed_creditos_ledger(membresia_id, creado_en desc);

-- RLS
alter table ed_planes enable row level security;
alter table ed_membresias enable row level security;
alter table ed_creditos_ledger enable row level security;

-- 4. Función de Inscripción Atómica con Crédito (P3)
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
as $$
declare
  v_membresia  ed_membresias%rowtype;
  v_clase      ed_clases%rowtype;
  v_cita_id    uuid;
  v_nuevo_saldo int;
  v_idemp_key  text;
begin
  -- 1. Buscar membresía activa con FOR UPDATE (bloqueo determinista de concurrencia)
  select * into v_membresia
    from ed_membresias
   where cliente_id = p_cliente_id
     and contacto_id = p_contacto_id
     and estado = 'activa'
     and fin > now()
     and (es_ilimitada = true or creditos_saldo > 0)
   order by fin asc
   limit 1
     for update;

  if not found then
    -- Verificar si existe alguna membresía para mensaje exacto
    select * into v_membresia
      from ed_membresias
     where cliente_id = p_cliente_id
       and contacto_id = p_contacto_id
     order by fin desc
     limit 1;

    if v_membresia.id is null then
      return query select false, 'sin_membresia'::text, null::uuid, 0, 0, 0;
    elsif v_membresia.fin <= now() or v_membresia.estado = 'vencida' then
      return query select false, 'membresia_vencida'::text, null::uuid, 0, 0, 0;
    else
      return query select false, 'sin_creditos'::text, null::uuid, 0, 0, 0;
    end if;
    return;
  end if;

  -- 2. Reservar cupo en la clase con UPDATE condicional
  update ed_clases c
     set cupo_ocupado = c.cupo_ocupado + 1,
         actualizado_en = now()
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

  -- 3. Crear cita/inscripción en ed_citas
  insert into ed_citas (
    cliente_id, servicio_id, profesional_id, clase_id,
    chat_id, nombre_contacto, telefono, inicio, fin,
    estado, origen, empleado_id
  ) values (
    p_cliente_id, v_clase.servicio_id, v_clase.profesional_id, v_clase.id,
    p_chat_id, p_nombre, p_telefono, v_clase.inicio, v_clase.fin,
    'confirmada', p_origen, p_empleado_id
  ) returning id into v_cita_id;

  -- 4. Descontar crédito en ledger y membresía (si no es ilimitada)
  if v_membresia.es_ilimitada then
    v_nuevo_saldo := v_membresia.creditos_saldo;
  else
    v_nuevo_saldo := v_membresia.creditos_saldo - 1;
    v_idemp_key := 'consumo-' || v_cita_id;

    insert into ed_creditos_ledger (
      cliente_id, membresia_id, tipo_movimiento, delta,
      saldo_resultante, referencia, idempotency_key, motivo
    ) values (
      p_cliente_id, v_membresia.id, 'consumo_reserva', -1,
      v_nuevo_saldo, v_cita_id::text, v_idemp_key,
      'Inscripción a clase ' || p_clase_id
    );

    update ed_membresias
       set creditos_saldo = v_nuevo_saldo,
           estado = case when v_nuevo_saldo = 0 then 'agotada' else 'activa' end,
           actualizado_en = now()
     where id = v_membresia.id;
  end if;

  return query select true, 'ok'::text, v_cita_id,
                      v_nuevo_saldo, v_clase.cupo_ocupado, v_clase.cupo_maximo;
end;
$$;

commit;
