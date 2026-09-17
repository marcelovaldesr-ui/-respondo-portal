import assert from "node:assert/strict";
import test from "node:test";

import {
  conservarCorreccionesPerfil,
  perfilMarketingDemo,
} from "../lib/marketing/perfilMarketingCore.ts";
import { contextoComercialDemo } from "../lib/marketing/demo.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REPRODUCCIÓN ANTES DE FIX — BUGS CRÍTICOS CRIT-01, CRIT-02, CRIT-03
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── REPRO CRIT-03: Overrides tri-state y zombificación ─────────────────────
test("REPRO CRIT-03: productosFoco = [] explícito no debe resucitar los inferidos", () => {
  const viejo = perfilMarketingDemo();
  // El usuario borró intencionalmente los productos foco
  viejo.marketing.productosFoco = [];

  const nuevo = perfilMarketingDemo();
  nuevo.marketing.productosFoco = ["Gigantografía PVC", "Pendón roller"];

  const fusionado = conservarCorreccionesPerfil(nuevo, viejo);

  // DEBE ser [] porque el usuario lo dejó vacío conscientemente.
  // El código actual evalúa .length (0 es falsy) y resucita nuevo.marketing.productosFoco.
  assert.deepEqual(fusionado.marketing.productosFoco, [], "productosFoco [] fue sobreescrito por el inferido");
});

test("REPRO CRIT-03: elementosProhibidos = [] explícito no debe resucitar prohibiciones previas", () => {
  const viejo = perfilMarketingDemo();
  // El usuario eliminó conscientemente todas las restricciones de marca
  viejo.brand.elementosProhibidos = [];

  const nuevo = perfilMarketingDemo();
  nuevo.brand.elementosProhibidos = ["mockups con texto inventado", "logos ajenos"];

  const fusionado = conservarCorreccionesPerfil(nuevo, viejo);

  // DEBE ser [] porque el usuario eliminó las prohibiciones.
  // El código actual hace new Set([...viejo, ...nuevo]) y resucita los de nuevo.
  assert.deepEqual(fusionado.brand.elementosProhibidos, [], "elementosProhibidos [] fue zombificado por el Set union");
});

test("REPRO CRIT-03: prioridadActual = null explícito no debe resucitar prioridad inferida", () => {
  const viejo = perfilMarketingDemo();
  // El usuario eliminó conscientemente la prioridad comercial
  viejo.marketing.prioridadActual = null;

  const nuevo = perfilMarketingDemo();
  nuevo.marketing.prioridadActual = "Prioridad inferida automáticamente";

  const fusionado = conservarCorreccionesPerfil(nuevo, viejo);

  // DEBE ser null porque el usuario borró la prioridad.
  // El código actual hace viejo ?? nuevo y resucita nuevo cuando viejo es null.
  assert.equal(fusionado.marketing.prioridadActual, null, "prioridadActual null fue zombificada por ??");
});

// ── REPRO CRIT-02: Preservación de documento.perfil al fusionar contexto ──
test("REPRO CRIT-02: fusionarDocumentoConPerfil conserva ramas business/brand/marketing y perfil", async () => {
  const { fusionarDocumentoConPerfil } = await import("../lib/marketing/contextoComercial.ts");

  const documentoCompleto = {
    ...contextoComercialDemo(),
    business: { nombre: "Mi Negocio", tipoNegocio: "b2b" },
    brand: { elementosProhibidos: ["prohibicion-1"] },
    marketing: { prioridadActual: "Gran Venta", productosFoco: ["Producto A"] },
    invalidation: { stale: false, fichasHash: "hash-1" },
    perfil: {
      business: { nombre: "Mi Negocio", tipoNegocio: "b2b" },
      brand: { elementosProhibidos: ["prohibicion-1"] },
      marketing: { prioridadActual: "Gran Venta", productosFoco: ["Producto A"] },
      invalidation: { stale: false, fichasHash: "hash-1" },
    },
  };

  const contextoEditadoPorUsuario = {
    ...contextoComercialDemo(),
    audiencia: { descripcion: "Nueva audiencia corregida", rubros: [] },
  };

  const fusionado = fusionarDocumentoConPerfil(documentoCompleto, contextoEditadoPorUsuario, true);

  assert.ok(fusionado.business, "fusionado debe contener business");
  assert.ok(fusionado.brand, "fusionado debe contener brand");
  assert.ok(fusionado.marketing, "fusionado debe contener marketing");
  assert.ok(fusionado.perfil, "fusionado debe contener perfil");
  assert.equal(fusionado.audiencia.descripcion, "Nueva audiencia corregida");
});

// ── REPRO CRIT-01: generarCopy sin contexto usa proyeccionCreative ────────
test("REPRO CRIT-01: proyeccionCreative de obtenerPerfilMarketing proyecta la prioridad y productos foco", async () => {
  const { obtenerPerfilMarketing, proyeccionCreative } = await import("../lib/marketing/perfilMarketing.ts");
  const perfil = await obtenerPerfilMarketing("demo-cliente-000", { demo: true });
  const creativeCtx = proyeccionCreative(perfil);

  const tienePrioridad = creativeCtx.diferenciadores.some((d) => d.includes("Prioridad comercial actual:"));
  assert.equal(tienePrioridad, true, "proyeccionCreative debe inyectar la prioridad comercial");

  const tieneFoco = creativeCtx.diferenciadores.some((d) => d.includes("Productos foco:"));
  assert.equal(tieneFoco, true, "proyeccionCreative debe inyectar los productos foco");
});
