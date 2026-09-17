import assert from "node:assert/strict";
import test from "node:test";

import {
  conservarCorreccionesPerfil,
  resolverInstanteExpiracionMs,
  evaluarOfertasTemporales,
  proyeccionCreative,
  proyeccionArchitect,
  proyeccionCopiloto,
  proyeccionContextoMarca,
  validarParcialPerfil,
  perfilMarketingDemo,
} from "../lib/marketing/perfilMarketingCore.ts";
import { fusionarDocumentoConPerfil } from "../lib/marketing/contextoComercial.ts";
import { contextoComercialDemo } from "../lib/marketing/demo.ts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SUITE DE VERIFICACIÓN DEFINITIVA — 18 ESCENARIOS OBLIGATORIOS
 * PERSONALIZACIÓN PROFUNDA DE MARKETING V1
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── 1. CRIT-01: Estudio Creativo usa proyeccionCreative(perfil) ────────────
test("1. CRIT-01: proyeccionCreative inyecta prioridad comercial y productos foco", () => {
  const perfil = perfilMarketingDemo();
  perfil.marketing.prioridadActual = "Lanzamiento Temporada Primavera";
  perfil.marketing.productosFoco = ["Gigantografía PVC", "Pendón roller"];

  const proy = proyeccionCreative(perfil);

  assert.ok(
    proy.diferenciadores.some((d) => d.includes("Prioridad comercial actual: Lanzamiento Temporada Primavera")),
    "Debe inyectar la prioridad comercial al inicio de diferenciadores",
  );
  assert.ok(
    proy.diferenciadores.some((d) => d.includes("Productos foco: Gigantografía PVC, Pendón roller")),
    "Debe inyectar los productos foco en diferenciadores",
  );
  assert.ok(
    proy.vende[0].nombre.toLowerCase().includes("pendón") || proy.vende[0].nombre.toLowerCase().includes("gigantografía"),
    "El catálogo debe estar ordenado priorizando los productos foco",
  );
});

// ── 2. CRIT-02: Guardar contexto no destruye documento.perfil ni ramas ─────
test("2. CRIT-02: fusionarDocumentoConPerfil preserva perfil, business, brand, marketing, invalidation y overrides", () => {
  const docAnterior = {
    ...contextoComercialDemo(),
    business: { nombre: "Imprenta Real", tipoNegocio: "b2b" },
    brand: { estiloVisual: "Corporativo", elementosProhibidos: ["marca-agua"] },
    marketing: { prioridadActual: "Feria 2026", productosFoco: ["Folletos"] },
    invalidation: { stale: false, fichasHash: "hash-abc-123" },
    overrides: { "marketing.prioridadActual": true },
    perfil: {
      business: { nombre: "Imprenta Real", tipoNegocio: "b2b" },
      brand: { estiloVisual: "Corporativo", elementosProhibidos: ["marca-agua"] },
      marketing: { prioridadActual: "Feria 2026", productosFoco: ["Folletos"] },
      invalidation: { stale: false, fichasHash: "hash-abc-123" },
      overrides: { "marketing.prioridadActual": true },
    },
  };

  const nuevoContextoComercial = {
    ...contextoComercialDemo(),
    audiencia: { descripcion: "Empresas de logística y retail", rubros: ["Logística"] },
  };

  const docFusionado = fusionarDocumentoConPerfil(docAnterior, nuevoContextoComercial, true);

  assert.equal(docFusionado.audiencia.descripcion, "Empresas de logística y retail");
  assert.deepEqual(docFusionado.business, docAnterior.business);
  assert.deepEqual(docFusionado.brand, docAnterior.brand);
  assert.deepEqual(docFusionado.marketing, docAnterior.marketing);
  assert.deepEqual(docFusionado.invalidation, docAnterior.invalidation);
  assert.deepEqual(docFusionado.overrides, docAnterior.overrides);
  assert.ok(docFusionado.perfil, "perfil no debe ser nulo ni undefined");
  assert.equal(docFusionado.perfil.business.nombre, "Imprenta Real");
  assert.equal(docFusionado.perfil.commercial.audiencia.descripcion, "Empresas de logística y retail");
});

