-- ============================================================================
-- 230_insights.sql · Informes semanales generados con IA
-- ----------------------------------------------------------------------------
-- QUÉ ES: guarda el análisis semanal de las conversaciones de cada cliente
-- (resumen ejecutivo, qué piden, problemas, oportunidades, categorías).
--
-- POR QUÉ UNA TABLA Y NO CALCULARLO AL VUELO: generar el informe cuesta una
-- llamada al modelo con cientos de mensajes de contexto. Si se recalculara en
-- cada visita a la página, sería lento y caro. Se genera UNA vez por semana
-- (o cuando se pide a mano) y se guarda.
--
-- Aditiva e idempotente: no toca ninguna tabla existente. Segura de aplicar.
-- APLICAR EN SUPABASE (SQL editor).
-- ============================================================================

create table if not exists ed_insights (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references ed_clientes(id) on delete cascade,
  -- Semana analizada (lunes de esa semana, en hora de Chile).
  periodo_desde date not null,
  periodo_hasta date not null,
  -- Contenido del informe. JSON para poder evolucionar el formato sin migrar:
  -- { resumen, piden[], problemas[], oportunidades[], fortalezas[],
  --   categorias[{nombre,tickets,descripcion}], metricas{...} }
  contenido     jsonb not null,
  -- Trazabilidad: cuántas conversaciones/mensajes se analizaron y con qué modelo.
  conversaciones int not null default 0,
  mensajes       int not null default 0,
  modelo         text,
  creado_en     timestamptz not null default now(),
  unique (cliente_id, periodo_desde)
);

create index if not exists idx_ed_insights_cliente
  on ed_insights (cliente_id, periodo_desde desc);

-- Segunda barrera (mismo criterio que 202_rls.sql): nadie entra con la llave
-- pública; el portal usa la llave secreta en el servidor.
alter table ed_insights enable row level security;

comment on table ed_insights is
  'Informe semanal generado con IA a partir de las conversaciones del cliente.';
