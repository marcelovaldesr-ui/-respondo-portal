-- ============================================================================
-- 299 · Isabel: búsqueda en el historial por relevancia, no por «contiene»
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
-- Isabel busca en `ed_mensajes` con `ilike '%palabra%'`. Eso tiene tres fallas
-- que se notan a la primera pregunta de verdad:
--
--   1. NO ENTIENDE VARIANTES. «cotización» no encuentra «cotizaciones», ni
--      «pendones» encuentra «pendón». La gente no escribe la palabra exacta.
--   2. NO ORDENA. Devuelve lo que calce, en el orden que salga; una mención de
--      pasada pesa lo mismo que una conversación entera sobre el tema.
--   3. LEE LA TABLA ENTERA. `ilike '%x%'` no usa índice: cada búsqueda recorre
--      todos los mensajes del negocio. Hoy no duele; con un cliente grande sí.
--
-- LA SOLUCIÓN: búsqueda de texto completo de Postgres, en español, sin acentos,
-- ordenada por `ts_rank`. El diccionario español reduce «cotizaciones» y
-- «cotización» a la misma raíz, así que las dos formas se encuentran solas.
--
-- ⭐ POR QUÉ UN ÍNDICE DE EXPRESIÓN Y NO UNA COLUMNA GENERADA
-- La forma habitual es agregar una columna `tsvector GENERATED ALWAYS AS ...
-- STORED`. Acá NO se hace, por dos razones concretas:
--   · Agregar esa columna REESCRIBE la tabla entera y la bloquea mientras dura.
--     `ed_mensajes` es la tabla más caliente del sistema: por ahí entra cada
--     mensaje de WhatsApp. Un índice de expresión no reescribe nada.
--   · Ocupa el doble: la columna guarda el tsvector Y el índice lo indexa.
--     Con el índice solo, se paga una vez. **Supabase Free topea en 500 MB**
--     (ver la ficha de infraestructura) y esta es la tabla que más crece.
-- El costo de la expresión-índice es que la consulta debe repetir la MISMA
-- expresión, palabra por palabra, o Postgres no usa el índice. Está escrita una
-- sola vez, dentro de la función de abajo, justamente por eso.
--
-- ⚠️ AL APLICAR: construir el índice toma unos segundos y toma un lock de
-- escritura sobre `ed_mensajes` mientras dura. Hacerlo en un rato tranquilo, no
-- a las 12 del día. En un negocio con decenas de miles de mensajes es cosa de
-- segundos; si algún día pesara, se cambia por `create index concurrently`
-- fuera de la transacción.
--
-- NO ES BLOQUEANTE. `lib/isabel.ts` llama a esta función y, si no existe o
-- falla, cae solo al `ilike` de antes. Isabel funciona igual sin esta migración;
-- simplemente encuentra peor. Misma regla que la 282 y la 298.
--
-- Depende de `public.ed_sin_acentos(text)`, creada en la migración 293.
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

begin;

-- ── El índice ───────────────────────────────────────────────────────────────
-- 'spanish' explícito (no `default`): con la configuración por defecto la
-- expresión deja de ser inmutable y no se puede indexar.
create index if not exists idx_ed_mensajes_texto_busqueda
  on public.ed_mensajes
  using gin (to_tsvector('spanish', public.ed_sin_acentos(texto)));

comment on index public.idx_ed_mensajes_texto_busqueda is
  'Búsqueda de texto completo en español para Isabel. La consulta DEBE repetir la misma expresión o no se usa el índice.';

-- ── La búsqueda ─────────────────────────────────────────────────────────────
/**
 * Devuelve las CONVERSACIONES más relevantes para una pregunta, no los mensajes
 * sueltos: Isabel lee conversaciones completas, así que lo que necesita es a
 * cuáles entrar.
 *
 * `websearch_to_tsquery` en vez de `plainto_tsquery` porque entiende lo que la
 * gente ya sabe escribir de buscar en Google: comillas para una frase exacta,
 * `or`, y un `-` para excluir. No hay que enseñarle nada a nadie.
 *
 * El filtro por cliente pasa por `ed_empleados`: `ed_mensajes` no tiene
 * `cliente_id` (cuelga del empleado). Es la misma regla de aislamiento que usa
 * el resto del portal, y va DENTRO de la función para que no se pueda olvidar
 * desde afuera.
 */
create or replace function public.ed_buscar_mensajes_isabel(
  p_cliente_id uuid,
  p_consulta   text,
  p_limite     integer default 12
)
returns table (
  chat_id     text,
  relevancia  real,
  ultimo      timestamptz,
  aciertos    bigint
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with q as (
    select websearch_to_tsquery('spanish', public.ed_sin_acentos(coalesce(p_consulta, ''))) as tsq
  ),
  emp as (
    select id from public.ed_empleados where cliente_id = p_cliente_id
  )
  select
    m.chat_id,
    max(ts_rank(to_tsvector('spanish', public.ed_sin_acentos(m.texto)), q.tsq))::real as relevancia,
    max(m.creado_en) as ultimo,
    count(*)         as aciertos
  from public.ed_mensajes m
  cross join q
  where m.empleado_id in (select id from emp)
    and q.tsq is not null
    and to_tsvector('spanish', public.ed_sin_acentos(m.texto)) @@ q.tsq
  group by m.chat_id
  -- Relevancia primero; a igual relevancia, lo más reciente. Un empate por
  -- relevancia es común (dos conversaciones que dicen lo mismo), y ahí lo que
  -- el dueño quiere ver es lo de esta semana, no lo de marzo.
  order by relevancia desc, ultimo desc
  limit greatest(1, least(coalesce(p_limite, 12), 50));
$$;

comment on function public.ed_buscar_mensajes_isabel(uuid, text, integer) is
  'Conversaciones más relevantes para una pregunta, por búsqueda de texto completo en español. Aisla por cliente vía ed_empleados.';

revoke all on function public.ed_buscar_mensajes_isabel(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.ed_buscar_mensajes_isabel(uuid, text, integer) to service_role;

commit;

-- ── Verificación ────────────────────────────────────────────────────────────
-- La primera línea tiene que devolver algo parecido a 'cotiz':'1' — o sea, que
-- el diccionario español está reduciendo la palabra a su raíz. Si devolviera
-- 'cotizaciones':'1' tal cual, la configuración no se aplicó y «cotización» no
-- encontraría «cotizaciones».
select
  to_tsvector('spanish', public.ed_sin_acentos('Las cotizaciones de los pendones')) as raices,
  websearch_to_tsquery('spanish', public.ed_sin_acentos('cotización pendón'))       as consulta,
  (select count(*) from pg_indexes where indexname = 'idx_ed_mensajes_texto_busqueda') as indice,
  (select count(*) from pg_proc where proname = 'ed_buscar_mensajes_isabel')           as funcion;
