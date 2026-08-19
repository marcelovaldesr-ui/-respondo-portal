import assert from "node:assert/strict";
import test from "node:test";

import { ventanaMantencion } from "../lib/generadorCore.ts";

/**
 * La ventana de "le toca la mantención ahora".
 *
 * Es la única aritmética del generador que puede fallar en silencio: si los
 * márgenes se dan vuelta, la consulta devuelve un rango vacío y el cron no
 * programa nada — que desde afuera se ve exactamente igual que "no hay
 * candidatos".
 */

const AGO_2026 = new Date("2026-08-19T12:00:00Z");

test("con intervalo de 6 meses, la ventana va de hace 8 a hace 5 meses", () => {
  const { desde, hasta } = ventanaMantencion(AGO_2026, 6, 1, 2);
  assert.equal(desde, "2025-12-19");
  assert.equal(hasta, "2026-03-19");
});

test("desde siempre es anterior a hasta", () => {
  for (const intervalo of [3, 4, 6, 9, 12]) {
    const { desde, hasta } = ventanaMantencion(AGO_2026, intervalo, 1, 2);
    assert.ok(desde < hasta, `intervalo ${intervalo}: ${desde} no es anterior a ${hasta}`);
  }
});

test("el que vino ayer queda fuera y el de hace 6 meses queda dentro", () => {
  const { desde, hasta } = ventanaMantencion(AGO_2026, 6, 1, 2);
  const ayer = "2026-08-18";
  const haceSeisMeses = "2026-02-19";
  const haceTresAnios = "2023-08-19";

  assert.ok(ayer > hasta, "al que vino ayer no se le escribe");
  assert.ok(haceSeisMeses >= desde && haceSeisMeses <= hasta, "al de hace 6 meses sí");
  assert.ok(haceTresAnios < desde, "el de hace tres años ya no es un recordatorio");
});

test("cruzar el año no rompe la resta de meses", () => {
  const enero = new Date("2026-01-15T12:00:00Z");
  const { desde, hasta } = ventanaMantencion(enero, 6, 1, 2);
  assert.equal(desde, "2025-05-15");
  assert.equal(hasta, "2025-08-15");
});

test("un intervalo corto no genera una ventana invertida", () => {
  // Intervalo 1 con margen de 1 mes antes: 'hasta' cae en hoy, no en el futuro.
  const { desde, hasta } = ventanaMantencion(AGO_2026, 1, 1, 2);
  assert.equal(hasta, "2026-08-19");
  assert.ok(desde < hasta);
});