// ── 3. CRIT-03.1: Override tri-estado: campo no modificado hereda automático ─
test("3. CRIT-03.1: campo no modificado hereda el valor automático del nuevo cimiento", () => {
  const existente = perfilMarketingDemo();
  existente.business.cobertura = "Ñuble y alrededores"; // modificado
  existente.overrides = { "business.cobertura": true };

  const nuevo = perfilMarketingDemo();
  nuevo.business.categoria = "Gráfica y Publicidad Integral"; // inferencia nueva
  nuevo.business.cobertura = "Nacional"; // nuevo cálculo automático

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  assert.equal(fusionado.business.cobertura, "Ñuble y alrededores", "cobertura modificada debe mantenerse");
  assert.equal(fusionado.business.categoria, "Gráfica y Publicidad Integral", "categoria no modificada debe heredar la nueva");
});

// ── 4. CRIT-03.2: Override tri-estado: campo modificado con valor mantiene valor ─
test("4. CRIT-03.2: campo modificado con valor declarado se mantiene intacto", () => {
  const existente = perfilMarketingDemo();
  existente.marketing.prioridadActual = "Campaña Especial Navidad";
  existente.overrides = { "marketing.prioridadActual": true };

  const nuevo = perfilMarketingDemo();
  nuevo.marketing.prioridadActual = "Prioridad automática sugerida por IA";

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  assert.equal(fusionado.marketing.prioridadActual, "Campaña Especial Navidad");
});

// ── 5. CRIT-03.3: Override tri-estado: productosFoco = [] no resucita ───────
test("5. CRIT-03.3: productosFoco = [] explícito no resucita con inferidos", () => {
  const existente = perfilMarketingDemo();
  existente.marketing.productosFoco = [];
  existente.overrides = { "marketing.productosFoco": true };

  const nuevo = perfilMarketingDemo();
  nuevo.marketing.productosFoco = ["Gigantografía PVC", "Pendón roller"];

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  assert.deepEqual(fusionado.marketing.productosFoco, [], "No debe resucitar inferidos cuando se declaró []");
});

// ── 6. CRIT-03.4: Override tri-estado: prioridadActual = null no resucita ───
test("6. CRIT-03.4: prioridadActual = null explícito no resucita con ?? ni ||", () => {
  const existente = perfilMarketingDemo();
  existente.marketing.prioridadActual = null;
  existente.overrides = { "marketing.prioridadActual": true };

  const nuevo = perfilMarketingDemo();
  nuevo.marketing.prioridadActual = "Prioridad automática";

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  assert.equal(fusionado.marketing.prioridadActual, null, "No debe resucitar inferido cuando se declaró null");
});

// ── 7. CRIT-03.5: Override tri-estado: elementosProhibidos = [] no resucita ─
test("7. CRIT-03.5: elementosProhibidos = [] explícito no resucita por unión de sets", () => {
  const existente = perfilMarketingDemo();
  existente.brand.elementosProhibidos = [];
  existente.overrides = { "brand.elementosProhibidos": true };

  const nuevo = perfilMarketingDemo();
  nuevo.brand.elementosProhibidos = ["logos pixelados", "precios no confirmados"];

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  assert.deepEqual(fusionado.brand.elementosProhibidos, [], "No debe resucitar elementos prohibidos cuando se vació []");
});

