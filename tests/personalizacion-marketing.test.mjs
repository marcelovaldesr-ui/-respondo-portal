import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTORIDAD,
  evaluarOfertasTemporales,
  conservarCorreccionesPerfil,
  proyeccionCreative,
  proyeccionArchitect,
  proyeccionCopiloto,
  proyeccionContextoMarca,
  perfilMarketingDemo,
} from "../lib/marketing/perfilMarketingCore.ts";
import { PREFIJO, rutaDeImagen, rutaEsDelCliente } from "../lib/marketing/imagenes.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRUEBAS DE PERSONALIZACIÓN PROFUNDA DE MARKETING V1
 *
 * Valida la unificación de la verdad comercial de cada negocio:
 *   1. Un solo cerebro (catálogo idéntico en creatividades, arquitecto y copiloto)
 *   2. Jerarquía de procedencia (DECLARADO > CATALOGO > CONOCIMIENTO > INFERIDO)
 *   3. Prioridades de marketing sin mutilar el catálogo
 *   4. Temporalidad y ofertas expiradas (nunca anunciadas)
 *   5. Preservación de correcciones humanas en reconstrucciones JIT
 *   6. Aislamiento Customer Zero (Respondo vs Impresora Color vs AyP Abogados)
 *   7. Mitigación definitiva de Bugs A y B de Master Context
 * ═══════════════════════════════════════════════════════════════════════════
 */

function fixtureBase(clienteId = "cliente-test-01") {
  return {
    clienteId,
    business: {
      nombre: "Impresora Color Chillán",
      rubro: "Imprenta y Gigantografías",
      categoria: "Imprenta",
      sitioWeb: "https://impresoracolor.cl",
      ubicacion: "Chillán",
      cobertura: "Región de Ñuble",
      tipoNegocio: "b2b",
      whatsappConectado: true,
    },
    brand: {
      logoUrl: null,
      paletaColores: { primario: "#0284c7" },
      estiloVisual: "Fotografía publicitaria de talleres y corte real.",
      elementosProhibidos: ["mockups genéricos", "afirmar entregas en 1 hora no confirmadas"],
    },
    commercial: {
      negocio: { nombre: "Impresora Color Chillán", rubro: "Imprenta", zona: "Chillán", sitio: null },
      vende: [
        { nombre: "Pendón roller 80×200", tipo: "producto", detalle: "Aluminio con bolso", precio: "$34.990", fuente: "catalogo" },
        { nombre: "Tarjetas couché 350g", tipo: "producto", detalle: "1000 unidades", precio: "$19.990", fuente: "catalogo" },
        { nombre: "Gigantografía PVC", tipo: "producto", detalle: "Por m² resistente al agua", precio: null, fuente: "catalogo" },
      ],
      capacidades: ["Entrega express 24h", "Diseño gráfico incluido"],
      audiencia: { descripcion: "Pymes y organizadores de eventos", rubros: ["comercio", "eventos"] },
      propuesta: { problema: "Necesitan material urgente para el fin de semana", resultado: "Entrega en 24h con diseño resuelto" },
      diferenciadores: ["Diseño incluido sin cobro extra"],
      ofertas: [{ texto: "Pendón roller en 24h", fuente: "conocimiento", reserva: null }],
      pruebas: [{ texto: "Más de 25 años en Chillán", fuente: "conocimiento", reserva: null }],
      voz: { formalidad: "tu", energia: "directo", emojis: "ocasional", modismos: "chilenismos_leves", vocabulario: [], frasesProhibidas: [], origen: "inferida" },
      noAfirmar: ["No prometer despacho a Santiago gratis"],
      vocabularioCliente: ["roller para feria", "pendón express"],
      fuentes: [{ rol: "catalogo", titulo: "Lista de precios", motivo: "precios tienda" }],
      descartados: [],
    },
    marketing: {
      prioridadActual: "Lanzar campaña de pendones para ferias",
      productosFoco: ["Pendón roller 80×200"],
      segmentosObjetivo: ["Empresas locales"],
      canalesPreferidos: ["meta", "google"],
      metaConversion: "cotizaciones",
      ofertasTemporales: [
        {
          id: "oferta-1",
          titulo: "20% off en segundo pendón",
          detalle: "Válido llevando 2 unidades",
          expiraEn: "2030-01-01",
          activo: true,
          fuente: "declarado",
        },
        {
          id: "oferta-expirada",
          titulo: "Promo Cyber Pasada",
          detalle: "Descuento antiguo",
          expiraEn: "2020-01-01",
          activo: true,
          fuente: "declarado",
        },
      ],
    },
    invalidation: {
      stale: false,
      razonStale: null,
      fichasHash: "hash-inicial",
      ultimoCalculo: "2026-09-01T00:00:00.000Z",
    },
    editado: false,
    actualizadoEn: "2026-09-01T00:00:00.000Z",
  };
}

