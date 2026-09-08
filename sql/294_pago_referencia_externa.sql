-- ---------------------------------------------------------------------------
-- 294 · Referencia del NEGOCIO en el cobro (folio del presupuesto, OT, pedido)
--
-- POR QUÉ (8-sep-2026)
-- La referencia `P-XXXXXX` la genera el portal y al cliente final no le dice
-- nada: tiene que ir a buscarla a un mensaje de WhatsApp. El número que la
-- persona SÍ tiene en la mano es el del presupuesto que recibió, y es además
-- el ÚNICO que le sirve al negocio para encontrar el trabajo en su propio
-- sistema (en Impresora, el folio #5292 lleva al cliente, al detalle y al
-- saldo; el P-XXXXXX no lleva a ninguna parte).
--
-- Cuando esta columna trae valor, es ese número el que viaja al cliente en el
-- mensaje. El `P-XXXXXX` se queda como identificador interno del registro.
--
-- INERTE: columna opcional. Un cobro sin folio se comporta exactamente igual
-- que antes de esta migración.
-- ---------------------------------------------------------------------------

alter table ed_pagos
  add column if not exists referencia_externa text;

comment on column ed_pagos.referencia_externa is
  'Folio del negocio (presupuesto, OT, pedido). Si existe, es el número que se le pide al cliente en el mensaje, en vez de la referencia P-XXXXXX interna.';