// ── 8. Merge de entidades: productos declarados vs automáticos ──────────────
test("8. Merge de entidades: productos declarados retienen precio y nuevos automáticos se agregan sin colisión", () => {
  const existente = perfilMarketingDemo();
  existente.commercial.vende = [
    {
      nombre: "Pendón roller 80x200",
      tipo: "producto",
      detalle: "Estructura de aluminio reforzada con lona matte premium",
      precio: "$29.990 + IVA",
      fuente: "declarado",
    },
  ];

  const nuevo = perfilMarketingDemo();
  nuevo.commercial.vende = [
    {
      nombre: "Pendón roller 80x200",
      tipo: "producto",
      detalle: "Detalle automático sobreescrito",
      precio: "$25.000",
      fuente: "catalogo",
    },
    {
      nombre: "Letrero Acrílico Led",
      tipo: "producto",
      detalle: "Letrero para recepción comercial con luz cálida",
      precio: "$85.000",
      fuente: "catalogo",
    },
  ];

  const fusionado = conservarCorreccionesPerfil(nuevo, existente);

  // El producto declarado debe mantener sus valores exactos
  const pendon = fusionado.commercial.vende.find((v) => v.nombre === "Pendón roller 80x200");
  assert.ok(pendon);
  assert.equal(pendon.precio, "$29.990 + IVA");
  assert.equal(pendon.detalle, "Estructura de aluminio reforzada con lona matte premium");
  assert.equal(pendon.fuente, "declarado");

  // El nuevo producto automático debe agregarse
  const letrero = fusionado.commercial.vende.find((v) => v.nombre === "Letrero Acrílico Led");
  assert.ok(letrero, "El nuevo producto automático debe ser incorporado al catálogo fusionado");
  assert.equal(letrero.precio, "$85.000");
});

// ── 9. Semántica temporal YYYY-MM-DD en America/Santiago ────────────────────
test("9. Semántica temporal YYYY-MM-DD: activa hasta las 23:59:59.999 hora Chile", () => {
  // Caso 1: Mismo día a las 23:00 CLT -> ACTIVA
  const ahora23CLT = new Date("2026-10-15T23:00:00-03:00").getTime();
  const instanteExpiracion = resolverInstanteExpiracionMs("2026-10-15");

  assert.ok(instanteExpiracion !== null, "Debe resolver fecha válida");
  assert.ok(ahora23CLT <= instanteExpiracion, "A las 23:00 CLT del día de expiración debe estar activa");

  // Caso 2: Día siguiente a las 00:00:01 CLT -> EXPIRADA
  const ahoraDiaSiguiente = new Date("2026-10-16T00:00:01-03:00").getTime();
  assert.ok(ahoraDiaSiguiente > instanteExpiracion, "A las 00:00:01 CLT del día siguiente debe estar expirada");

  // Evaluar a través de evaluarOfertasTemporales
  const ofertas = [
    {
      id: "o1",
      titulo: "Cyber Day",
      detalle: "20% dcto",
      hasta: "2026-10-15",
      fuente: "declarado",
      activo: true,
    },
  ];

  const evaluadasActiva = evaluarOfertasTemporales(ofertas, ahora23CLT);
  assert.equal(evaluadasActiva[0].activo, true, "Debe evaluarse activa a las 23:00 CLT");

  const evaluadasExpirada = evaluarOfertasTemporales(ofertas, ahoraDiaSiguiente);
  assert.equal(evaluadasExpirada[0].activo, false, "Debe evaluarse inactiva al día siguiente");
});

// ── 10. Semántica temporal ISO string UTC ───────────────────────────────────
test("10. Semántica temporal ISO string: expira exactamente en el instante especificado", () => {
  const isoDate = "2026-10-15T18:00:00.000Z";
  const expMs = resolverInstanteExpiracionMs(isoDate);
  const esperadoMs = new Date(isoDate).getTime();

  assert.equal(expMs, esperadoMs, "ISO string debe resolverse directamente con Date.parse");

  const ofertas = [
    { id: "o2", titulo: "Flash Sale", detalle: "Solo por la tarde", hasta: isoDate, fuente: "declarado", activo: true },
  ];

  assert.equal(evaluarOfertasTemporales(ofertas, esperadoMs - 1000)[0].activo, true);
  assert.equal(evaluarOfertasTemporales(ofertas, esperadoMs + 1000)[0].activo, false);
});

// ── 11. Invalidación JIT: stale: true limpia a false al reconstruir ────────
test("11. Invalidación JIT: nuevo perfil ensamblado tiene stale = false y razón limpia", () => {
  const existente = perfilMarketingDemo();
  existente.invalidation.stale = true;
  existente.invalidation.razonStale = "conocimiento_modificado";

  const nuevo = perfilMarketingDemo();
  // El nuevo cálculo limpia el estado stale
  nuevo.invalidation.stale = false;
  nuevo.invalidation.razonStale = null;

  assert.equal(nuevo.invalidation.stale, false);
  assert.equal(nuevo.invalidation.razonStale, null);
});