/* ── 1. UN SOLO CEREBRO — MISMO CATÁLOGO EN TODOS LOS CONSUMIDORES ───────── */

test("todos los módulos ven exactamente el mismo catálogo de productos y servicios", () => {
  const perfil = fixtureBase();

  const creative = proyeccionCreative(perfil);
  const architect = proyeccionArchitect(perfil);
  const copiloto = proyeccionCopiloto(perfil);
  const marca = proyeccionContextoMarca(perfil);

  const nombresVende = perfil.commercial.vende.map((v) => v.nombre);

  // Creative Studio ve todos los productos
  assert.equal(creative.vende.length, 3);
  for (const n of nombresVende) {
    assert.ok(creative.vende.some((v) => v.nombre === n), `Creative no ve ${n}`);
  }

  // Architect ve todos los productos en su catálogo de texto
  for (const n of nombresVende) {
    assert.ok(architect.contextoTexto.includes(n), `Architect no incluye ${n}`);
  }

  // Copiloto ve todos los productos en su lista de resumen y en su texto
  assert.deepEqual(copiloto.perfilResumido.productos.sort(), [...nombresVende].sort());
  for (const n of nombresVende) {
    assert.ok(copiloto.contextoTexto.includes(n), `Copiloto no incluye ${n}`);
  }

  // Legacy ContextoMarca proyecta la misma lista como ofertas
  assert.equal(marca.ofertas.length, 3);
  assert.deepEqual(marca.ofertas.map((o) => o.titulo).sort(), [...nombresVende].sort());
});

/* ── 2. JERARQUÍA DE PROCEDENCIA ─────────────────────────────────────────── */

test("la jerarquía de autoridad coloca a DECLARADO sobre CATALOGO e INFERIDO", () => {
  assert.ok(AUTORIDAD.declarado > AUTORIDAD.catalogo);
  assert.ok(AUTORIDAD.catalogo > AUTORIDAD.conocimiento);
  assert.ok(AUTORIDAD.conocimiento > AUTORIDAD.publicidad);
  assert.ok(AUTORIDAD.publicidad > AUTORIDAD.conversaciones);
  assert.ok(AUTORIDAD.conversaciones > AUTORIDAD.inferido);
  assert.equal(AUTORIDAD.inferido, 10, "inferido debe ser la fuente más débil (10)");
  assert.equal(AUTORIDAD.declarado, 100, "declarado debe ser la fuente suprema (100)");
});

/* ── 3. PRIORIDADES DE MARKETING NO MUTILAN EL CATÁLOGO ──────────────────── */

