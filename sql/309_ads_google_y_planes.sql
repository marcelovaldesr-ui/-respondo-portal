-- ============================================================================
-- 309 · Marketing Fase 6: segundo canal publicitario (Google Ads) y planes de
--       campaña del Arquitecto
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA, Y POR QUÉ CADA COSA
--
--   1. `ed_ads_conexion.cuenta_padre_id` — la cuenta ADMINISTRADORA por la que
--      hay que entrar para leer una cuenta de Google (`login-customer-id`).
--      Sin este dato, una cuenta que cuelga de un MCC responde
--      «USER_PERMISSION_DENIED» aunque los permisos estén perfectos, y el
--      mensaje manda a revisar lo que no es. Meta no lo usa y queda nulo.
--
--   2. `ed_mk_campanas.canal` + `ed_mk_campanas.plan` — un borrador dejó de ser
--      «una campaña de Meta»: el Arquitecto produce un PLAN que puede tener
--      campañas en dos plataformas, grupos, palabras clave, ángulos creativos,
--      tracking e hipótesis. Eso no cabe en las columnas planas que ya existen
--      y tampoco tiene sentido normalizarlo en seis tablas: se guarda como
--      documento porque se lee y se escribe SIEMPRE entero.
--
--   3. `ed_mk_campanas.estado` acepta `requiere_conexion` — el estado
--      `requiere_meta` nombraba a un proveedor cuando solo había uno. Un plan
--      de Google que espera conexión no puede decir «requiere Meta».
--      **Los valores viejos se conservan**: filas existentes siguen válidas.
--
-- ⚠️ LO QUE NO AGREGA, Y SIGUE SIENDO LA MISMA DECISIÓN DE LA 302 Y LA 303:
-- no hay tablas de campañas, grupos, anuncios, palabras clave ni métricas
-- diarias de las plataformas. Meta y Google ya guardan esa historia y la
-- sirven por API con el rango que se les pida; duplicarla obliga a
-- sincronizarla para siempre y **Supabase Free topea en 500 MB**. Si algún día
-- hace falta caché será por lentitud MEDIDA, no por si acaso.
--
-- NO ES BLOQUEANTE. Sin esta migración:
--   · Google Ads se puede conectar igual, salvo cuentas que cuelguen de un MCC
--     (el código reintenta sin la columna y la pantalla lo dice).
--   · El Arquitecto arma el plan y lo muestra, pero no lo puede GUARDAR.
-- El resto de Marketing funciona exactamente igual que hoy.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1. Por dónde se entra a la cuenta ───────────────────────────────────────
alter table ed_ads_conexion add column if not exists cuenta_padre_id text;

comment on column ed_ads_conexion.cuenta_padre_id is
  'Google Ads: cuenta administradora (MCC) por la que se entra, para el encabezado login-customer-id. Nulo en Meta y en cuentas sueltas.';

-- Un lugar para lo específico de cada proveedor que no merece una columna.
alter table ed_ads_conexion add column if not exists datos jsonb not null default '{}'::jsonb;

comment on column ed_ads_conexion.datos is
  'Detalles propios del proveedor (nunca secretos: el token va en token_cifrado).';

-- ── 2. El plan del Arquitecto ───────────────────────────────────────────────
alter table ed_mk_campanas add column if not exists canal text not null default 'meta';
alter table ed_mk_campanas add column if not exists plan jsonb;

comment on column ed_mk_campanas.canal is
  'meta | google | ambos. Qué plataformas contempla el plan.';
comment on column ed_mk_campanas.plan is
  'Plan completo del Arquitecto: estrategia de canal, campañas, audiencias, palabras clave, ángulos creativos, tracking e hipótesis. Documento porque se lee y escribe entero.';

-- ── 3. El estado deja de nombrar a un proveedor ─────────────────────────────
-- Se reemplaza el check conservando TODOS los valores anteriores: ninguna fila
-- existente queda inválida, y por eso no hace falta migrar datos.
do $$
begin
  alter table ed_mk_campanas drop constraint if exists ed_mk_campanas_estado_check;
  alter table ed_mk_campanas add constraint ed_mk_campanas_estado_check
    check (estado in ('borrador','lista','requiere_meta','requiere_conexion','requiere_permiso','publicada'));
exception
  when others then
    raise notice 'No se pudo recrear el check de estado: %', sqlerrm;
end $$;

-- ⭐ `publicada` SIGUE sin escribirse a mano desde ninguna parte. Respondo no
-- publica campañas por API (ni en Meta ni en Google) y esa es una decisión de
-- producto, no una limitación temporal: el estado está reservado para el día
-- que exista una publicación real que lo escriba.

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
     where table_name = 'ed_ads_conexion' and column_name = 'cuenta_padre_id') as cuenta_padre,
  (select count(*) from information_schema.columns
     where table_name = 'ed_ads_conexion' and column_name = 'datos')           as datos,
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_campanas' and column_name = 'plan')             as plan,
  (select count(*) from information_schema.columns
     where table_name = 'ed_mk_campanas' and column_name = 'canal')            as canal;
