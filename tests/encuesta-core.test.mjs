import assert from "node:assert/strict";
import test from "node:test";

import { detectarNota, esNotaMala, textoRespuestaEncuesta } from "../lib/encuestaCore.ts";

/**
 * Esta regla decide dos cosas irreversibles: si se cierra una cita y qué fila
 * permanente queda en ed_resultados. Equivocarse acá no es un bug de pantalla:
 * es una cita que se da por atendida sin serlo, o una nota mala que nunca
 * escala a una persona.
 */

// ── Los casos que SÍ deben reconocerse ─────────────────────────────────────

test("números solos, 1 a 5", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.equal(detectarNota(String(n)), n, `nota ${n}`);
  }
});

test("con la decoración natural con la que la gente contesta", () => {
  const casos = {
    "5!": 5,
    "5.": 5,
    "un 4": 4,
    "una 5": 5,
    "le doy un 5": 5,
    "4/5": 4,
    "5 estrellas": 5,
    "5 estrella": 5,
    "nota 3": 3,
    "  5  ": 5,
    "5⭐⭐⭐⭐⭐": 5,
    "5*": 5,
  };
  for (const [texto, esperado] of Object.entries(casos)) {
    assert.equal(detectarNota(texto), esperado, `texto: "${texto}"`);
  }
});

test("mayúsculas y variantes no rompen el reconocimiento", () => {
  assert.equal(detectarNota("NOTA 5"), 5);
  assert.equal(detectarNota("Un 4"), 4);
});

// ── ⭐⭐ Los casos que NO deben reconocerse: fail-closed ────────────────────

test("⭐⭐ un número dentro de una frase NO es una nota", () => {
  // Es la trampa central: contiene un dígito 1-5 pero no está contestando la
  // escala. Si esto se leyera como nota, cerraríamos citas mal y perderíamos
  // el aviso de un cliente molesto.
  for (const texto of [
    "tuve 2 problemas con el servicio",
    "llegaron 5 personas",
    "necesito 3 cotizaciones más",
    "el 5 de septiembre puedo",
    "5 minutos y listo",
  ]) {
    assert.equal(detectarNota(texto), null, `texto: "${texto}"`);
  }
});

test("un 5 con un comentario detrás NO se reconoce (eso ya es para el modelo)", () => {
  assert.equal(detectarNota("5, pero se demoraron mucho"), null);
  assert.equal(detectarNota("le doy un 5 aunque llegaron tarde"), null);
});

test("fuera del rango 1-5 no cuenta", () => {
  for (const texto of ["0", "6", "7", "10", "-1"]) {
    assert.equal(detectarNota(texto), null, `texto: "${texto}"`);
  }
});

test("vacío, muy largo, o sin dígito → null", () => {
  for (const texto of ["", "   ", "hola", "gracias por todo, estuvo increíble el servicio"]) {
    assert.equal(detectarNota(texto), null, `texto: "${texto}"`);
  }
});

test("null/undefined no revientan la función", () => {
  assert.equal(detectarNota(null), null);
  assert.equal(detectarNota(undefined), null);
});

// ── Mala vs buena ────────────────────────────────────────────────────────

test("1, 2 y 3 son nota mala; 4 y 5 no", () => {
  assert.equal(esNotaMala(1), true);
  assert.equal(esNotaMala(2), true);
  assert.equal(esNotaMala(3), true);
  assert.equal(esNotaMala(4), false);
  assert.equal(esNotaMala(5), false);
});

// ── El texto de respuesta ───────────────────────────────────────────────

test("nota mala nunca defiende al negocio ni promete nada", () => {
  const t = textoRespuestaEncuesta(2);
  assert.match(t, /Lamento/);
  assert.doesNotMatch(t, /descuento|reembolso|compensa/i);
});

test("nota buena agradece y no ofrece un link de reseña que no existe", () => {
  for (const n of [4, 5]) {
    const t = textoRespuestaEncuesta(n);
    assert.match(t, /[Gg]racias/);
    assert.doesNotMatch(t, /http|www\./);
  }
});

test("los cinco valores producen texto distinto de vacío", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const t = textoRespuestaEncuesta(n);
    assert.ok(t.length > 10, `nota ${n}`);
  }
});