test("establecer un producto foco altera el orden de prioridad sin borrar productos", () => {
  const perfil = fixtureBase();
  perfil.marketing.productosFoco = ["Gigantografía PVC"]; // El último en la lista original

  const creative = proyeccionCreative(perfil);

  // Debe seguir teniendo los 3 productos originales
  assert.equal(creative.vende.length, 3);
  // Pero el foco ahora está en la primera posición
  assert.equal(creative.vende[0].nombre, "Gigantografía PVC");
  // Y la prioridad se inyecta en diferenciadores
  assert.ok(creative.diferenciadores.some((d) => d.includes("Lanzar campaña de pendones")));
});

/* ── 4. TEMPORALIDAD Y OFERTAS EXPIRADAS ──────────────────────────────────── */

test("las ofertas temporales expiradas se desactivan y nunca llegan a las proyecciones", () => {
  const perfil = fixtureBase();
  const fechaHoy = new Date("2026-09-15T00:00:00.000Z");

  const evaluadas = evaluarOfertasTemporales(perfil.marketing.ofertasTemporales, fechaHoy);

  const activa = evaluadas.find((o) => o.id === "oferta-1");
  const caduca = evaluadas.find((o) => o.id === "oferta-expirada");

  assert.equal(activa?.activo, true);
  assert.equal(caduca?.activo, false);

  const creative = proyeccionCreative(perfil);
  // La oferta activa sí entra en ofertas
  assert.ok(creative.ofertas.some((o) => o.texto.includes("20% off en segundo pendón")));
  // La oferta expirada NO entra en ofertas
  assert.ok(!creative.ofertas.some((o) => o.texto.includes("Promo Cyber Pasada")));
});

/* ── 5. PRESERVACIÓN DE CORRECCIONES HUMANAS TRAS RECONSTRUCCIÓN JIT ─────── */

test("conservarCorreccionesPerfil preserva ediciones humanas y prioridades al reconstruir", () => {
  const viejo = fixtureBase();
  viejo.editado = true;
  viejo.business.categoria = "Impresión Digital Gran Formato";
  viejo.marketing.prioridadActual = "Feria Navideña";
  viejo.commercial.vende = [
    { nombre: "Pendón corregido por humano", tipo: "producto", detalle: "Especial", precio: "$40.000", fuente: "declarado" },
  ];
  viejo.commercial.propuesta.problema = "Problema corregido por humano";

  const reconstruido = fixtureBase();
  // El reconstruido viene con los datos crudos del scraper/conocimiento
  reconstruido.business.categoria = "Imprenta";
  reconstruido.marketing.prioridadActual = null;
  reconstruido.commercial.propuesta.problema = "Problema genérico inferido";

  const fusionado = conservarCorreccionesPerfil(reconstruido, viejo);

  assert.equal(fusionado.business.categoria, "Impresión Digital Gran Formato");
  assert.equal(fusionado.marketing.prioridadActual, "Feria Navideña");
  assert.equal(fusionado.commercial.vende[0].nombre, "Pendón corregido por humano");
  assert.equal(fusionado.commercial.propuesta.problema, "Problema corregido por humano");
  assert.equal(fusionado.editado, true);
});

/* ── 6. AISLAMIENTO CUSTOMER ZERO (RESPONDO vs IMPRESORA vs AYP) ─────────── */

