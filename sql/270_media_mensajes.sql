-- =============================================================================
-- 270: Multimedia entrante visible para la persona (auditoría 1-ago-2026)
-- -----------------------------------------------------------------------------
-- PROBLEMA que corrige: cuando un cliente mandaba una foto, un PDF o un audio,
-- el sistema guardaba SOLO un marcador de texto ("[el cliente envió una
-- imagen]"). La persona que atiende NO podía abrir el archivo desde el inbox: se
-- quedaba ciega sobre qué recibió realmente el cliente (Fase 5/13 de la
-- auditoría). Estas columnas guardan los metadatos del adjunto para poder
-- servirlo después a través de un proxy autenticado (/api/whatsapp/media).
--
-- Todo es ADITIVO y NULLABLE: los mensajes existentes quedan con media_* = NULL
-- y el código (guardarMensaje) tolera que estas columnas no existan todavía, así
-- que aplicar esta migración no rompe nada aunque el deploy vaya por delante.
--
--   media_url    → URL de descarga que expone el transporte (WAHA). En WAHA
--                  requiere el header X-Api-Key, por eso NUNCA se entrega directo
--                  al navegador: se sirve por el proxy del portal.
--   media_mime   → tipo MIME informado (image/jpeg, application/pdf, audio/ogg…).
--   media_tipo   → categoría normalizada: imagen|documento|audio|video|sticker|
--                  ubicacion|otro (vocabulario de lib/waha.ts).
--   media_nombre → nombre del archivo cuando es un documento.
-- =============================================================================

alter table ed_mensajes add column if not exists media_url    text;
alter table ed_mensajes add column if not exists media_mime   text;
alter table ed_mensajes add column if not exists media_tipo   text;
alter table ed_mensajes add column if not exists media_nombre text;

comment on column ed_mensajes.media_url is
  'URL de descarga del adjunto entrante (se sirve vía proxy autenticado; puede requerir X-Api-Key)';
comment on column ed_mensajes.media_mime is
  'MIME del adjunto entrante (image/jpeg, application/pdf, audio/ogg, …)';
comment on column ed_mensajes.media_tipo is
  'Categoría del adjunto: imagen|documento|audio|video|sticker|ubicacion|otro';
comment on column ed_mensajes.media_nombre is
  'Nombre del archivo del adjunto, cuando es un documento';

-- Índice parcial para listar rápido los mensajes con adjunto (poco frecuentes):
create index if not exists ed_mensajes_media_idx
  on ed_mensajes (empleado_id, chat_id, creado_en)
  where media_tipo is not null;
