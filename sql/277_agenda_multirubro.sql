-- ============================================================================
-- 277_agenda_multirubro.sql · La agenda se adapta a cualquier rubro
-- ----------------------------------------------------------------------------
-- Auditoría del módulo de agenda (11-ago-2026), contrastada con AgendaPro y
-- Dentalink. Tres carencias que nos dejaban abajo, y una sola migración:
--
-- 1) FICHA POR SERVICIO (campos personalizados)
--    Hoy pedimos siempre lo mismo: nombre y teléfono. Sirve para una barbería
--    y se queda corto para todo lo demás:
--      · clínica dental  → RUT, previsión (Fonasa/Isapre), primera vez o control
--      · taller mecánico → patente, marca y modelo, kilometraje
--      · centro médico   → RUT, edad, motivo de consulta
--      · inmobiliaria    → propiedad de interés, forma de pago
--      · veterinaria     → nombre y especie de la mascota
--    En vez de programar un formulario por rubro —que no escala y nos amarra a
--    mantener uno por cliente—, el negocio define SUS campos. Un solo mecanismo
--    cubre todos los rubros, incluidos los que todavía no conocemos.
--    AgendaPro lo llama "fichas personalizables" y es de lo que más venden.
--
-- 2) AUTOGESTIÓN DEL CLIENTE FINAL (cancelar / reagendar solo)
--    Hoy la única salida es "escríbenos por WhatsApp". Es el hueco más grande
--    frente a la competencia: en AgendaPro el cliente cancela o reagenda desde
--    un enlace y el negocio no hace nada. Además nos conviene a NOSOTROS: cada
--    cambio que el cliente resuelve solo es una conversación menos que Tino
--    tiene que atender y una hora que se libera al instante en vez de quedar
--    ocupada hasta que alguien lea el WhatsApp.
--
-- 3) TIEMPO DE PREPARACIÓN ENTRE HORAS (buffer)
--    Sanitizar el box, limpiar el sillón, guardar herramientas, dar la pasada
--    entre un auto y el siguiente. Sin esto la agenda se llena pegada y en la
--    práctica el negocio corre atrasado todo el día — un problema real que hoy
--    resuelven a mano dejando horas falsas bloqueadas.
--
-- APLICAR EN SUPABASE (SQL editor). Aditiva: sin campos definidos, sin buffer
-- y sin usar los enlaces, todo se comporta EXACTAMENTE igual que hoy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Campos personalizados que el negocio le pide a quien reserva
-- ---------------------------------------------------------------------------
create table if not exists ed_servicio_campos (
  id           uuid primary key default gen_random_uuid(),
  servicio_id  uuid not null references ed_servicios(id) on delete cascade,
  etiqueta     text not null,                    -- "RUT del paciente"
  -- 'rut' valida dígito verificador chileno en el servidor. Lo usan clínicas,
  -- centros médicos y todo lo que emite boleta: un RUT mal tipeado se detecta
  -- al reservar y no cuando el paciente ya está en el box.
  tipo         text not null default 'texto'
                 check (tipo in ('texto','parrafo','numero','telefono','email','opciones','si_no','fecha','rut')),
  -- Solo para tipo='opciones' (ej. {Fonasa, Isapre, Particular}).
  opciones     text[],
  obligatorio  boolean not null default false,
  ayuda        text,                             -- pista bajo el campo
  orden        int not null default 0,
  creado_en    timestamptz not null default now(),

  -- Un campo de opciones sin opciones sería un desplegable vacío: el negocio
  -- lo guardaría sin notarlo y quien reserva quedaría trabado sin poder seguir.
  constraint ed_servicio_campos_opciones_coherentes
    check (tipo <> 'opciones' or (opciones is not null and array_length(opciones, 1) >= 1))
);
create index if not exists idx_ed_servicio_campos_servicio
  on ed_servicio_campos(servicio_id, orden);

-- Respuestas de esa ficha, guardadas con la cita.
-- jsonb y no columnas: cada negocio tiene su propio conjunto de campos.
alter table ed_citas add column if not exists datos_extra jsonb;

comment on table ed_servicio_campos is
  'Ficha personalizable por servicio: lo que el negocio le pregunta a quien reserva. Un mecanismo para todos los rubros.';
comment on column ed_citas.datos_extra is
  'Respuestas de la ficha del servicio, {etiqueta: valor}. Ver ed_servicio_campos.';

-- ---------------------------------------------------------------------------
-- 2) Autogestión: enlace propio de cada cita
-- ---------------------------------------------------------------------------
-- Token largo y aleatorio: es la ÚNICA credencial para ver y mover la cita, así
-- que tiene que ser imposible de adivinar o de enumerar. 18 bytes = 36 hex.
alter table ed_citas add column if not exists gestion_token text;

-- Backfill de las citas que ya existen, para que también tengan enlace.
update ed_citas
   set gestion_token = encode(gen_random_bytes(18), 'hex')
 where gestion_token is null;

alter table ed_citas alter column gestion_token set default encode(gen_random_bytes(18), 'hex');

create unique index if not exists uq_ed_citas_gestion_token
  on ed_citas(gestion_token) where gestion_token is not null;

-- Políticas del negocio: hasta dónde puede llegar el cliente por su cuenta.
alter table ed_clientes add column if not exists permite_cancelar_online  boolean not null default true;
alter table ed_clientes add column if not exists permite_reagendar_online boolean not null default true;
-- Cuántas horas antes se corta la autogestión. Una cancelación 5 minutos antes
-- no le sirve a nadie: el cupo ya no se puede revender.
alter table ed_clientes add column if not exists cancelacion_min_horas int not null default 4
  check (cancelacion_min_horas between 0 and 168);

comment on column ed_citas.gestion_token is
  'Credencial secreta del enlace de autogestión (/cita/<token>). Nunca se muestra en el portal ni se registra en logs.';

-- ---------------------------------------------------------------------------
-- 3) Tiempo de preparación entre horas
-- ---------------------------------------------------------------------------
-- Va en el SERVICIO y no en el profesional: limpiar un box de cirugía no toma
-- lo mismo que atender una consulta de control con el mismo dentista.
alter table ed_servicios add column if not exists buffer_min int not null default 0
  check (buffer_min between 0 and 120);

comment on column ed_servicios.buffer_min is
  'Minutos de preparación DESPUÉS de la hora, antes de poder tomar la siguiente. No se le muestran a quien reserva.';

-- ---------------------------------------------------------------------------
-- 4) RLS (misma barrera que el resto: solo service_role)
-- ---------------------------------------------------------------------------
alter table ed_servicio_campos enable row level security;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_name = 'ed_servicio_campos')                              as tabla_campos,
  (select count(*) from information_schema.columns
     where table_name = 'ed_citas'
       and column_name in ('datos_extra','gestion_token'))                 as cols_citas,
  (select count(*) from information_schema.columns
     where table_name = 'ed_clientes'
       and column_name in ('permite_cancelar_online','permite_reagendar_online','cancelacion_min_horas')) as cols_politicas,
  (select count(*) from information_schema.columns
     where table_name = 'ed_servicios' and column_name = 'buffer_min')     as col_buffer,
  (select count(*) from ed_citas where gestion_token is null)              as citas_sin_token;
