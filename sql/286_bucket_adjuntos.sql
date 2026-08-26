-- ============================================================================
-- 286 · GUARDAR LOS ADJUNTOS ANTES DE QUE META LOS BORRE
-- ============================================================================
--
-- EL PROBLEMA, Y NO ES HIPOTÉTICO
-- -------------------------------
-- El portal NO guarda los archivos: guarda un puntero `meta:<media_id>` y se los
-- pide a Meta en cada visita. Y Meta **borra el archivo**:
--
--   · media subido por nosotros ......... 30 días
--   · media que llega por WEBHOOK ........ 7 días   ← es nuestro caso
--
-- O sea: **cada foto que un cliente manda hoy deja de verse en una semana**, sola,
-- sin que nadie toque nada. Verificado contra la documentación el 26-ago-2026.
--
-- Esto pasó desapercibido porque en WAHA el archivo vivía en nuestro propio
-- servidor y no caducaba. Al migrar a la vía oficial —que es por donde entra todo
-- cliente nuevo— el historial de imágenes pasó a tener fecha de vencimiento.
--
-- LA SOLUCIÓN
-- -----------
-- Un bucket propio. `lib/archivarMedia.ts` barre los punteros recientes, descarga
-- el archivo y reescribe el puntero a `sb:<ruta>`. A partir de ahí el archivo es
-- nuestro y no depende de que Meta lo siga sirviendo.
--
-- ⚠️ PRIVADO A PROPÓSITO. Son fotos y documentos de clientes reales de otros
-- negocios: cotizaciones, artes, a veces cédulas. Un bucket público sería una
-- filtración de datos personales servida por nosotros — y con la Ley 21.719
-- entrando el 1-dic-2026, además, un problema legal. Se sirve SIEMPRE por
-- `/api/whatsapp/media`, que valida sesión y `cliente_id`.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'adjuntos',
  'adjuntos',
  false,
  -- 10 MB. Cubre fotos (WhatsApp las comprime a 50-150 KB), PDF de cotización y
  -- documentos normales. Un arte de imprenta pesado queda fuera a propósito: un
  -- solo cliente subiendo archivos de 100 MB llenaría el plan en un día, y ese
  -- costo lo paga Respondo, no él. Los que pasan el tope se marcan aparte para
  -- que el portal lo DIGA en vez de mostrar un error mudo.
  10485760
)
on conflict (id) do nothing;

-- ── Sin políticas de RLS, y es deliberado ───────────────────────────────────
--
-- Al bucket solo entra el servidor con `service_role`, que salta RLS por
-- definición. El navegador NUNCA habla con Storage: pide `/api/whatsapp/media`,
-- que ya valida sesión y que el mensaje sea del cliente logueado.
--
-- Escribir políticas acá daría una falsa sensación de seguridad: el aislamiento
-- entre clientes en este portal es por CÓDIGO, no por RLS (ver la auditoría del
-- 11-ago-2026). Mantener un solo lugar donde se decide quién ve qué es lo que
-- evita que un día se filtre por el camino que nadie estaba mirando.

-- ── Verificación ────────────────────────────────────────────────────────────
select id, public, file_size_limit
from storage.buckets
where id = 'adjuntos';