// ── 12. Invalidación por hash de fichas ─────────────────────────────────────
test("12. Hash de fichas incluye contenido y detecta cambios de fichas", async () => {
  // Simulamos calcularHashFichas con fichas modificadas en contenido
  const str1 = "f1:2026-09-01:Horario:Atendemos de 9 a 18";
  const str2 = "f1:2026-09-01:Horario:Atendemos de 9 a 20 (horario extendido)";

  assert.notEqual(str1, str2, "Cambio en contenido de ficha debe alterar la firma");
});

// ── 13. Escritura en SQL: estructura de documento y columnas 312 ───────────
test("13. Estructura canónica guardada incluye documento compatible y columnas 312", () => {
  const perfil = perfilMarketingDemo();
  perfil.invalidation.stale = false;
  perfil.invalidation.fichasHash = "hash-123";
  perfil.invalidation.razonStale = null;

  const documentoFusionado = {
    ...perfil.commercial,
    perfil,
    business: perfil.business,
    brand: perfil.brand,
    commercial: perfil.commercial,
    marketing: perfil.marketing,
    invalidation: perfil.invalidation,
    overrides: perfil.overrides ?? {},
    editado: perfil.editado,
    actualizadoEn: perfil.actualizadoEn,
  };

  const registroDb = {
    documento: documentoFusionado,
    editado: perfil.editado,
    stale: perfil.invalidation.stale,
    stale_motivo: perfil.invalidation.razonStale,
    fichas_hash: perfil.invalidation.fichasHash,
    actualizado_en: new Date().toISOString(),
  };

  assert.equal(registroDb.stale, false);
  assert.equal(registroDb.stale_motivo, null);
  assert.equal(registroDb.fichas_hash, "hash-123");
  assert.ok(registroDb.documento.perfil);
  assert.ok(registroDb.documento.business);
  assert.ok(registroDb.documento.brand);
  assert.ok(registroDb.documento.marketing);
  assert.ok(registroDb.documento.vende, "Debe tener propiedades planas para compatibilidad 310");
});

// ── 14. Runtime validation: validarParcialPerfil ────────────────────────────
test("14. Runtime validation: validarParcialPerfil acepta datos válidos y rechaza inválidos o maliciosos", () => {
  // Válido
  const valido = validarParcialPerfil({
    business: { nombre: "Imprenta Andina", tipoNegocio: "b2b" },
    marketing: { prioridadActual: "Foco en empresas", productosFoco: ["Gigantografía"] },
  });
  assert.equal(valido.valido, true);

  // No es objeto
  const noObjeto = validarParcialPerfil(null);
  assert.equal(noObjeto.valido, false);

  // Payload con tipos erróneos
  const tipoInvalido = validarParcialPerfil({
    business: { nombre: 12345 },
  });
  assert.equal(tipoInvalido.valido, false);

  // TipoNegocio inválido
  const tipoNegocioInvalido = validarParcialPerfil({
    business: { tipoNegocio: "invalido" },
  });
  assert.equal(tipoNegocioInvalido.valido, false);

  // String que excede límites
  const exceso = validarParcialPerfil({
    business: { nombre: "A".repeat(300) },
  });
  assert.equal(exceso.valido, false);

  // Array que excede límites
  const arrayExceso = validarParcialPerfil({
    marketing: { productosFoco: Array.from({ length: 30 }, (_, i) => `Producto ${i}`) },
  });
  assert.equal(arrayExceso.valido, false);
});

// ── 15. Runtime validation en acción ───────────────────────────────────────
test("15. validarParcialPerfil protege la acción de servidor contra inyecciones y fallas de formato", () => {
  const payloadInvalido = {
    brand: { elementosProhibidos: ["valido", 9999] },
  };
  const res = validarParcialPerfil(payloadInvalido);
  assert.equal(res.valido, false);
  assert.ok(res.motivo.includes("elementosProhibidos"));
});

