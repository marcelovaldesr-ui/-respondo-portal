-- ---------------------------------------------------------------------------
-- 295 · Cómo llama el NEGOCIO a su número de trabajo
--
-- POR QUÉ (8-sep-2026)
-- La migración 294 hizo que el mensaje de cobro pida el folio del negocio en
-- vez del `P-XXXXXX`. Pero el mensaje seguía diciendo «indica la referencia
-- 5292» mientras la pantalla de pago decía «N° de presupuesto»: DOS PALABRAS
-- DISTINTAS PARA EL MISMO NÚMERO, y el cliente tenía que traducir.
--
-- «Referencia» además es vago: suena a número de transferencia, a código de
-- boleta, a cualquier cosa. Con esta columna cada negocio declara cómo se
-- llama su número —«N° de presupuesto», «N° de OT», «N° de pedido»— y el
-- mensaje usa ESA palabra, la misma que el cliente ve en el formulario.
--
-- INERTE: si está vacía, el mensaje dice «la referencia», exactamente como
-- antes de esta migración.
-- ---------------------------------------------------------------------------

alter table ed_clientes
  add column if not exists pago_ref_etiqueta text;

comment on column ed_clientes.pago_ref_etiqueta is
  'Cómo llama el negocio a su número de trabajo (ej: «N° de presupuesto», «N° de OT»). Se usa en el mensaje de cobro y en el formulario. Vacío = «la referencia».';
