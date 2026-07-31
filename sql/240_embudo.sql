-- ============================================================================
-- 240_embudo.sql · Etapa de la conversación (embudo)
-- ----------------------------------------------------------------------------
-- QUÉ ES: cada conversación pasa por etapas (llegó → interesado → cotizado →
-- ganado/perdido). Hoy el portal muestra etiquetas, que dicen QUÉ es la
-- conversación pero no EN QUÉ VA. El embudo responde la pregunta que un dueño
-- se hace todos los días: "¿cuánto tengo por cerrar y qué está frenado?".
--
-- POR QUÉ EN ed_contactos Y NO EN UNA TABLA NUEVA: la etapa es un atributo del
-- contacto, uno solo por conversación. Una tabla aparte obligaría a un join en
-- cada listado sin aportar nada.
--
-- etapa_manual: cuando una persona mueve la tarjeta a mano, el cálculo
-- automático NO la vuelve a pisar. Sin esta bandera, el bot desharía el criterio
-- del dueño en el siguiente mensaje — el error clásico de estos tableros.
--
-- Aditiva e idempotente. Default 'nuevo' = comportamiento neutro.
-- APLICAR EN SUPABASE (SQL editor).
-- ============================================================================

alter table ed_contactos
  add column if not exists etapa text not null default 'nuevo';

alter table ed_contactos
  add column if not exists etapa_manual boolean not null default false;

alter table ed_contactos
  add column if not exists etapa_en timestamptz;

alter table ed_contactos drop constraint if exists ed_contactos_etapa_check;
alter table ed_contactos add constraint ed_contactos_etapa_check
  check (etapa in ('nuevo', 'interesado', 'cotizado', 'ganado', 'perdido'));

-- Listado del embudo: por cliente y etapa.
create index if not exists idx_ed_contactos_cliente_etapa
  on ed_contactos (cliente_id, etapa);

comment on column ed_contactos.etapa is
  'Etapa en el embudo: nuevo | interesado | cotizado | ganado | perdido.';
comment on column ed_contactos.etapa_manual is
  'true si una persona la fijó a mano; el cálculo automático deja de tocarla.';
