-- 214: ampliar los tipos de seguimiento para el vertical clínicas.
-- El CHECK actual solo acepta 'cotizacion_sin_respuesta' y 'cliente_inactivo'
-- (verificado 30-jul-2026). El vertical clínicas necesita recordatorios y
-- confirmaciones de cita (feature #1 de compra según el análisis competitivo)
-- y Vera necesitará encuesta postventa.
--
-- APLICAR EN SUPABASE (SQL editor) cuando se empaquete el vertical clínicas.

ALTER TABLE ed_seguimientos DROP CONSTRAINT IF EXISTS ed_seguimientos_tipo_check;
ALTER TABLE ed_seguimientos ADD CONSTRAINT ed_seguimientos_tipo_check
  CHECK (tipo IN (
    'cotizacion_sin_respuesta',
    'cliente_inactivo',
    'recordatorio_cita',
    'confirmacion_cita',
    'encuesta_postventa'
  ));