test("Customer Zero: tres negocios reales tienen perfiles y restricciones totalmente aislados", () => {
  const perfilRespondo = {
    clienteId: "cliente-respondo-saas",
    business: {
      nombre: "Respondo",
      rubro: "Software y Automatización de Ventas",
      categoria: "SaaS B2B",
      sitioWeb: "https://respondo.io",
      ubicacion: "Santiago",
      cobertura: "Nacional / Hispanoamérica",
      tipoNegocio: "b2b",
      whatsappConectado: true,
    },
    brand: {
      logoUrl: null,
      paletaColores: { primario: "#4f46e5" },
      estiloVisual: "Capturas limpias de producto, diseño SaaS moderno.",
      elementosProhibidos: ["promesas de enriquecimiento rápido", "logos de competidores"],
    },
    commercial: {
      negocio: { nombre: "Respondo", rubro: "Software", zona: "Santiago", sitio: null },
      vende: [{ nombre: "Plan Profesional Respondo", tipo: "plan", detalle: "Automatización de WhatsApp", precio: "$49.990/mes", fuente: "declarado" }],
      capacidades: ["Integración WABA oficial", "IA Tino para ventas"],
      audiencia: { descripcion: "Dueños de pymes que venden por chat", rubros: ["servicios", "comercio"] },
      propuesta: { problema: "Pierden ventas por responder tarde", resultado: "Atención 24/7 y cotizaciones instantáneas" },
      diferenciadores: ["No requiere programación"],
      ofertas: [{ texto: "Prueba 14 días gratis", fuente: "declarado", reserva: null }],
      pruebas: [{ texto: "Más de 500.000 mensajes gestionados", fuente: "declarado", reserva: "no prometer tasa fija de cierre" }],
      voz: { formalidad: "tu", energia: "directo", emojis: "ocasional", modismos: "neutro", vocabulario: [], frasesProhibidas: [], origen: "declarada" },
      noAfirmar: ["No afirmar que reemplaza a todo el equipo humano"],
      vocabularioCliente: ["bot para wsp", "atención automática"],
      fuentes: [],
      descartados: [],
    },
    marketing: {
      prioridadActual: "Adquisición de pymes de servicios profesionales",
      productosFoco: ["Plan Profesional Respondo"],
      segmentosObjetivo: ["Consultorías", "Clínicas"],
      canalesPreferidos: ["meta", "google"],
      metaConversion: "pruebas_gratuitas",
      ofertasTemporales: [],
    },
    invalidation: { stale: false, razonStale: null, fichasHash: "h1", ultimoCalculo: "2026-09-15T00:00:00Z" },
    editado: false,
    actualizadoEn: "2026-09-15T00:00:00Z",
  };

  const perfilImpresora = fixtureBase("cliente-impresora-chillan");

  const perfilAyP = {
    clienteId: "cliente-ayp-abogados",
    business: {
      nombre: "AyP Abogados",
      rubro: "Estudio Jurídico Laboral y Civil",
      categoria: "Servicios Legales",
      sitioWeb: "https://aypabogados.cl",
      ubicacion: "Concepción",
      cobertura: "Región del Biobío",
      tipoNegocio: "b2b",
      whatsappConectado: true,
    },
    brand: {
      logoUrl: null,
      paletaColores: { primario: "#0f172a" },
      estiloVisual: "Fotografía sobria, oficina legal, luz natural.",
      elementosProhibidos: ["promesas de ganar juicios", "sensacionalismo", "iconografía de martillo de juez"],
    },
    commercial: {
      negocio: { nombre: "AyP Abogados", rubro: "Servicios Legales", zona: "Concepción", sitio: null },
      vende: [{ nombre: "Asesoría Despido Injustificado", tipo: "servicio", detalle: "Representación laboral", precio: "Honorario a resultado", fuente: "declarado" }],
      capacidades: ["Litigación en tribunales", "Mediación previa"],
      audiencia: { descripcion: "Trabajadores y empresas de la zona", rubros: ["laboral"] },
      propuesta: { problema: "Conflictos laborales sin asesoría experta", resultado: "Defensa jurídica rigurosa" },
      diferenciadores: ["Primera consulta de evaluación"],
      ofertas: [],
      pruebas: [{ texto: "Abogados titulados Universidad de Concepción", fuente: "declarado", reserva: null }],
      voz: { formalidad: "usted", energia: "calmo", emojis: "nunca", modismos: "neutro", vocabulario: [], frasesProhibidas: [], origen: "declarada" },
      noAfirmar: ["Código de ética: prohibido garantizar resultados judiciales"],
      vocabularioCliente: ["demanda por despido", "finiquito"],
      fuentes: [],
      descartados: [],
    },
    marketing: {
      prioridadActual: "Causas de tutela laboral",
      productosFoco: ["Asesoría Despido Injustificado"],
      segmentosObjetivo: ["Profesionales y técnicos"],
      canalesPreferidos: ["google"],
      metaConversion: "consultas",
      ofertasTemporales: [],
    },
    invalidation: { stale: false, razonStale: null, fichasHash: "h2", ultimoCalculo: "2026-09-15T00:00:00Z" },
    editado: false,
    actualizadoEn: "2026-09-15T00:00:00Z",
  };

  // Verificación de aislamiento absoluto
  assert.notEqual(perfilRespondo.clienteId, perfilImpresora.clienteId);
  assert.notEqual(perfilImpresora.clienteId, perfilAyP.clienteId);

  // Canales preferidos distintos
  assert.deepEqual(perfilAyP.marketing.canalesPreferidos, ["google"]);
  assert.deepEqual(perfilRespondo.marketing.canalesPreferidos, ["meta", "google"]);

  // Prohibiciones éticas de abogados no contaminan a la imprenta ni al SaaS
  const crRespondo = proyeccionCreative(perfilRespondo);
  const crImpresora = proyeccionCreative(perfilImpresora);
  const crAyP = proyeccionCreative(perfilAyP);

  assert.ok(crAyP.noAfirmar.some((n) => n.includes("garantizar resultados judiciales")));
  assert.ok(!crRespondo.noAfirmar.some((n) => n.includes("garantizar resultados judiciales")));
  assert.ok(!crImpresora.noAfirmar.some((n) => n.includes("garantizar resultados judiciales")));

  // Vocabulario no se mezcla
  assert.ok(crImpresora.vocabularioCliente.includes("roller para feria"));
  assert.ok(!crAyP.vocabularioCliente.includes("roller para feria"));
  assert.ok(crRespondo.vocabularioCliente.includes("bot para wsp"));
});

