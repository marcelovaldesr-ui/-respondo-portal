import assert from "node:assert/strict";
import test from "node:test";

import { validarFicha, rutValido, normalizarRut, resumenFicha } from "../lib/fichaServicio.ts";

function campo(over = {}) {
  return {
    id: "c1",
    etiqueta: "Dato",
    tipo: "texto",
    opciones: null,
    obligatorio: false,
    ayuda: null,
    orden: 0,
    ...over,
  };
}

// ── RUT ────────────────────────────────────────────────────────────────────

test("valida el dígito verificador del RUT", () => {
  // RUTs con DV correcto.
  assert.equal(rutValido("11.111.111-1"), true);
  assert.equal(rutValido("12345678-5"), true);
  // Mismo cuerpo con DV equivocado.
  assert.equal(rutValido("12345678-9"), false);
  assert.equal(rutValido("11111111-2"), false);
});

test("acepta el DV 'K' y lo normaliza en mayúscula", () => {
  assert.equal(rutValido("20347878-k"), rutValido("20347878-K"));
  assert.equal(normalizarRut("20.347.878-k"), "20347878-K");
});

test("rechaza RUT con formato imposible", () => {
  assert.equal(rutValido(""), false);
  assert.equal(rutValido("123"), false);
  assert.equal(rutValido("abcdefgh-1"), false);
});

// ── Obligatoriedad ─────────────────────────────────────────────────────────

test("un campo obligatorio vacío devuelve error; uno opcional no", () => {
  const malo = validarFicha([campo({ obligatorio: true })], { c1: "   " });
  assert.equal(malo.ok, false);
  assert.match(malo.errores.c1, /falta/i);

  const bueno = validarFicha([campo({ obligatorio: false })], { c1: "" });
  assert.equal(bueno.ok, true);
  assert.deepEqual(bueno.datos, {});
});

// ── Seguridad: no confiar en el navegador ──────────────────────────────────

test("ignora claves que no corresponden a un campo definido", () => {
  const r = validarFicha([campo({ id: "c1", etiqueta: "Patente" })], {
    c1: "ABCD12",
    inventado: "valor basura",
    otro: "x".repeat(5000),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.datos, { Patente: "ABCD12" });
});

test("una opción fuera de la lista se rechaza (no se puede inyectar por POST)", () => {
  const c = campo({ tipo: "opciones", opciones: ["Fonasa", "Isapre", "Particular"], etiqueta: "Previsión" });
  const malo = validarFicha([c], { c1: "Gratis total" });
  assert.equal(malo.ok, false);

  const bueno = validarFicha([c], { c1: "Isapre" });
  assert.equal(bueno.ok, true);
  assert.deepEqual(bueno.datos, { Previsión: "Isapre" });
});

test("recorta por largo máximo en vez de guardar un texto enorme", () => {
  const r = validarFicha([campo({ tipo: "texto" })], { c1: "x".repeat(500) });
  assert.equal(r.ok, false);
  assert.match(r.errores.c1, /máximo/i);
});

// ── Tipos ──────────────────────────────────────────────────────────────────

test("valida correo, número, teléfono y fecha", () => {
  assert.equal(validarFicha([campo({ tipo: "email" })], { c1: "no-es-correo" }).ok, false);
  assert.equal(validarFicha([campo({ tipo: "email" })], { c1: "A@B.CL" }).ok, true);
  // El correo se normaliza a minúsculas.
  assert.deepEqual(validarFicha([campo({ tipo: "email" })], { c1: "A@B.CL" }).datos, { Dato: "a@b.cl" });

  assert.equal(validarFicha([campo({ tipo: "numero" })], { c1: "12a" }).ok, false);
  assert.equal(validarFicha([campo({ tipo: "numero" })], { c1: "45000" }).ok, true);

  assert.equal(validarFicha([campo({ tipo: "telefono" })], { c1: "123" }).ok, false);
  assert.equal(validarFicha([campo({ tipo: "telefono" })], { c1: "+56 9 1234 5678" }).ok, true);

  assert.equal(validarFicha([campo({ tipo: "fecha" })], { c1: "17-08-2026" }).ok, false);
  assert.equal(validarFicha([campo({ tipo: "fecha" })], { c1: "2026-08-17" }).ok, true);
});

test("sí/no solo acepta los dos valores exactos", () => {
  assert.equal(validarFicha([campo({ tipo: "si_no" })], { c1: "quizás" }).ok, false);
  assert.equal(validarFicha([campo({ tipo: "si_no" })], { c1: "Sí" }).ok, true);
});

// ── Caso real completo: clínica dental ─────────────────────────────────────

test("ficha completa de una clínica dental", () => {
  const campos = [
    campo({ id: "rut", etiqueta: "RUT del paciente", tipo: "rut", obligatorio: true, orden: 0 }),
    campo({
      id: "prev",
      etiqueta: "Previsión",
      tipo: "opciones",
      opciones: ["Fonasa", "Isapre", "Particular"],
      obligatorio: true,
      orden: 1,
    }),
    campo({ id: "primera", etiqueta: "¿Primera vez?", tipo: "si_no", orden: 2 }),
    campo({ id: "motivo", etiqueta: "Motivo", tipo: "parrafo", orden: 3 }),
  ];

  const r = validarFicha(campos, {
    rut: "11.111.111-1",
    prev: "Fonasa",
    primera: "Sí",
    motivo: "Dolor en muela superior derecha",
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.datos, {
    "RUT del paciente": "11111111-1",
    "Previsión": "Fonasa",
    "¿Primera vez?": "Sí",
    Motivo: "Dolor en muela superior derecha",
  });
});

test("acumula TODOS los errores, no solo el primero", () => {
  const campos = [
    campo({ id: "a", etiqueta: "RUT", tipo: "rut", obligatorio: true }),
    campo({ id: "b", etiqueta: "Correo", tipo: "email", obligatorio: true }),
  ];
  const r = validarFicha(campos, { a: "1-1", b: "malo" });
  assert.equal(r.ok, false);
  // Sin esto, la persona corrige un campo, reenvía y descubre el siguiente error.
  assert.deepEqual(Object.keys(r.errores).sort(), ["a", "b"]);
});

// ── Resumen para WhatsApp ──────────────────────────────────────────────────

test("el resumen se acota y avisa cuántos datos quedaron fuera", () => {
  assert.equal(resumenFicha(null), "");
  assert.equal(resumenFicha({ A: "1", B: "2" }), "A: 1 · B: 2");
  assert.equal(resumenFicha({ A: "1", B: "2", C: "3", D: "4" }), "A: 1 · B: 2 · C: 3 (+1)");
});
