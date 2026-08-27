-- ============================================================================
-- 287 · TIPOS DE SEGUIMIENTO PARA IMPRENTA Y TIENDAS
-- ============================================================================
--
-- Agrega `pedido_listo` y `encargo_llego` al CHECK de `ed_seguimientos.tipo`.
--
-- POR QUÉ
-- -------
-- El catálogo de plantillas se había armado pensando en RS-Shop (motos):
-- `moto_lista`, `repuesto_llego`, `mantencion_toca`. Al conectar Impresora Color
-- quedó a la vista que **una imprenta no agenda horas**: cotiza, produce y
-- entrega. Sus dos avisos naturales no existían.
--
-- ⚠️ ESTA MIGRACIÓN NO ES OPCIONAL SI SE VAN A USAR ESOS TIPOS. Es exactamente
-- el mismo bloqueo que costó la 285: el CHECK rechaza con error 23514, Beto no
-- alcanza a programar nada y **falla en silencio**. Si el código intenta escribir
-- un tipo que el CHECK no conoce, no se ve un error en pantalla — simplemente no
-- se programa el seguimiento.
--
-- ORDEN: da lo mismo antes o después del deploy. Ampliar un CHECK nunca rompe
-- filas existentes; solo permite más valores.
-- ============================================================================

alter table ed_seguimientos drop constraint if exists ed_seguimientos_tipo_check;
alter table ed_seguimientos add constraint ed_seguimientos_tipo_check
  check (tipo in (
    -- Universales
    'cotizacion_sin_respuesta',
    'cotizacion_pendiente',
    'cliente_inactivo',
    'encuesta_postventa',
    -- Rubros que agendan horas
    'recordatorio_cita',
    'confirmacion_cita',
    -- Motos, taller, automotriz
    'mantencion_toca',
    'repuesto_llego',
    'moto_lista',
    -- Imprenta, tienda, retail  ← nuevos en la 287
    'pedido_listo',
    'encargo_llego'
  ));

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe aceptar los dos tipos nuevos sin error.
do $$
begin
  perform 1 where 'pedido_listo' in (
    'cotizacion_sin_respuesta','cotizacion_pendiente','cliente_inactivo',
    'encuesta_postventa','recordatorio_cita','confirmacion_cita',
    'mantencion_toca','repuesto_llego','moto_lista','pedido_listo','encargo_llego'
  );
  raise notice 'CHECK de ed_seguimientos.tipo actualizado: 11 tipos permitidos.';
end $$;
