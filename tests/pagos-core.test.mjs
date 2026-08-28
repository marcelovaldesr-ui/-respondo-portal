import assert from "node:assert/strict";
import test from "node:test";

import {
  MONTO_MAX,
  MONTO_MIN,
  formatearMonto,
  generarReferencia,
  mensajeDeCobro,
  puedeCambiar,
  validarCobro,
} from "../lib/pagosCore.ts";

/**
 * Estas reglas deciden si un mensaje con un MONTO y un ENLACE DE PAGO le llega
 * a un cliente final. Equivocarse acá no es un bug de pantalla: es plata que se
 * cobra mal o un enlace que manda a la persona a cualquier parte.
 */

const BASE = { monto: 25_000, concepto: "500 tarjetas de presentación", linkBase: "https://mpago.la/impresora" };

test("el caso normal pasa", () => {
  const v = validarCobro(BASE);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.monto, 25_000);
});

// ── El enlace ───────────────────────────────────────────────────────────────

test("⭐⭐ sin enlace configurado, la función NO existe para ese negocio", () => {
  // Inerte por diseño: mismo criterio que los cupos y el reingreso.
  for (const link of [null, undefined, "", "   "]) {
    assert.equal(validarCobro({ ...BASE, linkBase: link }).ok, false, `link: ${link}`);
  }
});

test("⭐ un enlace que no es https se rechaza", () => {
  // Uno malo mandaría al cliente final a cualquier parte con la plata en la mano.
  for (const link of ["http://mpago.la/x", "ftp://x.cl", "mpago.la/x", "javascript:alert(1)"]) {
    assert.equal(validarCobro({ ...BASE, linkBase: link }).ok, false, link);
  }
});

// ── El monto ────────────────────────────────────────────────────────────────

test("montos absurdos no salen", () => {
  for (const m of [0, -5000, 999, NaN, Infinity, MONTO_MAX + 1]) {
    assert.equal(validarCobro({ ...BASE, monto: m }).ok, false, `monto: ${m}`);
  }
});

test("los bordes del rango entran", () => {
  assert.equal(validarCobro({ ...BASE, monto: MONTO_MIN }).ok, true);
  assert.equal(validarCobro({ ...BASE, monto: MONTO_MAX }).ok, true);
});

test("un monto con decimales se redondea, no se rechaza", () => {
  const v = validarCobro({ ...BASE, monto: 25000.4 });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.monto, 25000);
});

// ── El concepto ─────────────────────────────────────────────────────────────

test("sin concepto no hay cobro", () => {
  for (const c of ["", "   "]) {
    assert.equal(validarCobro({ ...BASE, concepto: c }).ok, false);
  }
});

test("el concepto se normaliza (espacios múltiples)", () => {
  const v = validarCobro({ ...BASE, concepto: "  500   tarjetas  " });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.concepto, "500 tarjetas");
});

// ── La referencia ───────────────────────────────────────────────────────────

test("la referencia tiene forma P-XXXXXX y sin letras confusas", () => {
  for (let i = 0; i < 50; i++) {
    const r = generarReferencia();
    assert.match(r, /^P-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/, r);
    // Sin 0/O ni 1/I/L: la gente la dicta por teléfono.
    assert.doesNotMatch(r, /[01OIL]/, r);
  }
});

test("con el mismo azar sale la misma referencia (determinista para conciliar)", () => {
  let seq = [0.1, 0.5, 0.9, 0.2, 0.7, 0.3];
  const gen = () => seq.shift() ?? 0;
  const a = generarReferencia(gen);
  seq = [0.1, 0.5, 0.9, 0.2, 0.7, 0.3];
  const b = generarReferencia(gen);
  assert.equal(a, b);
});

// ── El mensaje ──────────────────────────────────────────────────────────────

test("el mensaje trae monto, concepto, enlace y referencia", () => {
  const m = mensajeDeCobro({
    concepto: "500 tarjetas",
    monto: 25_000,
    referencia: "P-ABC234",
    linkBase: "https://mpago.la/impresora",
    nombreNegocio: "Impresora Color",
  });
  assert.ok(m.includes("$25.000"), m);
  assert.ok(m.includes("500 tarjetas"), m);
  assert.ok(m.includes("https://mpago.la/impresora"), m);
  assert.ok(m.includes("P-ABC234"), m);
  // El enlace va en su propia línea: WhatsApp lo convierte en tarjeta.
  assert.ok(m.split("\n").some((l) => l.trim() === "https://mpago.la/impresora"), m);
});

test("el formato de pesos es chileno (punto de miles)", () => {
  assert.equal(formatearMonto(1_500_000), "$1.500.000");
  assert.equal(formatearMonto(25_000), "$25.000");
});

// ── Estados ─────────────────────────────────────────────────────────────────

test("⭐ pagado es TERMINAL: no se puede des-pagar", () => {
  // Des-pagar cambiaría el total cobrado del mes hacia atrás, sin rastro.
  assert.equal(puedeCambiar("pagado", "pendiente"), false);
  assert.equal(puedeCambiar("pagado", "anulado"), false);
});

test("anulado también es terminal", () => {
  assert.equal(puedeCambiar("anulado", "pendiente"), false);
  assert.equal(puedeCambiar("anulado", "pagado"), false);
});

test("desde pendiente se puede pagar o anular", () => {
  assert.equal(puedeCambiar("pendiente", "pagado"), true);
  assert.equal(puedeCambiar("pendiente", "anulado"), true);
});

test("quedarse igual no es una transición", () => {
  assert.equal(puedeCambiar("pendiente", "pendiente"), false);
});