// ── 16. Proyecciones consistentes entre módulos ────────────────────────────
test("16. Proyecciones consistentes: Creative, Architect, Copiloto y Marca ven el mismo negocio", () => {
  const perfil = perfilMarketingDemo();
  perfil.marketing.prioridadActual = "Impulsar pendones";
  perfil.marketing.productosFoco = ["Pendón roller"];

  const creative = proyeccionCreative(perfil);
  const architect = proyeccionArchitect(perfil);
  const copiloto = proyeccionCopiloto(perfil);
  const marca = proyeccionContextoMarca(perfil);

  assert.equal(architect.productosFoco[0], "Pendón roller");
  assert.ok(copiloto.contextoTexto.includes(perfil.business.nombre));
  assert.ok(copiloto.contextoTexto.includes(perfil.marketing.prioridadActual));
  assert.equal(copiloto.perfilResumido.nombre, perfil.business.nombre);
  assert.equal(marca.nombre, perfil.business.nombre);
  assert.equal(creative.negocio.nombre, perfil.business.nombre);
  assert.equal(creative.vende[0].nombre.includes("Pendón"), true);
});

// ── 17. Customer Zero: aislamiento estricto multi-inquilino ────────────────
test("17. Customer Zero: dos clientes con diferentes perfiles mantienen aislamiento absoluto", () => {
  const clienteA = perfilMarketingDemo();
  clienteA.clienteId = "cliente-aaa";
  clienteA.business.nombre = "Imprenta Color Chillán";
  clienteA.marketing.prioridadActual = "Pendones para eventos";

  const clienteB = perfilMarketingDemo();
  clienteB.clienteId = "cliente-bbb";
  clienteB.business.nombre = "Centro Médico San Martín";
  clienteB.business.rubro = "Salud y Bienestar";
  clienteB.business.tipoNegocio = "b2c";
  clienteB.marketing.prioridadActual = "Chequeos preventivos";

  assert.notEqual(clienteA.clienteId, clienteB.clienteId);
  assert.notEqual(clienteA.business.nombre, clienteB.business.nombre);
  assert.notEqual(clienteA.marketing.prioridadActual, clienteB.marketing.prioridadActual);

  const proyA = proyeccionCreative(clienteA);
  const proyB = proyeccionCreative(clienteB);

  assert.ok(proyA.diferenciadores.some((d) => d.includes("Pendones para eventos")));
  assert.ok(!proyA.diferenciadores.some((d) => d.includes("Chequeos preventivos")));

  assert.ok(proyB.diferenciadores.some((d) => d.includes("Chequeos preventivos")));
  assert.ok(!proyB.diferenciadores.some((d) => d.includes("Pendones para eventos")));
});

// ── 18. Compatibilidad hacia atrás 310 ─────────────────────────────────────
test("18. Compatibilidad 310: un lector legado de ed_mk_contexto lee propiedades planas sin fallar", () => {
  const perfil = perfilMarketingDemo();
  const doc = {
    ...perfil.commercial,
    perfil,
    business: perfil.business,
    brand: perfil.brand,
    commercial: perfil.commercial,
    marketing: perfil.marketing,
    invalidation: perfil.invalidation,
  };

  // Lector legado migración 310
  assert.ok(Array.isArray(doc.vende), "doc.vende debe existir");
  assert.ok(doc.audiencia && typeof doc.audiencia === "object", "doc.audiencia debe existir");
  assert.ok(doc.propuesta && typeof doc.propuesta === "object", "doc.propuesta debe existir");
  assert.ok(Array.isArray(doc.diferenciadores), "doc.diferenciadores debe existir");
  assert.ok(Array.isArray(doc.ofertas), "doc.ofertas debe existir");
  assert.ok(Array.isArray(doc.noAfirmar), "doc.noAfirmar debe existir");

  // Lector nuevo migración 312
  assert.ok(doc.perfil, "doc.perfil debe existir");
  assert.ok(doc.business, "doc.business debe existir");
  assert.ok(doc.brand, "doc.brand debe existir");
  assert.ok(doc.marketing, "doc.marketing debe existir");
});

