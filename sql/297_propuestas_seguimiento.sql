-- ============================================================================
-- 297 · MODO APROBACIÓN: BETO PROPONE, CECILIA DECIDE
-- ============================================================================
--
-- POR QUÉ (9-sep-2026)
-- --------------------
-- Marcelo preguntó si Beto era capaz de leer y entender las conversaciones. No
-- lo era: decidía con metadatos del contacto —una etiqueta, quién habló último,
-- los días de silencio— y nunca abría el hilo. La migración 288 ya dejó eso
-- apagado con tope diario, y ahora `lib/juezCotizacionCore.ts` agrega un juez
-- que sí lee. Pero un juez con IA no convierte $85 por mensaje en una decisión
-- automática: la convierte en una decisión BIEN INFORMADA que igual conviene
-- que mire alguien la primera temporada.
--
-- La simulación del 9-sep contra Impresora Color, sobre datos reales: de 300
-- contactos en la ventana, la reja dejó 20 y el juez aprobó 12. De los 8 que
-- frenó, dos eran «el cliente ya transfirió el total» y «canceló y pidió la
-- devolución» — exactamente los mensajes que no se pueden mandar.
--
-- LA DECISIÓN DE DISEÑO QUE IMPORTA
-- ---------------------------------
-- Esto es una tabla NUEVA y NO toca `ed_seguimientos`, `lib/seguimientos.ts` ni
-- el cron. El motor de seguimientos lo comparten las citas, la fidelización y
-- Vera; meterle un estado «propuesto» habría obligado a que todos los que hoy
-- insertan ahí entiendan el estado nuevo, y basta que uno no lo filtre para que
-- salga un mensaje que nadie aprobó.
--
-- El circuito queda así:
--   generador → ed_propuestas_seguimiento (estado 'propuesto')
--   Cecilia aprueba en /seguimientos → programarSeguimiento() → ed_seguimientos
--   el cron envía, sin enterarse de que esto existe.
--
-- ⚠️ APLICAR ESTA MIGRACIÓN NO ENVÍA NADA NI CAMBIA NADA. La tabla nace vacía y
-- `cotizacion_seguimiento` sigue en false para todos los clientes.
-- ============================================================================

-- ── El interruptor por cliente ──────────────────────────────────────────────
--
-- `aprobacion` es el DEFAULT a propósito: si algún día alguien enciende
-- `cotizacion_seguimiento` sin leer nada, lo peor que puede pasar es que
-- aparezca una lista para revisar — no que salgan diez mensajes pagados.
-- Pasar a `automatico` es una segunda decisión, deliberada y por cliente.
alter table ed_clientes
  add column if not exists seguimiento_modo text not null default 'aprobacion'
  check (seguimiento_modo in ('aprobacion', 'automatico'));
comment on column ed_clientes.seguimiento_modo is
  'aprobacion = Beto propone y una persona aprueba en /seguimientos. automatico = se programa solo. Default aprobacion: cada envío cuesta ~$85.';

-- ── La tabla de propuestas ──────────────────────────────────────────────────
create table if not exists ed_propuestas_seguimiento (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references ed_clientes(id)  on delete cascade,
  empleado_id  uuid not null references ed_empleados(id) on delete cascade,
  chat_id      text not null,
  -- Mismo vocabulario que ed_seguimientos.tipo ('cotizacion_sin_respuesta').
  tipo         text not null,

  -- Lo que dijo el juez. Se guarda aunque después se rechace: cada sí/no de
  -- Cecilia contra el veredicto es el único dato que va a decir si el juez
  -- afina o se equivoca. Sin esto, ajustar el prompt es adivinar.
  cotizado     text,
  motivo_juez  text,
  /**
   * Evidencia: los días de espera, el último mensaje, cuántos mensajes leyó el
   * juez, el veredicto crudo. jsonb y no columnas porque esto va a cambiar de
   * forma varias veces antes de estabilizarse, y una migración por cada campo
   * nuevo no vale la pena para algo que solo se muestra en pantalla.
   */
  evidencia    jsonb not null default '{}'::jsonb,

  estado       text not null default 'propuesto'
               check (estado in ('propuesto', 'aprobado', 'rechazado', 'vencido')),
  creado_en    timestamptz not null default now(),
  resuelto_en  timestamptz,
  resuelto_por text,  -- email de quien decidió

  /**
   * UNA PROPUESTA VIVA POR CONVERSACIÓN Y TIPO.
   *
   * Sin esto, cada pasada del generador agregaría otra fila para el mismo chat
   * y Cecilia vería la misma cotización cinco veces. El índice es PARCIAL —solo
   * sobre 'propuesto'— para que el historial de aprobadas y rechazadas se pueda
   * acumular sin chocar.
   */
  -- Una propuesta sin resolver no puede tener fecha de resolución.
  constraint ed_propuestas_estado_valido check (
    estado <> 'propuesto' or resuelto_en is null
  )
);

create unique index if not exists idx_ed_propuestas_viva
  on ed_propuestas_seguimiento (cliente_id, chat_id, tipo)
  where estado = 'propuesto';

-- La consulta de la página: las pendientes de un cliente, más nuevas arriba.
create index if not exists idx_ed_propuestas_pendientes
  on ed_propuestas_seguimiento (cliente_id, creado_en desc)
  where estado = 'propuesto';

-- Para medir si el juez afina: qué se aprobó y qué se rechazó, por fecha.
create index if not exists idx_ed_propuestas_resueltas
  on ed_propuestas_seguimiento (cliente_id, estado, resuelto_en desc);

alter table ed_propuestas_seguimiento enable row level security;
-- Sin políticas a propósito: acá solo entra el servidor con service_role, y el
-- aislamiento por cliente se enforcea en código con el cliente_id de la sesión.
-- Mismo criterio que ed_pagos (auditoría 11-ago-2026).

comment on table ed_propuestas_seguimiento is
  'Lo que Beto PROPONE escribir. Nada sale de acá solo: al aprobar se llama a programarSeguimiento() y recién ahí entra a ed_seguimientos.';

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe devolver: tabla 1 · columna 1 · propuestas 0 · encendidos 0.
select
  (select count(*) from information_schema.tables
     where table_name = 'ed_propuestas_seguimiento')                    as tabla,
  (select count(*) from information_schema.columns
     where table_name = 'ed_clientes' and column_name = 'seguimiento_modo') as columna,
  (select count(*) from ed_propuestas_seguimiento)                      as propuestas,
  (select count(*) from ed_clientes where cotizacion_seguimiento)       as encendidos;
