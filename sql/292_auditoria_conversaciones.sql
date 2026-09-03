-- ============================================================================
-- 292 · AUDITORÍA DE CONVERSACIONES (3-sep-2026) — base
-- ============================================================================
--
-- Cuatro cosas chicas que salieron de auditar la sección Conversaciones de
-- punta a punta. Todas aditivas; el código funciona sin ellas (degrada solo).
--
-- 1. `ed_mensajes.estado_envio_detalle`: por qué falló un envío. Meta manda el
--    código (131047 = fuera de las 24 h → hay que usar plantilla; 131026 = el
--    número no puede recibir) y hasta hoy se tiraba: el inbox mostraba un ⚠
--    «No se pudo entregar» sin decir qué hacer.
--
-- 2. Índice del vigilante: la migración 284 lo creó parcial con
--    `reingreso_en is null`, y desde el 2-sep el barrido ya no filtra por eso
--    (revisa "una vez por episodio"), así que el planificador no lo usaba.
--
-- 3. `ed_push_suscripciones` con RLS explícito. Los grants del proyecto ya
--    niegan `anon` (verificado el 3-sep: «permission denied»), pero era la
--    ÚNICA tabla del repo sin `enable row level security`, y esa excepción
--    dependía de una configuración externa al repo. Ahora es como las demás.
--
-- 4. `ed_contar_conversaciones` (278) quedó ejecutable por anon/authenticated
--    en /rest/v1/rpc; devuelve 0 por RLS, pero no tiene por qué estar expuesta.
-- ============================================================================

alter table ed_mensajes
  add column if not exists estado_envio_detalle text;
comment on column ed_mensajes.estado_envio_detalle is
  'Solo con estado_envio = error: código y texto que devolvió el proveedor (ej. "131047: Re-engagement message").';

drop index if exists idx_ed_chat_estado_reingreso;
create index if not exists idx_ed_chat_estado_reingreso
  on ed_chat_estado (modo, reingreso_bloqueado, ultimo_entrante_en)
  where modo = 'humano';

alter table ed_push_suscripciones enable row level security;
revoke all on ed_push_suscripciones from anon, authenticated;

revoke all on function public.ed_contar_conversaciones(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_name = 'ed_mensajes' and column_name = 'estado_envio_detalle') as col_detalle,
  (select rowsecurity from pg_tables where tablename = 'ed_push_suscripciones') as rls_push,
  (select count(*) from pg_indexes where indexname = 'idx_ed_chat_estado_reingreso') as idx_vigilante;
