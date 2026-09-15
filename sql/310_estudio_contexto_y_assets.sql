-- ============================================================================
-- 310 · Estudio Creativo 2.0: contexto comercial y creatividades con asset
--       propio
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA, Y POR QUÉ CADA COSA
--
--   1. `ed_mk_contexto` — lo que Respondo entiende del negocio PARA VENDER:
--      qué vende, a quién, qué problema resuelve, qué oferta tiene vigente,
--      con qué puede respaldar lo que afirma, cómo escribe y qué NO puede
--      afirmar.
--
--      Es una tabla y no un cálculo al vuelo por tres razones, en orden:
--        · para poder MOSTRARLO y CORREGIRLO («lo que Respondo entiende de tu
--          negocio»). Un contexto que se recalcula en cada generación no se
--          puede revisar: la persona corregiría un espejismo, y la corrección
--          se perdería en la siguiente generación;
--        · para no pagar una llamada al modelo por anuncio;
--        · para que dos anuncios del mismo negocio partan del mismo
--          entendimiento.
--
--      `editado` marca que una persona lo corrigió a mano. Con eso en true, la
--      reconstrucción automática NO lo pisa. Una corrección humana vale más que
--      cualquier inferencia nuestra.
--
--      Documento `jsonb` y no seis tablas normalizadas: se lee y se escribe
--      SIEMPRE entero, y la forma va a seguir cambiando. Normalizarlo ahora
--      sería congelar un modelo que todavía se está aprendiendo.
--
--   2. `ed_mk_creatividades.origen` — 'generada' | 'subida' | 'existente'.
--      Una empresa con diseñador propio no puede estar obligada a usar el
--      generador de imágenes. La columna dice de dónde salió la pieza; de ahí
--      en adelante el camino es el MISMO (campaña, vista previa, anuncio), y
--      por eso no hay tres implementaciones paralelas.
--
--   3. `ed_mk_creatividades.texto_manual` — la persona escribió el copy ella
--      misma. Sirve para que ninguna acción automática lo pise y para saber,
--      al medir, qué escribió la máquina y qué escribió una persona.
--
--   4. `ed_mk_creatividades.estrategia` — la estrategia con la que se escribió
--      (audiencia, situación, ángulo, promesa, prueba usada, CTA) y el
--      resultado de la revisión de calidad. Es lo que permite variar un
--      anuncio «por otro ángulo» sin volver a empezar, y auditar después por
--      qué se dijo lo que se dijo.
--
--   5. `ed_mk_creatividades.plataforma` acepta `google`. Google Search no es
--      un anuncio de Meta recortado: tiene titulares y descripciones con otros
--      límites y otra intención. **Los valores viejos se conservan.**
--
-- ⚠️ LO QUE NO AGREGA: ningún bucket nuevo. Las piezas que suba la persona van
-- al bucket privado `creatividades` que ya existe, servidas por
-- `/api/marketing/imagen`, que exige sesión y comprueba el negocio. No se
-- vuelve público ningún asset.
--
-- NO ES BLOQUEANTE. Sin esta migración:
--   · el contexto comercial se arma en memoria y funciona, pero no se puede
--     guardar ni corregir (la pantalla lo dice);
--   · se puede generar y guardar copy e imagen como hasta ahora;
--   · no se puede subir un diseño propio ni guardar la estrategia.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1. Lo que entendemos del negocio, para vender ───────────────────────────
create table if not exists ed_mk_contexto (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,
  documento      jsonb not null,
  editado        boolean not null default false,
  actualizado_en timestamptz not null default now(),
  creado_en      timestamptz not null default now()
);

-- Uno por negocio: el contexto es del negocio, no del anuncio.
create unique index if not exists ed_mk_contexto_cliente_uk on ed_mk_contexto(cliente_id);

comment on table  ed_mk_contexto is
  'Contexto COMERCIAL del negocio (qué vende, a quién, oferta, pruebas, voz, qué no afirmar). Distinto del conocimiento operativo de ed_conocimiento, que existe para contestar, no para vender.';
comment on column ed_mk_contexto.editado is
  'Lo corrigió una persona: la reconstrucción automática no lo pisa.';

-- Mismo patrón que el resto del módulo: deny-all para anon/authenticated.
-- El portal entra con service_role, que no evalúa policies; el aislamiento
-- real lo hace lib/marketing/tenant.ts. Agregar una policy acá la volvería
-- MENOS restrictiva, no más.
alter table ed_mk_contexto enable row level security;

-- ── 2. De dónde salió la pieza, y quién escribió el texto ───────────────────
alter table ed_mk_creatividades add column if not exists origen text not null default 'generada';
alter table ed_mk_creatividades add column if not exists texto_manual boolean not null default false;
alter table ed_mk_creatividades add column if not exists estrategia jsonb;

do $$
begin
  alter table ed_mk_creatividades drop constraint if exists ed_mk_creatividades_origen_check;
  alter table ed_mk_creatividades add constraint ed_mk_creatividades_origen_check
    check (origen in ('generada','subida','existente'));
exception
  when others then raise notice 'No se pudo crear el check de origen: %', sqlerrm;
end $$;

comment on column ed_mk_creatividades.origen is
  'generada = la hizo el modelo · subida = la subió el negocio · existente = se reutilizó otra pieza. Aguas abajo las tres se comportan igual.';
comment on column ed_mk_creatividades.texto_manual is
  'El copy lo escribió una persona: ninguna acción automática lo reemplaza.';
comment on column ed_mk_creatividades.estrategia is
  'Estrategia con la que se escribió (audiencia, situación, ángulo, promesa, prueba, CTA) y el resultado de la revisión de calidad.';

-- ── 3. Google como plataforma de una creatividad ────────────────────────────
-- Se recrea el check CONSERVANDO los valores anteriores: ninguna fila
-- existente queda inválida y por eso no hace falta migrar datos.
do $$
begin
  alter table ed_mk_creatividades drop constraint if exists ed_mk_creatividades_plataforma_check;
  alter table ed_mk_creatividades add constraint ed_mk_creatividades_plataforma_check
    check (plataforma in ('instagram','facebook','ambas','google'));
exception
  when others then raise notice 'No se pudo recrear el check de plataforma: %', sqlerrm;
end $$;

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
     where table_name = 'ed_mk_contexto')                                    as contexto,
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_creatividades' and column_name = 'origen')    as origen,
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_creatividades' and column_name = 'estrategia') as estrategia,
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_creatividades' and column_name = 'texto_manual') as texto_manual;