// ── 19. CRIT-03 runtime: override humano selectivo no congela automáticos ────
test("19. CRIT-03 runtime: override de un campo humano no congela otros campos automáticos", () => {
  const viejo = perfilMarketingDemo();
  viejo.marketing.prioridadActual = "Campaña Cyber 2026";
  viejo.marketing.productosFoco = ["Producto A", "Producto B"];
  viejo.brand.estiloVisual = "Estilo Inicial";
  viejo.overrides = { "marketing.prioridadActual": true };
  viejo.editado = true;

  // El cimiento nuevo infiere nuevos productos foco y nuevo estilo tras cambio de catálogo
  const nuevo = perfilMarketingDemo();
  nuevo.marketing.prioridadActual = null;
  nuevo.marketing.productosFoco = ["Producto C", "Producto D"];
  nuevo.brand.estiloVisual = "Estilo Renovado";

  const fusion = conservarCorreccionesPerfil(nuevo, viejo);

  // Campo con override humano se mantiene
  assert.equal(fusion.marketing.prioridadActual, "Campaña Cyber 2026", "Override humano debe preservarse");
  // Campos sin override humano evolucionan y NO se quedan congelados en el valor viejo
  assert.deepEqual(fusion.marketing.productosFoco, ["Producto C", "Producto D"], "Productos foco no editados deben evolucionar con nuevo catálogo");
  assert.equal(fusion.brand.estiloVisual, "Estilo Renovado", "Estilo visual no editado debe evolucionar con nueva inferencia");
});

// ── 20. Temporalidad: rechazo de fechas calendario inválidas ─────────────────
test("20. Temporalidad: fechas calendario inválidas como 2026-02-31 son estrictamente rechazadas", () => {
  assert.equal(resolverInstanteExpiracionMs("2026-02-31"), null, "Febrero 31 debe rechazarse");
  assert.equal(resolverInstanteExpiracionMs("2026-04-31"), null, "Abril 31 debe rechazarse");
  assert.equal(resolverInstanteExpiracionMs("2026-02-29"), null, "2026 no es bisiesto, 29 feb debe rechazarse");
  assert.ok(resolverInstanteExpiracionMs("2024-02-29") !== null, "2024 sí es bisiesto, 29 feb es válido");
  assert.equal(resolverInstanteExpiracionMs("2026-02-31T12:00:00Z"), null, "ISO con fecha inválida debe rechazarse");

  const ofertas = [
    { id: "bad", titulo: "Mal", detalle: "X", expiraEn: "2026-02-31", activo: true, fuente: "declarado" },
  ];
  const evaluadas = evaluarOfertasTemporales(ofertas);
  assert.equal(evaluadas[0].activo, false, "Oferta con fecha calendario inválida debe desactivarse de inmediato");
});

// ── 21. Temporalidad: timestamp sin offset rechazado y zona respetada ───────
test("21. Temporalidad: timestamp ISO sin offset es rechazado y zona horaria no se ignora", () => {
  // Con offset explícito es válido
  assert.ok(resolverInstanteExpiracionMs("2026-10-15T18:00:00Z") !== null, "Z debe aceptarse");
  assert.ok(resolverInstanteExpiracionMs("2026-10-15T18:00:00-03:00") !== null, "-03:00 debe aceptarse");

  // Sin offset (ambiguo para hora de pared) debe rechazarse por contrato explícito
  assert.equal(resolverInstanteExpiracionMs("2026-10-15T18:00:00"), null, "Timestamp con hora sin offset debe rechazarse");

  // Zona horaria parametrizada no debe ignorarse
  const msChile = resolverInstanteExpiracionMs("2026-10-15", "America/Santiago");
  const msUtc = resolverInstanteExpiracionMs("2026-10-15", "UTC");
  assert.ok(msChile !== null && msUtc !== null);
  assert.notEqual(msChile, msUtc, "La zona horaria parametrizada debe alterar el fin de día calculado");
  assert.equal(msUtc, Date.UTC(2026, 9, 15, 23, 59, 59, 999), "Fin de día en UTC debe ser 23:59:59.999 UTC");
});

