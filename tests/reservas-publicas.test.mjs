import assert from "node:assert/strict";
import test from "node:test";

import {
  coincideConSlotOfrecido,
  esUuid,
  normalizarNombre,
  normalizarTelefono,
  parsearJsonAcotado,
} from "../lib/reservasPublicas.ts";

test("el JSON público rechaza cuerpos inválidos, arrays y exceso real de bytes", () => {
  assert.deepEqual(parsearJsonAcotado('{"ok":true}', 32), { ok: true });
  assert.equal(parsearJsonAcotado("[1,2]", 32), null);
  assert.equal(parsearJsonAcotado("{mal", 32), null);
  assert.equal(parsearJsonAcotado(JSON.stringify({ x: "😀😀😀" }), 12), null);
});

test("normaliza teléfonos chilenos y rechaza longitudes abusivas", () => {
  assert.equal(normalizarTelefono("+56 9 1234 5678"), "56912345678");
  assert.equal(normalizarTelefono("9 1234 5678"), "56912345678");
  assert.equal(normalizarTelefono("123"), null);
  assert.equal(normalizarTelefono("1".repeat(16)), null);
});

test("normaliza nombres sin permitir payloads gigantes", () => {
  assert.equal(normalizarNombre("  Ana    Pérez  "), "Ana Pérez");
  assert.equal(normalizarNombre("x".repeat(100)).length, 80);
});

test("valida UUID y exige que la reserva coincida con un slot ofrecido", () => {
  const profesionalId = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(esUuid(profesionalId), true);
  assert.equal(esUuid("../../../otro"), false);

  const slots = [{ profesionalId, inicio: "2026-08-10T14:00:00.000Z" }];
  assert.equal(coincideConSlotOfrecido(slots, profesionalId, "2026-08-10T14:00:00Z"), true);
  assert.equal(coincideConSlotOfrecido(slots, profesionalId, "2026-08-10T15:00:00Z"), false);
  assert.equal(coincideConSlotOfrecido(slots, "otro", "2026-08-10T14:00:00Z"), false);
});
