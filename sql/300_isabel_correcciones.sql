-- ============================================================================
-- 300 · Isabel: lo que el dueño le corrige queda para siempre
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- Isabel se va a equivocar. Va a contar como venta algo que el negocio no
-- considera venta, va a mencionar un local que cerró, va a interpretar una
-- palabra del rubro como la entiende un diccionario y no como la usa el
-- cliente. Hoy, cuando eso pasa, el dueño se queda con la sensación de que «no
-- entiende» y deja de preguntarle. No hay forma de arreglarlo.
--
-- Esta tabla es esa forma: el dueño escribe cómo era en realidad, y esa
-- corrección entra en la cabeza de Isabel desde la próxima pregunta y para
-- siempre. Es el mismo patrón que `ed_correcciones` le dio a Tino, y por la
-- misma razón: **lo que hace bueno a un empleado no es cuánto sabe el primer
-- día, es que lo corrijas una vez y no se le olvide.**
--
-- ⚠️ CUELGA DE `cliente_id`, NO DE `empleado_id`
-- A diferencia de `ed_correcciones` (que cuelga del empleado porque Tino, Beto
-- y Vera son filas de `ed_empleados`), Isabel NO es una fila de esa tabla: no
-- tiene prompt en el motor y no habla con ningún cliente final. Es una
-- capacidad del portal. Colgarla de un empleado sería mentir sobre el modelo de
-- datos para reusar una tabla.
--
-- LO QUE ESTO **NO** ES: no reemplaza a las fichas de Información. Una ficha es
-- conocimiento del negocio y la lee TINO para contestarle a los clientes; una
-- corrección de Isabel es cómo debe leer ELLA lo que ya existe. Si el dueño
-- escribe acá algo que sus clientes también deberían saber, va a Información
-- además, no en vez de.
--
-- NO ES BLOQUEANTE: sin esta migración Isabel responde igual, simplemente no se
-- la puede corregir. Misma regla que la 282, la 298 y la 299.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

create table if not exists ed_isabel_correcciones (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references ed_clientes(id) on delete cascade,
  -- Sobre qué se equivocó. Suele ser la pregunta tal como la escribió el dueño.
  pregunta          text not null,
  -- Cómo era en realidad, en las palabras del dueño. Esto es lo que Isabel lee.
  respuesta_correcta text not null,
  -- Se desactiva en vez de borrarse: una corrección vieja explica por qué
  -- Isabel respondía distinto hace un mes, y eso vale al depurar.
  activa            boolean not null default true,
  creado_por        text,          -- email de quien corrigió
  creado_en         timestamptz not null default now()
);

create index if not exists idx_ed_isabel_correcciones_cliente
  on ed_isabel_correcciones (cliente_id, creado_en desc)
  where activa;

-- Segunda barrera (mismo criterio que 202_rls.sql): nadie entra con la llave
-- pública; el portal usa la llave secreta en el servidor.
alter table ed_isabel_correcciones enable row level security;

comment on table ed_isabel_correcciones is
  'Correcciones del dueño a Isabel. Mandan por sobre cualquier otra fuente. Opcional: sin esta tabla Isabel responde igual, solo no se la puede corregir.';
comment on column ed_isabel_correcciones.respuesta_correcta is
  'Cómo era en realidad, en palabras del dueño. Entra al prompt de Isabel con prioridad sobre los datos.';
comment on column ed_isabel_correcciones.activa is
  'false = ya no aplica. No se borra: sirve para entender respuestas viejas.';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_name = 'ed_isabel_correcciones') as tabla_creada;
