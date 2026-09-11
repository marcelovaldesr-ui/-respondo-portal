/**
 * COBROS: "el cliente dijo que pagó" ≠ "pago confirmado" (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { cambiarEstadoPago } from "../lib/pagos.ts";

function base(contacto) {
  return crearBaseMemoria({
    ed_pagos: [{ id: "p1", cliente_id: "c1", chat_id: "569", estado: "pendiente", monto: 1000 }],
    ed_contactos: [
      { cliente_id: "c1", chat_id: "569", etapa: "cotizado", etapa_manual: false, etiquetas: ["cotizacion", "pago_por_confirmar"], ...contacto },
      { cliente_id: "c2", chat_id: "569", etapa: "cotizado", etapa_manual: false, etiquetas: ["pago_pendiente"] },
    ],
  });
}

test("marcar pagado: el contacto pasa a ganado y se van «Falta pago» / «Pago por confirmar» (solo en su negocio)", async () => {
  const supa = base();
  const r = await cambiarEstadoPago({ clienteId: "c1", pagoId: "p1", desde: "pendiente", hacia: "pagado", supa });
  assert.equal(r.ok, true);
  const [mio, ajeno] = supa.tablas.ed_contactos;
  assert.equal(mio.etapa, "ganado");
  assert.equal(mio.etapa_motivo, "pago_confirmado");
  assert.deepEqual(mio.etiquetas, ["cliente"]);
  assert.equal(ajeno.etapa, "cotizado", "el mismo chat_id en otro negocio no se toca");
  assert.deepEqual(ajeno.etiquetas, ["pago_pendiente"]);
});

test("etapa movida a mano: se respeta, solo se limpian las marcas de pago", async () => {
  const supa = base({ etapa: "interesado", etapa_manual: true, etiquetas: ["pago_pendiente", "reclamo"] });
  await cambiarEstadoPago({ clienteId: "c1", pagoId: "p1", desde: "pendiente", hacia: "pagado", supa });
  const mio = supa.tablas.ed_contactos[0];
  assert.equal(mio.etapa, "interesado");
  assert.deepEqual(mio.etiquetas, ["reclamo"]);
});

test("otro negocio no puede marcar el cobro", async () => {
  const supa = base();
  const r = await cambiarEstadoPago({ clienteId: "c2", pagoId: "p1", desde: "pendiente", hacia: "pagado", supa });
  assert.equal(r.ok, false);
  assert.equal(supa.tablas.ed_pagos[0].estado, "pendiente");
});
