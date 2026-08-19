import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANTILLAS,
  PLANTILLA_POR_TIPO,
  plantillaPara,
  render,
  limpiarParam,
  validarCuerpo,
} from "../lib/plantillas.ts";

/**
 * Plantillas de Meta.
 *
 * Estas pruebas existen porque el ciclo de error de una plantilla es carísimo:
 * se manda a revisión, Meta se demora horas, y el rechazo llega con un motivo
 * genérico. Todo lo que Meta valida y se puede validar acá, se valida acá.
 *
 * De hecho ya sirvió: al escribirlas cazó que cita_confirmacion y
 * cita_recordatorio terminaban con la variable del enlace, cosa que Meta
 * rechaza.
 */

test("todos los cuerpos cumplen las reglas de Meta", () => {
  for (const [clave, p] of Object.entries(PLANTILLAS)) {
    assert.deepEqual(validarCuerpo(p), [], `${clave}: ${validarCuerpo(p).join(" · ")}`);
    assert.equal(clave, p.nombre, `la clave ${clave} no calza con el nombre ${p.nombre}`);
  }
});

test("el validador detecta un cuerpo que termina en variable", () => {
  const malo = {
    nombre: "prueba",
    idioma: "es",
    categoria: "utility",
    cuerpo: "Hola, tu hora es {{1}}",
    variables: ["hora"],
    ejemplos: ["10:00"],
  };
  assert.ok(validarCuerpo(malo).some((e) => e.includes("terminar")));
});

test("el validador detecta variables pegadas y numeración con saltos", () => {
  const pegadas = {
    nombre: "prueba",
    idioma: "es",
    categoria: "utility",
    cuerpo: "Hola {{1}}{{2}} listo",
    variables: ["a", "b"],
    ejemplos: ["x", "y"],
  };
  assert.ok(validarCuerpo(pegadas).some((e) => e.includes("pegadas")));

  const salto = {
    nombre: "prueba",
    idioma: "es",
    categoria: "utility",
    cuerpo: "Hola {{1}} y {{3}} listo",
    variables: ["a", "b"],
    ejemplos: ["x", "y"],
  };
  assert.ok(validarCuerpo(salto).some((e) => e.includes("numeración")));
});

test("cada tipo de seguimiento encuentra su plantilla", () => {
  for (const [tipo, nombre] of Object.entries(PLANTILLA_POR_TIPO)) {
    assert.equal(plantillaPara(tipo)?.nombre, nombre);
  }
  assert.equal(plantillaPara("texto_libre"), null);
  assert.equal(plantillaPara("no_existe"), null);
});

test("render sustituye todas las variables", () => {
  const p = PLANTILLAS.cita_recordatorio;
  const texto = render(p.cuerpo, p.ejemplos);
  assert.ok(texto);
  assert.ok(!texto.includes("{{"), "quedaron llaves sin reemplazar");
  for (const v of p.ejemplos) assert.ok(texto.includes(v), `falta el valor ${v}`);
});

test("render se niega si falta un parámetro o viene vacío", () => {
  const c = PLANTILLAS.cita_recordatorio.cuerpo;
  assert.equal(render(c, ["Ana", "mantención"]), null, "aceptó parámetros de menos");
  assert.equal(render(c, ["Ana", "", "10:00", "url"]), null, "aceptó un parámetro vacío");
  assert.equal(render(c, ["Ana", "   ", "10:00", "url"]), null, "aceptó un parámetro en blanco");
});

test("limpiarParam saca lo que Meta rechaza en un valor", () => {
  assert.equal(limpiarParam("Juan\nPérez"), "Juan Pérez");
  assert.equal(limpiarParam("KTM\t390"), "KTM 390");
  assert.equal(limpiarParam("a    b"), "a b");
  assert.equal(limpiarParam("  hola  "), "hola");
  assert.equal(limpiarParam(null), "");
  assert.equal(limpiarParam(undefined), "");
});

test("el texto que guarda el portal es el mismo cuerpo aprobado", () => {
  // Es la garantía central del diseño: si esto se rompe, el cliente ve en su
  // teléfono algo distinto de lo que el negocio ve en el portal.
  for (const [clave, p] of Object.entries(PLANTILLAS)) {
    const params = p.ejemplos.map(limpiarParam);
    let esperado = p.cuerpo;
    params.forEach((v, i) => {
      esperado = esperado.replaceAll(`{{${i + 1}}}`, v);
    });
    assert.equal(render(p.cuerpo, params), esperado, clave);
  }
});

test("solo la reactivación va como marketing", () => {
  // El resto continúa una transacción que el cliente ya inició, y por eso es
  // utilidad: ≈$18 en vez de ≈$85 por mensaje.
  const marketing = Object.values(PLANTILLAS)
    .filter((p) => p.categoria === "marketing")
    .map((p) => p.nombre);
  assert.deepEqual(marketing, ["mantencion_toca"]);
});

test("la plantilla de reactivación ofrece salida", () => {
  // Meta lo mira al revisar plantillas de marketing, y además corresponde.
  assert.ok(PLANTILLAS.mantencion_toca.cuerpo.includes("BAJA"));
});
