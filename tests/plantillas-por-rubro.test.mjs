import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANTILLAS,
  PLANTILLA_POR_TIPO,
  plantillasParaRubro,
  validarCuerpo,
} from "../lib/plantillas.ts";

/**
 * El catálogo era UNO SOLO para todos los clientes, y se había armado pensando
 * en RS-Shop (motos). Al conectar Impresora Color quedó a la vista: una imprenta
 * NO agenda horas, así que 4 de las 7 no le servían — y una de las inútiles era
 * de categoría marketing (~$85 por envío).
 *
 * Crear plantillas de más no rompe nada, pero ensucia el portafolio de Meta de
 * un cliente real y deja ver que no pensamos su caso.
 */

const nombres = (rubro) => plantillasParaRubro(rubro).map((p) => p.nombre).sort();

test("⭐ una imprenta NO recibe las plantillas de cita", () => {
  const n = nombres("imprenta");
  assert.ok(!n.includes("cita_confirmacion"), n.join(", "));
  assert.ok(!n.includes("cita_recordatorio"), n.join(", "));
});

test("⭐ una imprenta NO recibe las de motos", () => {
  const n = nombres("imprenta");
  for (const m of ["moto_lista", "repuesto_llego", "mantencion_toca"]) {
    assert.ok(!n.includes(m), `${m} no debería estar: ${n.join(", ")}`);
  }
});

test("una imprenta SÍ recibe pedido listo y encargo llegó", () => {
  const n = nombres("imprenta");
  assert.ok(n.includes("pedido_listo"), n.join(", "));
  assert.ok(n.includes("encargo_llego"), n.join(", "));
});

test("las universales llegan a todos los rubros", () => {
  for (const r of ["imprenta", "motos", "dental", "estetica", "tienda"]) {
    const n = nombres(r);
    assert.ok(n.includes("encuesta_postventa"), `${r}: ${n.join(", ")}`);
    assert.ok(n.includes("cotizacion_pendiente"), `${r}: ${n.join(", ")}`);
  }
});

test("un negocio de motos sigue recibiendo las suyas", () => {
  // No romper lo de RS-Shop al abrir el catálogo por rubro.
  const n = nombres("motos");
  for (const m of ["moto_lista", "repuesto_llego", "mantencion_toca", "cita_confirmacion"]) {
    assert.ok(n.includes(m), `falta ${m}: ${n.join(", ")}`);
  }
});

test("⭐ sin rubro se devuelven SOLO las universales, no todas", () => {
  // Ante la duda, de menos: crear de más deja cosas ajenas en el WABA de alguien.
  for (const r of ["", null, undefined, "   "]) {
    const n = nombres(r);
    assert.deepEqual(n, ["cotizacion_pendiente", "encuesta_postventa"], `rubro: ${r}`);
  }
});

test("el rubro no distingue mayúsculas ni espacios", () => {
  assert.deepEqual(nombres("Imprenta"), nombres("imprenta"));
  assert.deepEqual(nombres("  imprenta  "), nombres("imprenta"));
});

test("un rubro desconocido no revienta: caen las universales", () => {
  assert.deepEqual(nombres("veterinaria"), ["cotizacion_pendiente", "encuesta_postventa"]);
});

// ── Las nuevas cumplen las reglas de Meta ───────────────────────────────────

test("pedido_listo y encargo_llego pasan la validación de Meta", () => {
  // Si el cuerpo rompe una regla, Meta rechaza el alta y el motivo no siempre
  // dice cuál. Mejor detectarlo acá.
  for (const n of ["pedido_listo", "encargo_llego"]) {
    assert.deepEqual(validarCuerpo(PLANTILLAS[n]), [], n);
  }
});

test("las dos nuevas son UTILITY, no marketing", () => {
  // Continúan algo que el cliente ya inició, así que son baratas y gratis dentro
  // de las 24 h. Si alguna termina en marketing, el costo se multiplica por ~5.
  assert.equal(PLANTILLAS.pedido_listo.categoria, "utility");
  assert.equal(PLANTILLAS.encargo_llego.categoria, "utility");
});

test("los tipos nuevos están mapeados a su plantilla", () => {
  // Sin esto, el envío falla con 132001 aunque la plantilla exista en Meta.
  assert.equal(PLANTILLA_POR_TIPO.pedido_listo, "pedido_listo");
  assert.equal(PLANTILLA_POR_TIPO.encargo_llego, "encargo_llego");
});

test("⚠️ todo tipo mapeado apunta a una plantilla que existe", () => {
  for (const [tipo, nombre] of Object.entries(PLANTILLA_POR_TIPO)) {
    assert.ok(PLANTILLAS[nombre], `el tipo "${tipo}" apunta a "${nombre}", que no existe`);
  }
});