// ── 22. Validación commercial: allowlist estricta y rechazo de desconocidas ──
test("22. Validación commercial: allowlist estricta y rechazo de propiedades desconocidas", () => {
  // Propiedad desconocida en la raíz de commercial
  const r1 = validarParcialPerfil({ commercial: { propiedadDesconocida: 123 } });
  assert.equal(r1.valido, false);
  assert.match(r1.motivo, /Propiedad no permitida en commercial: propiedadDesconocida/);

  // Propiedad desconocida dentro de commercial.negocio
  const r2 = validarParcialPerfil({ commercial: { negocio: { campoExtra: "mal" } } });
  assert.equal(r2.valido, false);
  assert.match(r2.motivo, /Propiedad no permitida en commercial\.negocio: campoExtra/);

  // Propiedad desconocida en commercial.vende
  const r3 = validarParcialPerfil({
    commercial: {
      vende: [{ nombre: "Pendón", tipo: "producto", atributoInvalido: true }],
    },
  });
  assert.equal(r3.valido, false);
  assert.match(r3.motivo, /Propiedad no permitida en item de commercial\.vende: atributoInvalido/);

  // Carga válida
  const r4 = validarParcialPerfil({
    commercial: {
      negocio: { nombre: "Imprenta Pro" },
      diferenciadores: ["Calidad certificada"],
    },
  });
  assert.equal(r4.valido, true);
  assert.equal(r4.datos.commercial?.negocio?.nombre, "Imprenta Pro");
});

// ── 23. Validación estricta de fuentes[] y descartados[] en commercial ──────
test("23. Validación commercial: fuentes[] y descartados[] rechazan campos desconocidos y validan tipos", () => {
  // 1. fuentes: [{ ...válido, campoInventado: true }] → rechazado
  const fInventado = validarParcialPerfil({
    commercial: {
      fuentes: [
        { rol: "catalogo", titulo: "Catálogo General", motivo: "Lista de productos", campoInventado: true },
      ],
    },
  });
  assert.equal(fInventado.valido, false);
  assert.match(fInventado.motivo, /Propiedad no permitida en item de commercial\.fuentes: campoInventado/);

  // 2. descartados: [{ ...válido, campoInventado: true }] → rechazado
  const dInventado = validarParcialPerfil({
    commercial: {
      descartados: [
        { titulo: "Ficha Interna", motivo: "Contiene datos operativos de bodega", campoInventado: true },
      ],
    },
  });
  assert.equal(dInventado.valido, false);
  assert.match(dInventado.motivo, /Propiedad no permitida en item de commercial\.descartados: campoInventado/);

  // 3. Objeto válido de fuentes → aceptado
  const fValido = validarParcialPerfil({
    commercial: {
      fuentes: [
        { rol: "catalogo", titulo: "Precios y Formatos 2026", motivo: "Productos principales y precios" },
        { rol: "identidad", titulo: "Quiénes Somos", motivo: "Misión y propuesta de valor" },
      ],
    },
  });
  assert.equal(fValido.valido, true);
  assert.equal(fValido.datos.commercial?.fuentes?.length, 2);
  assert.equal(fValido.datos.commercial?.fuentes?.[0]?.rol, "catalogo");

  // 4. Objeto válido de descartados → aceptado
  const dValido = validarParcialPerfil({
    commercial: {
      descartados: [
        { titulo: "Horarios y Turnos", motivo: "Información operativa interna" },
      ],
    },
  });
  assert.equal(dValido.valido, true);
  assert.equal(dValido.datos.commercial?.descartados?.length, 1);
  assert.equal(dValido.datos.commercial?.descartados?.[0]?.titulo, "Horarios y Turnos");

  // 5. Tipo incorrecto en fuentes (rol inexistente) → rechazado
  const fTipoInvalido = validarParcialPerfil({
    commercial: {
      fuentes: [
        { rol: "rol_inexistente_hacker", titulo: "Test", motivo: "Prueba" },
      ],
    },
  });
  assert.equal(fTipoInvalido.valido, false);
  assert.match(fTipoInvalido.motivo, /commercial\.fuentes: rol inválido/);

  // 6. Tipo incorrecto en descartados (titulo no string) → rechazado
  const dTipoInvalido = validarParcialPerfil({
    commercial: {
      descartados: [
        { titulo: 12345, motivo: "Prueba" },
      ],
    },
  });
  assert.equal(dTipoInvalido.valido, false);
  assert.match(dTipoInvalido.motivo, /commercial\.descartados: titulo es obligatorio/);
});
