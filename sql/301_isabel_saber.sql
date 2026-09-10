-- ============================================================================
-- 301 · Isabel: lo que aprende sola de las conversaciones, y no se le olvida
-- ----------------------------------------------------------------------------
-- EL PROBLEMA QUE RESUELVE
-- Hoy Isabel relee mensajes crudos en cada pregunta y olvida todo al terminar.
-- Puede contarte QUÉ pasó, pero no SABE nada del negocio: cada consulta arranca
-- de cero, como alguien que entra al archivador por primera vez todos los días.
--
-- Esta tabla es su memoria de largo plazo. Un proceso nocturno lee las
-- conversaciones del día y las convierte en HECHOS DURABLES: cómo llama la
-- gente a los productos, qué objeción aparece siempre, qué precios se dijeron,
-- qué no supo contestar el asistente. Isabel lee esto ANTES que el historial
-- crudo, y el historial solo cuando hace falta el detalle.
--
-- ⭐ LA DIFERENCIA CON `ed_insights`
-- El informe semanal es EPISÓDICO: «qué pasó esta semana, qué hacer el lunes».
-- Se lee una vez y envejece. Esto es ACUMULATIVO: «esto es verdad de este
-- negocio», y cada vez que vuelve a observarse se refuerza en vez de repetirse.
--
-- ⭐ POR QUÉ `veces` ES LA COLUMNA MÁS IMPORTANTE
-- Un hecho visto una vez es una anécdota; visto catorce veces es un patrón.
-- Sin este contador, el destilado sería una pila de frases sueltas donde «un
-- cliente preguntó por delivery» pesa igual que «todos preguntan por delivery».
-- La fusión se hace por `clave` —una etiqueta corta y estable que devuelve el
-- propio modelo— para no depender de embeddings ni de comparar textos largos.
--
-- ⚠️ ESTO NO REEMPLAZA LAS FICHAS DE INFORMACIÓN. Una ficha es conocimiento que
-- el negocio DECLARA y que Tino usa para contestarle a los clientes. Esto es lo
-- que se OBSERVA en las conversaciones, que es distinto y a veces incómodo: que
-- la gente pida algo que el negocio no vende también es un hecho.
--
-- NO ES BLOQUEANTE: sin esta migración Isabel responde igual, solo sin memoria
-- acumulada. Misma regla que la 282, 298, 299 y 300.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

create table if not exists ed_isabel_saber (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references ed_clientes(id) on delete cascade,
  -- Qué clase de hecho es. Acotado a propósito: sin la lista, el modelo
  -- inventa categorías nuevas cada noche y el saber deja de poder agruparse.
  tipo        text not null check (tipo in (
                'piden',      -- qué piden y con qué palabras lo piden
                'objecion',   -- qué frena la compra
                'falla',      -- qué no supo contestar el asistente
                'precio',     -- precios que se dijeron en la conversación
                'costumbre'   -- cómo opera este negocio en la práctica
              )),
  -- Etiqueta corta y estable (2-4 palabras, sin acentos): la llave de fusión.
  clave       text not null,
  -- El hecho en una frase, en las palabras que usa la gente.
  texto       text not null,
  -- Cuántas noches distintas se volvió a observar. Un hecho de 1 es anécdota.
  veces       int  not null default 1,
  primera_vez date not null default (now() at time zone 'America/Santiago')::date,
  ultima_vez  date not null default (now() at time zone 'America/Santiago')::date,
  -- Se apaga en vez de borrarse: un hecho que dejó de ser cierto explica
  -- respuestas viejas de Isabel.
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  -- La llave de fusión. Sin esto, cada noche insertaría el mismo hecho de nuevo.
  unique (cliente_id, tipo, clave)
);

create index if not exists idx_ed_isabel_saber_cliente
  on ed_isabel_saber (cliente_id, veces desc, ultima_vez desc)
  where activo;

alter table ed_isabel_saber enable row level security;

comment on table ed_isabel_saber is
  'Memoria de largo plazo de Isabel: hechos durables destilados de las conversaciones, con cuántas veces se observó cada uno.';
comment on column ed_isabel_saber.clave is
  'Etiqueta corta y estable (2-4 palabras, sin acentos). Es la llave de fusión: mismo tipo + misma clave = el mismo hecho, se suma veces.';
comment on column ed_isabel_saber.veces is
  'Noches distintas en que volvió a observarse. 1 = anécdota; muchas = patrón del negocio.';

-- ── Bitácora de corridas ────────────────────────────────────────────────────
-- Sin esto no hay forma de saber si el destilado corrió anoche, ni de evitar
-- repetir el mismo día dos veces. Es la misma idea que `unique (cliente_id,
-- periodo_desde)` en ed_insights: idempotencia por día.
create table if not exists ed_isabel_destilados (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,
  dia            date not null,
  hechos_nuevos  int not null default 0,
  hechos_vistos  int not null default 0,
  mensajes       int not null default 0,
  modelo         text,
  creado_en      timestamptz not null default now(),
  unique (cliente_id, dia)
);

alter table ed_isabel_destilados enable row level security;

comment on table ed_isabel_destilados is
  'Una fila por cliente y día destilado. Su llave única es lo que hace idempotente al proceso nocturno.';

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables where table_name = 'ed_isabel_saber')      as saber,
  (select count(*) from information_schema.tables where table_name = 'ed_isabel_destilados') as bitacora;
