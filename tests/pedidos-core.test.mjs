import assert from "node:assert/strict";
import test from "node:test";

import { validarCuerpoPedido } from "../lib/pedidosCore.ts";

/**
 * Primera puerta de un webhook que reciben sistemas EXTERNOS. Todo lo que llega
 * de afuera es hostil hasta que se demuestre lo contrario.
 */

test("el caso normal pasa y se normaliza", () => {
  const v = validarCuerpoPedido({ chat_id: "+56 9 1234-5678", tipo: "pedido_listo", detalle: " 500  tarjetas " });
  assert.deepEqual(v, { ok: true, chatId: "56912345678", tipo: "pedido_listo", detalle: "500 tarjetas" });
});

test("teléfonos con cualquier formato calzan igual", () => {
  for (const t of ["56912345678", "+56912345678", "56 9 1234 5678", "(569) 1234-5678"]) {
    const v = validarCuerpoPedido({ chat_id: t, tipo: "encargo_llego" });
    assert.equal(v.ok, true, t);
    if (v.ok) assert.equal(v.chatId, "56912345678");
  }
});

test("⭐ un chat_id que no es teléfono se rechaza", () => {
  for (const t of ["", "123", "abc", null, undefined, "1".repeat(16), {}]) {
    assert.equal(validarCuerpoPedido({ chat_id: t, tipo: "pedido_listo" }).ok, false, String(t));
  }
});

test("⭐ solo los dos tipos conocidos: nada de tipos inventados por el sistema externo", () => {
  for (const tipo of ["", "listo", "PEDIDO_LISTO", "moto_lista", "cotizacion_pendiente", 42, null]) {
    assert.equal(validarCuerpoPedido({ chat_id: "56912345678", tipo }).ok, false, String(tipo));
  }
});

test("el detalle limpia saltos de línea (romperían la plantilla, error 132012)", () => {
  const v = validarCuerpoPedido({ chat_id: "56912345678", tipo: "pedido_listo", detalle: "500\ntarjetas\tcouché" });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.detalle, "500 tarjetas couché");
});

test("detalle kilométrico se recorta a 80", () => {
  const v = validarCuerpoPedido({ chat_id: "56912345678", tipo: "pedido_listo", detalle: "x".repeat(500) });
  if (v.ok) assert.equal(v.detalle.length, 80);
});

test("sin detalle cae al genérico «tu pedido»", () => {
  for (const d of [undefined, null, "", "   "]) {
    const v = validarCuerpoPedido({ chat_id: "56912345678", tipo: "pedido_listo", detalle: d });
    if (v.ok) assert.equal(v.detalle, "tu pedido");
  }
});

test("un body que no es objeto no revienta", () => {
  for (const b of [null, undefined, "hola", 42, []]) {
    assert.equal(validarCuerpoPedido(b).ok, false, String(b));
  }
});
