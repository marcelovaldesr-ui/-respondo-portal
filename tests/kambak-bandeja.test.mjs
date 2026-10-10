/** Plantillas que ofrece la bandeja: Kambak ve las suyas y nadie más las ve. */
import assert from "node:assert/strict";
import test from "node:test";
import { plantillasParaRubro, PLANTILLAS, render, validarCuerpo } from "../lib/plantillas.ts";

test("la bandeja de Kambak ofrece sus 5 avisos y no el código de verificación", () => {
  const nombres = plantillasParaRubro("fidelizacion").map((p) => p.nombre).sort();
  assert.deepEqual(nombres, ["sello_cerca", "sello_evento", "sello_premio_cerca", "sello_promo", "sello_rescate"]);
});

test("ningún otro rubro ve las plantillas de Kambak, ni se cuelan en el catálogo general", () => {
  for (const rubro of ["imprenta", "motos", "dental", "estetica", "", null, undefined]) {
    assert.ok(!plantillasParaRubro(rubro).some((p) => p.nombre.startsWith("sello_")), String(rubro));
  }
  assert.ok(!Object.keys(PLANTILLAS).some((n) => n.startsWith("sello_")));
});

test("las plantillas de la bandeja pasan las mismas reglas de Meta y se pueden vista-previa", () => {
  for (const p of plantillasParaRubro("fidelizacion")) {
    assert.deepEqual(validarCuerpo(p), [], p.nombre);
    assert.ok(render(p.cuerpo, p.ejemplos), p.nombre);
  }
});
