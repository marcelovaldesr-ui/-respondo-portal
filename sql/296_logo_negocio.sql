-- ============================================================================
-- 296 · EL LOGO DEL NEGOCIO EN SU PROPIO PORTAL
-- ============================================================================
--
-- POR QUÉ (9-sep-2026)
-- --------------------
-- El portal se lo entregamos a cada cliente como SU herramienta, pero se veía
-- igual para todos: un punto de color y el nombre en texto. La primera
-- impresión de un dueño que entra a ver «su» plataforma es genérica.
--
-- Poner su logo arriba a la izquierda cuesta poco y cambia de qué se trata la
-- pantalla: deja de ser «el software que contraté» y pasa a ser «mi negocio».
-- Es la misma razón por la que el comprobante de pago lleva el logo — no es
-- decoración, es reconocimiento.
--
-- POR QUÉ ESTE BUCKET SÍ ES PÚBLICO (y `adjuntos` no)
-- ---------------------------------------------------
-- `adjuntos` guarda fotos y documentos de los clientes finales de otros
-- negocios: cotizaciones, artes, a veces cédulas. Público sería una filtración
-- de datos personales servida por nosotros.
--
-- Un logo es lo contrario: es la marca que el negocio ya publica en su vitrina,
-- su web y sus redes. No hay nada que proteger, y hacerlo público evita montar
-- un proxy autenticado para servir una imagen que cualquiera puede ver en la
-- calle. Menos código que mantener por dos personas.
-- ============================================================================

-- ── 1) Dónde vive la imagen ─────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'logos',
  'logos',
  true,
  -- 2 MB. Un logo razonable pesa 20-200 KB; el tope existe para que nadie
  -- suba el archivo de imprenta en alta resolución por equivocación.
  2097152
)
on conflict (id) do nothing;

-- ── 2) La URL en el cliente ─────────────────────────────────────────────────
alter table ed_clientes
  add column if not exists logo_url text;

comment on column ed_clientes.logo_url is
  'URL pública del logo del negocio (bucket `logos`). Se muestra en su portal. Vacío = se muestra la inicial del nombre.';

-- ── Sin políticas de RLS, igual que en `adjuntos` ───────────────────────────
-- Solo el servidor escribe, con `service_role`. La lectura es pública por el
-- flag del bucket, que es exactamente lo que se busca acá.

-- ── Verificación ────────────────────────────────────────────────────────────
select id, public, file_size_limit from storage.buckets where id = 'logos';
