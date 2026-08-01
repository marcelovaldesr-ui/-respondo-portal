-- ============================================================================
-- 251_etapa_motivo.sql · Por qué una oportunidad quedó cerrada
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
-- El embudo no tenía salida. Una conversación entraba a "cotizado" y se quedaba
-- ahí para siempre: la etapa solo avanzaba con etiquetas y nada marcaba que la
-- conversación había terminado. Medido en Impresora Color el 31-jul-2026: de 9
-- oportunidades "por cerrarse", cuatro eran despedidas ("ya muchas gracias",
-- "si", "de nada, nos vemos el lunes").
--
-- Un tablero que cuenta como oportunidad viva a alguien que ya se despidió no
-- es optimista: es inútil. El dueño lo abre, ve nueve, sabe que no son nueve, y
-- deja de mirarlo.
--
-- LA SOLUCIÓN
-- Cerrar por silencio: si el NEGOCIO fue el último en escribir y el cliente no
-- respondió en una semana, la oportunidad pasa a "perdido". Esta columna guarda
-- POR QUÉ, para que el tablero pueda decir "Perdido · sin respuesta" en vez de
-- afirmar una derrota que nadie declaró.
--
-- Sin la columna habría que elegir entre mentir (decir "perdido" a secas) o no
-- cerrar nada. Un texto corto es más barato que cualquiera de las dos.
--
-- APLICAR EN SUPABASE (SQL Editor). Aditiva y reversible.
-- ============================================================================

alter table ed_contactos add column if not exists etapa_motivo text;

comment on column ed_contactos.etapa_motivo is
  'Por qué quedó en esta etapa cuando no fue decisión de una persona. '
  'Hoy solo se usa "sin_respuesta" (cerrada automáticamente por silencio). '
  'NULL = la etapa la puso una señal del asistente o una persona.';

-- Índice para el filtro de oportunidades vivas, que consulta el menú en CADA
-- navegación: etapa + quién habló último + cuándo.
create index if not exists idx_ed_contactos_embudo_vivo
  on ed_contactos (cliente_id, etapa, ultimo_mensaje_en desc);
