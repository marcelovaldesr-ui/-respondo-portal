-- ============================================================================
-- 283 · SUSCRIPCIONES A NOTIFICACIONES PUSH
-- ============================================================================
--
-- Guarda a qué teléfono/navegador hay que avisarle cuando un cliente necesita
-- a una persona del negocio.
--
-- QUÉ ES UNA "SUSCRIPCIÓN"
-- Cuando alguien acepta las notificaciones, el navegador devuelve tres datos:
-- un `endpoint` (una URL del servicio de push de Google o Apple, única para ese
-- navegador en ese teléfono) y dos llaves (`p256dh` y `auth`) con las que se
-- cifra el contenido del aviso. Sin esas llaves, el servicio de push entrega un
-- sobre vacío.
--
-- SE GUARDA POR (cliente_id, email, endpoint):
--   - `cliente_id` porque el aviso es sobre conversaciones de ESE negocio, y es
--     la barrera de aislamiento de siempre.
--   - `email` porque una persona puede tener varios dispositivos y hay que poder
--     dar de baja los suyos sin tocar los de un compañero.
--   - `endpoint` es lo único realmente único: el mismo teléfono reinstalando la
--     app genera uno nuevo.
--
-- ⚠️ SE PUEDE APLICAR ANTES O DESPUÉS DEL DESPLIEGUE. El código trata la tabla
-- como opcional: si no existe, el portal no ofrece notificaciones y todo lo
-- demás sigue igual. No es como la 279, donde el código NECESITABA la columna.

create table if not exists ed_push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references ed_clientes(id) on delete cascade,
  email text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  -- Para saber desde qué aparato es, sin guardar nada identificatorio de más.
  agente text,
  creado_en timestamptz not null default now(),
  -- Se toca en cada envío exitoso: sirve para limpiar las que murieron.
  visto_en timestamptz not null default now()
);

-- Un endpoint es único en el mundo: si el mismo navegador se vuelve a
-- suscribir, se actualizan sus llaves en vez de duplicar la fila.
create unique index if not exists uq_ed_push_endpoint
  on ed_push_suscripciones (endpoint);

-- El envío pregunta siempre "¿a quién le aviso de este cliente?".
create index if not exists idx_ed_push_cliente
  on ed_push_suscripciones (cliente_id);

comment on table ed_push_suscripciones is
  'Dispositivos que reciben avisos del portal. Se borra solo cuando el servicio de push responde 404/410 (suscripción muerta).';
