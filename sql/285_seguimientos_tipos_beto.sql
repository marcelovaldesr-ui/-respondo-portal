-- 285_seguimientos_tipos_beto.sql
-- ---------------------------------------------------------------------------
-- BLOQUEANTE. Beto no puede programar NADA hasta que esto se aplique.
--
-- Qué pasó: la migración 214 dejó el CHECK de `ed_seguimientos.tipo` con cinco
-- valores, pensados para el vertical clínicas. Después escribimos el generador
-- de mantenciones y las plantillas de taller, que usan tipos que ese CHECK no
-- conoce. El código está bien, los tests pasan, las plantillas están aprobadas
-- en Meta — y el insert falla igual.
--
-- Verificado contra la base real el 26-ago-2026:
--
--   insert into ed_seguimientos (..., tipo) values (..., 'mantencion_toca');
--   → 23514  new row for relation "ed_seguimientos" violates check constraint
--            "ed_seguimientos_tipo_check"
--
-- O sea: el generador habría corrido en el cron, no habría programado ni una
-- fila, y el log habría dicho "no se pudo programar" sin que nadie lo mirara.
-- La lección quedó anotada: un CHECK de texto es un contrato que el TypeScript
-- no ve, y por eso ningún test lo iba a cazar.
--
-- APLICAR: Supabase → SQL Editor → pegar → Run. Es instantáneo y no toca datos.
-- Se puede aplicar antes o después del deploy.
-- ---------------------------------------------------------------------------

alter table ed_seguimientos drop constraint if exists ed_seguimientos_tipo_check;

alter table ed_seguimientos add constraint ed_seguimientos_tipo_check
  check (tipo in (
    -- Tino: la venta que quedó a medias
    'cotizacion_sin_respuesta',
    'cotizacion_pendiente',
    'cliente_inactivo',
    -- Agenda
    'recordatorio_cita',
    'confirmacion_cita',
    -- Vera
    'encuesta_postventa',
    -- Beto
    'mantencion_toca',
    -- Taller (las plantillas ya existen en Meta; falta quién las dispare)
    'repuesto_llego',
    'moto_lista'
  ));

-- Comprobación: esto tiene que devolver 0 filas. Si devuelve alguna, hay un
-- tipo en uso que quedó fuera de la lista y el motor lo va a rechazar mañana.
--
--   select distinct tipo from ed_seguimientos
--   where tipo not in ('cotizacion_sin_respuesta','cotizacion_pendiente',
--     'cliente_inactivo','recordatorio_cita','confirmacion_cita',
--     'encuesta_postventa','mantencion_toca','repuesto_llego','moto_lista');
