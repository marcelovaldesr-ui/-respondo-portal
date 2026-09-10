-- ============================================================================
-- 298 · Isabel: bitácora de lo que el dueño le pregunta a su propio negocio
-- ----------------------------------------------------------------------------
-- QUÉ ES: Isabel es la empleada que trabaja HACIA ADENTRO. No habla con los
-- clientes finales: el dueño le pregunta cosas sobre su negocio ("¿alguien
-- reclamó esta semana?", "¿qué cotización quedó sin respuesta?") y ella
-- responde leyendo las fichas cargadas y el historial real de mensajes.
--
-- Esta tabla guarda esas preguntas y respuestas. Tres razones, en orden de
-- importancia:
--
--   1. Que la pantalla no arranque en blanco. Quien entra y ve un campo vacío
--      no sabe qué preguntar; quien ve lo que preguntó la semana pasada, sí.
--   2. Que se pueda volver a leer una respuesta sin volver a pagarla. Cada
--      consulta cuesta una llamada larga al modelo.
--   3. Que sepamos qué le preguntan de verdad. Es la lista de funciones que
--      el producto todavía no tiene, escrita por los propios clientes.
--
-- ⚠️ LO QUE ESTA TABLA **NO** ES: no es una copia de las conversaciones. Guarda
-- la pregunta del dueño y la respuesta de Isabel, que puede incluir alguna cita
-- textual de un cliente. El historial completo sigue viviendo en ed_mensajes.
--
-- NO ES BLOQUEANTE. El código la trata como opcional: si esta migración no está
-- aplicada, Isabel responde igual y simplemente no recuerda. Misma regla que la
-- atribución de campaña con la 282.
--
-- Aditiva e idempotente. Segura de aplicar antes o después del deploy.
-- APLICAR EN SUPABASE (SQL editor).
-- ============================================================================

create table if not exists ed_isabel_consultas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  -- Lo que escribió el dueño. Acotado en el código a 400 caracteres.
  pregunta        text not null,
  -- { respuesta, apoyos[], seguridad }. JSON para poder cambiarle la forma sin
  -- migrar de nuevo, igual que el contenido de ed_insights.
  respuesta       jsonb not null,
  modelo          text,
  -- Trazabilidad de la respuesta: sobre cuánto historial se contestó, y si se
  -- llegó ahí buscando por palabra o mostrando lo más reciente. Sirve para
  -- entender una respuesta mala sin tener que reproducirla.
  mensajes_leidos int not null default 0,
  por_busqueda    boolean not null default false,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_ed_isabel_consultas_cliente
  on ed_isabel_consultas (cliente_id, creado_en desc);

-- Segunda barrera (mismo criterio que 202_rls.sql y 230_insights.sql): nadie
-- entra con la llave pública; el portal usa la llave secreta en el servidor.
alter table ed_isabel_consultas enable row level security;

comment on table ed_isabel_consultas is
  'Preguntas del dueño a Isabel y sus respuestas. Opcional: sin esta tabla Isabel responde igual, solo no recuerda.';
comment on column ed_isabel_consultas.respuesta is
  'JSON: { "respuesta": texto, "apoyos": [hechos concretos], "seguridad": "alta|media|no_se" }.';
comment on column ed_isabel_consultas.por_busqueda is
  'true = se encontraron conversaciones por palabra; false = se le mostró lo más reciente del período.';

-- Verificación rápida después de aplicar.
select
  (select count(*) from information_schema.tables
    where table_name = 'ed_isabel_consultas') as tabla_creada;
