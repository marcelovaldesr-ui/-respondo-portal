-- ============================================================================
-- 312 · Personalización Profunda de Marketing por Negocio V1
-- ----------------------------------------------------------------------------
-- QUÉ AGREGA Y POR QUÉ:
--
--   1. Invalidation & Stale Tracking en `ed_mk_contexto`:
--      - `stale` (boolean): indica que las fichas de conocimiento o la
--        identidad del negocio cambiaron después del último cálculo del perfil.
--        Permite la reconstrucción Just-In-Time conservando correcciones humanas.
--      - `stale_motivo` (text): trazabilidad de la causa de invalidación.
--      - `fichas_hash` (text): huella digital de las fichas vigentes usadas
--        para detectar cambios sin depender exclusivamente de relojes de sistema.
--
--   2. Índice sobre `(cliente_id, stale)`:
--      - Permite resolver al vuelo si el contexto de un negocio requiere
--        reconstrucción inmediata al entrar al Estudio Creativo o Arquitecto.
--
--   3. Compatible hacia atrás:
--      - El documento completo `PerfilNegocioMarketing` (business, brand,
--        commercial, marketing) se serializa en la columna `documento` (jsonb)
--        que ya existe desde la 310, garantizando que el portal funcione antes
--        y después de aplicar esta migración sin downtime ni bloqueos.
--
-- Aditiva e idempotente. APLICAR EN SUPABASE (SQL editor, pestaña nueva con +).
-- ============================================================================

-- ── 1. Columnas de invalidación en ed_mk_contexto ───────────────────────────
alter table ed_mk_contexto add column if not exists stale boolean not null default false;
alter table ed_mk_contexto add column if not exists stale_motivo text;
alter table ed_mk_contexto add column if not exists fichas_hash text;

comment on column ed_mk_contexto.stale is
  'true cuando el conocimiento operativo cambió y el perfil de marketing necesita reconstrucción JIT conservando correcciones humanas.';
comment on column ed_mk_contexto.stale_motivo is
  'Causa de la invalidación (ej. fichas modificadas, cambio manual de rubro, etc.).';
comment on column ed_mk_contexto.fichas_hash is
  'Huella determinista de las fichas de conocimiento con las que se ensambló el perfil.';

-- ── 2. Índice de consulta rápida de vigencia ────────────────────────────────
create index if not exists ed_mk_contexto_cliente_stale_idx
  on ed_mk_contexto (cliente_id, stale);
