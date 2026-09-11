/**
 * WAHA ES DE UN SOLO NEGOCIO: sin poder verificarlo, no se envía (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decidirBloqueoWaha } from "../lib/waha.ts";

test("el dueño de la sesión envía; otro negocio no", () => {
  assert.equal(decidirBloqueoWaha("imp", "imp", false), null);
  assert.equal(decidirBloqueoWaha("otro", "imp", false), "waha_pertenece_a_otro_cliente");
});

test("falla CERRADO: sin clienteId, sin dueño configurado o con error de lectura", () => {
  assert.equal(decidirBloqueoWaha(undefined, "imp", false), "waha_sin_cliente");
  assert.equal(decidirBloqueoWaha("imp", null, false), "waha_dueno_no_verificable");
  assert.equal(decidirBloqueoWaha("otro", null, true), "waha_dueno_no_verificable", "antes: error de base → el mensaje salía igual");
});
