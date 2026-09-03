import assert from "node:assert/strict";
import test from "node:test";

import {
  decidirCierre,
  hayPistaDeCierre,
  hayPistaDeCotizacion,
  interpretarCierre,
  promptCierre,
} from "../lib/cierreDecision.ts";

/**
 * El detector de cierres decide si una conversación real pasa a GANADO (y
 * deja de decir "Cotización") o a "Falta pago". Equivocarse de más marca como
 * vendido lo que no se vendió; de menos, deja el embudo mintiendo como hasta
 * ahora. Estas pruebas son la reja.
 */

const conv = [
  { rol: "cliente", texto: "Hola, necesito 300 stickers de 5 cm" },
  { rol: "humano", texto: "300 stickers de 5 cm salen $35.000, con el 50% de abono empezamos" },
  { rol: "cliente", texto: "Dale, los tengo que pagar para confirmar?" },
  { rol: "cliente", texto: "[el cliente envió un archivo (Comprobante_Transferencia_48536929.pdf)]" },
];

// ── Pistas: qué merece una llamada al modelo ────────────────────────────────

test("un comprobante adjunto es pista", () => {
  assert.equal(hayPistaDeCierre([conv[3]]), true);
});

test("«dale» es pista; «gracias» no", () => {
  assert.equal(hayPistaDeCierre([{ rol: "cliente", texto: "Dale, hagámoslo" }]), true);
  assert.equal(hayPistaDeCierre([{ rol: "cliente", texto: "Muchas gracias!" }]), false);
  assert.equal(hayPistaDeCierre([{ rol: "cliente", texto: "¿A qué hora abren?" }]), false);
});

test("lo que dice el ASISTENTE no es pista (él siempre habla de abono)", () => {
  assert.equal(
    hayPistaDeCierre([{ rol: "empleado", texto: "Para empezar se pide un abono del 50%." }]),
    false,
  );
});

test("«ya transferí» y «abono listo» son pista", () => {
  assert.equal(hayPistaDeCierre([{ rol: "cliente", texto: "Ya transferí, me confirma?" }]), true);
  assert.equal(hayPistaDeCierre([{ rol: "cliente", texto: "Abono ok" }]), true);
});

test("una PERSONA dando un precio es pista de cotización; el cliente preguntándolo no", () => {
  assert.equal(hayPistaDeCotizacion([{ rol: "humano", texto: "Pendón 160x120 $ 22.000, 2 días hábiles" }]), true);
  assert.equal(hayPistaDeCotizacion([{ rol: "humano", texto: "[el equipo envió un archivo (Presupuesto #5279.pdf)]" }]), true);
  assert.equal(hayPistaDeCotizacion([{ rol: "cliente", texto: "cuánto sale el pendón de 160x120?" }]), false);
  assert.equal(hayPistaDeCotizacion([{ rol: "empleado", texto: "200 unidades $22.000" }]), false);
});

test("«cotizado» pasa la reja con la cita del precio", () => {
  const c = [{ rol: "humano", texto: "Pendon de 160x 120 $ 22.000 Plazo de entrega 2 día hábiles" }];
  const d = decidirCierre(interpretarCierre('{"estado":"cotizado","evidencia":"Pendon de 160x 120 $ 22.000"}'), c);
  assert.equal(d.estado, "cotizado");
});

// ── Del texto crudo a la propuesta ──────────────────────────────────────────

test("interpreta el JSON como string, con cercas de markdown", () => {
  const p = interpretarCierre('```json\n{"estado":"pagado","evidencia":"Comprobante_Transferencia"}\n```');
  assert.equal(p.estado, "pagado");
  assert.equal(p.evidencia, "Comprobante_Transferencia");
});

test("basura o estado inventado = abierto, nunca excepción", () => {
  assert.equal(interpretarCierre("no json").estado, "abierto");
  assert.equal(interpretarCierre('{"estado":"ganado"}').estado, "abierto");
  assert.equal(interpretarCierre(null).estado, "abierto");
});

// ── La reja: sin evidencia real no hay cierre ───────────────────────────────

test("⭐ pagado con evidencia que SÍ está en la conversación", () => {
  const d = decidirCierre(
    { estado: "pagado", evidencia: "Comprobante_Transferencia_48536929.pdf" },
    conv,
  );
  assert.equal(d.estado, "pagado");
});

test("⭐ pagado con evidencia INVENTADA cae a abierto", () => {
  const d = decidirCierre({ estado: "pagado", evidencia: "ya le pagué todo ayer" }, conv);
  assert.equal(d.estado, "abierto");
});

test("evidencia sin tildes/mayúsculas y recortada igual calza", () => {
  const d = decidirCierre(
    { estado: "aprobado_sin_pago", evidencia: "dale los tengo que pagar" },
    conv,
  );
  assert.equal(d.estado, "aprobado_sin_pago");
});

test("⭐ un adjunto sin nombre NO es comprobante", () => {
  const c = [{ rol: "cliente", texto: "[el cliente envió una imagen]" }];
  const d = decidirCierre({ estado: "pagado", evidencia: "[el cliente envió una imagen]" }, c);
  assert.equal(d.estado, "abierto");
});

test("⭐ un número suelto no es evidencia", () => {
  const c = [{ rol: "cliente", texto: "somos 15 personas" }];
  assert.equal(decidirCierre({ estado: "aprobado_sin_pago", evidencia: "15" }, c).estado, "abierto");
  assert.equal(decidirCierre({ estado: "aprobado_sin_pago", evidencia: "sí" }, [{ rol: "cliente", texto: "sí" }]).estado, "abierto");
});

test("una sola palabra vale si es de pago («Abono» de un documento \"Abono ok\")", () => {
  const c = [{ rol: "cliente", texto: "[documento] Abono ok" }];
  assert.equal(decidirCierre({ estado: "pagado", evidencia: "Abono" }, c).estado, "pagado");
});

test("pagado sin evidencia = abierto", () => {
  assert.equal(decidirCierre({ estado: "pagado", evidencia: "  " }, conv).estado, "abierto");
});

test("abierto sigue abierto pase lo que pase", () => {
  assert.equal(decidirCierre({ estado: "abierto", evidencia: "x" }, conv).estado, "abierto");
});

// ── El prompt ───────────────────────────────────────────────────────────────

test("el prompt distingue persona, asistente y cliente, y pide SOLO el JSON", () => {
  const p = promptCierre({ negocio: "Impresora Color", rubro: "imprenta", mensajes: conv });
  assert.match(p, /Persona del negocio: 300 stickers/);
  assert.match(p, /Cliente: Hola, necesito/);
  assert.match(p, /"pagado"\|"aprobado_sin_pago"\|"cotizado"\|"abierto"/);
  assert.match(p, /SOLO el JSON\.$/);
});