/* ── 7. MITIGACIÓN DE BUGS A Y B DE MASTER CONTEXT ───────────────────────── */

test("Bug B: rutaDeImagen decodifica /api/marketing/imagen?r= y rechaza traversals", () => {
  const clienteId = "123e4567-e89b-12d3-a456-426614174000";
  const rutaValida = `${clienteId}/1700000000000.jpg`;

  // Admite prefijo sb:
  assert.equal(rutaDeImagen(`${PREFIJO}${rutaValida}`), rutaValida);

  // Admite URL de API relativa con query r
  assert.equal(rutaDeImagen(`/api/marketing/imagen?r=${encodeURIComponent(rutaValida)}`), rutaValida);

  // Admite URL completa con query r
  assert.equal(rutaDeImagen(`https://app.respondo.io/api/marketing/imagen?r=${encodeURIComponent(rutaValida)}`), rutaValida);

  // Rechaza traversal en query
  assert.equal(rutaDeImagen(`/api/marketing/imagen?r=${encodeURIComponent(`${clienteId}/../../etc/passwd`)}`), null);

  // Rechaza extensiones no permitidas en query
  assert.equal(rutaDeImagen(`/api/marketing/imagen?r=${encodeURIComponent(`${clienteId}/1700000000000.svg`)}`), null);

  // Comprueba pertenencia al cliente
  assert.equal(rutaEsDelCliente(rutaValida, clienteId), true);
  assert.equal(rutaEsDelCliente(rutaValida, "otro-cliente-uuid"), false);
});

test("perfilMarketingDemo produce un perfil coherente y canónico para Gráfica Andina", () => {
  const demo = perfilMarketingDemo();
  assert.equal(demo.business.nombre, "Gráfica Andina");
  assert.equal(demo.business.ubicacion, "Chillán");
  assert.ok(demo.commercial.vende.length > 0);
  assert.ok(demo.marketing.productosFoco.length > 0);
  assert.equal(demo.marketing.ofertasTemporales.length, 1);
});
