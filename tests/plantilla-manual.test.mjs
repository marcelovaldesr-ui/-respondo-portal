import assert from "node:assert/strict";
import test from "node:test";

import { PLANTILLAS, render, limpiarParam } from "../lib/plantillas.ts";

/**
 * ENVIAR UNA PLANTILLA A MANO DESDE LA BANDEJA.
 *
 * Esto es lo único que se puede mandar cuando pasaron 24 h desde el último
 * mensaje del cliente. Si el texto sale mal armado, Meta lo rechaza con un
 * código numérico y la persona se queda sin poder retomar la conversación —
 * justo en el momento en que más lo necesita.
 */

test("el texto que se manda no deja ningún hueco sin llenar", () => {
  // Un {{2}} que llegue al teléfono de un cliente es lo peor que puede pasar
  // acá: se ve como un error de sistema en medio de una conversación de venta.
  for (const p of Object.values(PLANTILLAS)) {
    const params = p.variables.map((_, i) => `valor${i + 1}`);
    const texto = render(p.cuerpo, params);
    assert.ok(texto, `${p.nombre} debería renderizar`);
    assert.doesNotMatch(texto, /\{\{\d+\}\}/, `${p.nombre} dejó un hueco sin reemplazar`);
  }
});

test("falta un dato → no se manda nada", () => {
  const p = PLANTILLAS.cita_confirmacion;
  assert.equal(render(p.cuerpo, ["Cristian"]), null, "con menos datos debe negarse");
});

test("un dato vacío o en blanco → no se manda nada", () => {
  // Meta rechaza los parámetros vacíos, así que conviene cortarlo antes: el
  // error de Meta no explica cuál faltaba.
  const p = PLANTILLAS.cita_confirmacion;
  const conVacio = p.variables.map((_, i) => (i === 1 ? "" : "x"));
  assert.equal(render(p.cuerpo, conVacio), null);
  const conEspacios = p.variables.map((_, i) => (i === 1 ? "   " : "x"));
  assert.equal(render(p.cuerpo, conEspacios), null);
});

test("los saltos de línea en un dato se limpian", () => {
  // El error 132012 de Meta es exactamente esto: un parámetro con saltos de
  // línea o espacios de más. Pasa al pegar texto desde otro lado.
  assert.equal(limpiarParam("Juan\nPérez"), "Juan Pérez");
  assert.equal(limpiarParam("  con    espacios  "), "con espacios");
  assert.equal(limpiarParam("con\ttab"), "con tab");
});

test("cada plantilla declara tantos ejemplos como variables", () => {
  // El selector usa los ejemplos como pista en cada campo. Si faltan, la persona
  // ve un campo sin ninguna referencia de qué escribir.
  for (const p of Object.values(PLANTILLAS)) {
    assert.equal(
      p.ejemplos.length,
      p.variables.length,
      `${p.nombre}: ${p.ejemplos.length} ejemplos para ${p.variables.length} variables`,
    );
  }
});

test("las variables van numeradas de 1 a N, sin saltos", () => {
  // Meta rechaza el alta si la numeración tiene huecos, y el error aparece
  // recién al crear la plantilla en el WABA de un cliente real.
  for (const p of Object.values(PLANTILLAS)) {
    const nums = [...p.cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const unicos = [...new Set(nums)].sort((a, b) => a - b);
    assert.deepEqual(
      unicos,
      unicos.map((_, i) => i + 1),
      `${p.nombre} tiene la numeración con saltos: ${unicos.join(",")}`,
    );
    assert.equal(unicos.length, p.variables.length, `${p.nombre}: variables declaradas ≠ usadas`);
  }
});
