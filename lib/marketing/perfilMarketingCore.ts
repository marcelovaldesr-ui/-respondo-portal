import {
  AUTORIDAD,
  type Afirmacion,
  type ContextoComercial,
  type EntidadComercial,
  type Fuente,
} from "@/lib/marketing/contextoComercialCore";
import type { ContextoMarca } from "@/lib/marketing/contextoMarca";
import { NEGOCIO_DEMO, contextoComercialDemo } from "@/lib/marketing/demo";
import { horaChileAUtc } from "@/lib/agendaCore";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PERSONALIZACIÓN PROFUNDA DE MARKETING V1 — NÚCLEO PURO
 *
 * Unifica la realidad comercial de cada negocio para que el Estudio Creativo,
 * el Arquitecto de Campañas, el Copiloto y la pantalla de inicio de Marketing
 * consuman UNA SOLA FUENTE DE VERDAD.
 *
 * Jerarquía de procedencia (§ reglas de autoridad):
 *   DECLARADO (100) > CATALOGO/EXTRAIDO (80) > CONOCIMIENTO (60) >
 *   PUBLICIDAD (40) > CONVERSACIONES (30) > INFERIDO (10).
 *
 * Ningún dato puramente inferido puede validar una afirmación publicitaria.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type TipoNegocio = "b2b" | "b2c" | "ambos";

export type BusinessProfile = {
  nombre: string;
  rubro: string;
  categoria: string;
  sitioWeb: string | null;
  ubicacion: string | null;
  cobertura: string | null;
  tipoNegocio: TipoNegocio;
  telefonoContacto?: string | null;
  whatsappConectado: boolean;
};

export type BrandProfile = {
  logoUrl: string | null;
  paletaColores: {
    primario: string;
    secundario?: string;
    acento?: string;
    fondo?: string;
  } | null;
  estiloVisual: string | null;
  elementosProhibidos: string[];
};

export type OfertaTemporal = {
  id: string;
  titulo: string;
  detalle: string;
  expiraEn: string; // ISO-8601 o YYYY-MM-DD
  activo: boolean;
  fuente: Fuente;
};

export type MarketingProfile = {
  prioridadActual: string | null;
  productosFoco: string[];
  segmentosObjetivo: string[];
  canalesPreferidos: ("meta" | "google")[];
  metaConversion: string | null;
  ofertasTemporales: OfertaTemporal[];
};

export type InvalidationState = {
  stale: boolean;
  razonStale: string | null;
  fichasHash: string | null;
  ultimoCalculo: string;
};

export type PerfilNegocioMarketing = {
  clienteId: string;
  business: BusinessProfile;
  brand: BrandProfile;
  commercial: ContextoComercial;
  marketing: MarketingProfile;
  invalidation: InvalidationState;
  overrides?: Record<string, boolean>;
  editado: boolean;
  actualizadoEn: string;
};

/* ── Temporalidad ────────────────────────────────────────────────────────── */

export const ZONA_HORARIA_CANONICA = "America/Santiago";

function esFechaCalendarioValida(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return dia <= diasEnMes;
}

function offsetZonaMs(instante: Date, zona: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const parte of dtf.formatToParts(instante)) p[parte.type] = parte.value;
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return comoUtc - instante.getTime();
}

function horaParedAUtc(
  anio: number,
  mes: number,
  dia: number,
  hh: number,
  mm: number,
  zona: string = ZONA_HORARIA_CANONICA,
): Date {
  if (zona === ZONA_HORARIA_CANONICA || zona === "America/Santiago") {
    return horaChileAUtc(anio, mes, dia, hh, mm);
  }
  const pared = Date.UTC(anio, mes - 1, dia, hh, mm);
  let utc = pared;
  for (let i = 0; i < 2; i++) {
    utc = pared - offsetZonaMs(new Date(utc), zona);
  }
  return new Date(utc);
}

/**
 * Convierte un string de expiración a un timestamp en milisegundos.
 * Si es date-only (YYYY-MM-DD), representa las 23:59:59.999 de ese día
 * en la zona horaria del negocio (America/Santiago por defecto),
 * garantizando que la oferta esté activa DURANTE todo el día comercial inclusivo.
 * Si es un ISO timestamp con hora, exige offset/timezone explícito (Z o [+-]HH:MM),
 * rechazando fechas calendario inválidas o timestamps ambiguos sin offset.
 */
export function resolverInstanteExpiracionMs(
  expiraEn: string | null | undefined,
  zona: string = ZONA_HORARIA_CANONICA,
): number | null {
  if (!expiraEn || typeof expiraEn !== "string") return null;
  const limpio = expiraEn.trim();
  if (!limpio) return null;

  // 1. Formato Date-only: YYYY-MM-DD (comercial inclusivo fin de día en la zona especificada)
  const matchFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio);
  if (matchFecha) {
    const anio = Number(matchFecha[1]);
    const mes = Number(matchFecha[2]);
    const dia = Number(matchFecha[3]);
    if (!esFechaCalendarioValida(anio, mes, dia)) return null;

    try {
      const finUtc = horaParedAUtc(anio, mes, dia, 23, 59, zona);
      if (isNaN(finUtc.getTime())) return null;
      return finUtc.getTime() + 59_999;
    } catch {
      return null;
    }
  }

  // 2. Timestamp ISO con hora: exige offset/timezone explícito (Z o [+-]HH:MM o [+-]HHMM)
  // Timestamps sin offset se rechazan por contrato explícito para evitar ambigüedad del servidor.
  const matchIsoConOffset =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(
      limpio,
    );
  if (matchIsoConOffset) {
    const anio = Number(matchIsoConOffset[1]);
    const mes = Number(matchIsoConOffset[2]);
    const dia = Number(matchIsoConOffset[3]);
    const hh = Number(matchIsoConOffset[4]);
    const mm = Number(matchIsoConOffset[5]);
    const ss = matchIsoConOffset[6] !== undefined ? Number(matchIsoConOffset[6]) : 0;

    if (!esFechaCalendarioValida(anio, mes, dia)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;

    const ms = new Date(limpio).getTime();
    return isNaN(ms) ? null : ms;
  }

  return null;
}

/**
 * Evalúa las ofertas temporales desactivando de inmediato las que ya expiraron.
 * Una oferta expirada NUNCA llega a un anuncio.
 */
export function evaluarOfertasTemporales(
  ofertas: OfertaTemporal[],
  fechaReferencia: Date | number = new Date(),
  zona: string = ZONA_HORARIA_CANONICA,
): OfertaTemporal[] {
  const refTime = typeof fechaReferencia === "number" ? fechaReferencia : fechaReferencia.getTime();
  return (ofertas ?? []).map((o) => {
    const rawExpira = o.expiraEn || (o as unknown as { hasta?: string }).hasta;
    if (!rawExpira) return o;
    const expTime = resolverInstanteExpiracionMs(rawExpira, zona);
    if (expTime === null) {
      return { ...o, activo: false };
    }
    const caduco = expTime < refTime;
    return caduco ? { ...o, activo: false } : o;
  });
}

/* ── Preservación de Correcciones Humanas (Tri-State + Entity Merge) ──────── */

function tieneOverride(viejo: PerfilNegocioMarketing, clave: string): boolean {
  if (viejo.overrides && typeof viejo.overrides === "object") {
    if (clave in viejo.overrides) return Boolean(viejo.overrides[clave]);
  }
  return false;
}

function campoTriState<T>(
  viejo: PerfilNegocioMarketing,
  clave: string,
  valorViejo: T,
  valorNuevo: T,
  fallbackLegacy?: (v: T, n: T) => T,
): T {
  if (tieneOverride(viejo, clave)) {
    return valorViejo;
  }
  if (viejo.overrides && typeof viejo.overrides === "object") {
    return valorNuevo;
  }
  return fallbackLegacy ? fallbackLegacy(valorViejo, valorNuevo) : (valorViejo ?? valorNuevo);
}

/**
 * Preserva las decisiones tomadas por personas al recalcular el perfil.
 * Distingue formalmente:
 *   A) no tocado por el humano (evoluciona con nuevo)
 *   B) declarado con valor
 *   C) declarado explícitamente vacío o null (se respeta [] o null)
 */
export function conservarCorreccionesPerfil(
  nuevo: PerfilNegocioMarketing,
  viejo: PerfilNegocioMarketing,
): PerfilNegocioMarketing {
  const businessHumano: BusinessProfile = {
    ...nuevo.business,
    nombre: campoTriState(viejo, "business.nombre", viejo.business.nombre, nuevo.business.nombre, (v, n) => v || n),
    rubro: campoTriState(viejo, "business.rubro", viejo.business.rubro, nuevo.business.rubro, (v, n) => v || n),
    categoria: campoTriState(viejo, "business.categoria", viejo.business.categoria, nuevo.business.categoria, (v, n) => v || n),
    sitioWeb: campoTriState(viejo, "business.sitioWeb", viejo.business.sitioWeb, nuevo.business.sitioWeb),
    ubicacion: campoTriState(viejo, "business.ubicacion", viejo.business.ubicacion, nuevo.business.ubicacion),
    cobertura: campoTriState(viejo, "business.cobertura", viejo.business.cobertura, nuevo.business.cobertura),
    tipoNegocio: campoTriState(viejo, "business.tipoNegocio", viejo.business.tipoNegocio, nuevo.business.tipoNegocio),
    telefonoContacto: campoTriState(viejo, "business.telefonoContacto", viejo.business.telefonoContacto, nuevo.business.telefonoContacto),
    whatsappConectado: nuevo.business.whatsappConectado,
  };

  // Brand: tri-state para elementosProhibidos (no usar Set union destructiva)
  let elementosProhibidos: string[];
  if (tieneOverride(viejo, "brand.elementosProhibidos")) {
    elementosProhibidos = viejo.brand.elementosProhibidos;
  } else if (viejo.overrides && typeof viejo.overrides === "object") {
    elementosProhibidos = nuevo.brand.elementosProhibidos;
  } else if (Array.isArray(viejo.brand?.elementosProhibidos)) {
    elementosProhibidos = viejo.brand.elementosProhibidos;
  } else {
    elementosProhibidos = nuevo.brand.elementosProhibidos;
  }

  const brandHumano: BrandProfile = {
    ...nuevo.brand,
    logoUrl: campoTriState(viejo, "brand.logoUrl", viejo.brand.logoUrl, nuevo.brand.logoUrl),
    paletaColores: campoTriState(viejo, "brand.paletaColores", viejo.brand.paletaColores, nuevo.brand.paletaColores),
    estiloVisual: campoTriState(viejo, "brand.estiloVisual", viejo.brand.estiloVisual, nuevo.brand.estiloVisual),
    elementosProhibidos,
  };

  // Marketing: tri-state para prioridadActual, productosFoco, etc.
  let prioridadActual: string | null;
  if (tieneOverride(viejo, "marketing.prioridadActual")) {
    prioridadActual = viejo.marketing.prioridadActual;
  } else if (viejo.overrides && typeof viejo.overrides === "object") {
    prioridadActual = nuevo.marketing.prioridadActual;
  } else if ("prioridadActual" in (viejo.marketing ?? {})) {
    prioridadActual = viejo.marketing.prioridadActual;
  } else {
    prioridadActual = nuevo.marketing.prioridadActual;
  }

  let productosFoco: string[];
  if (tieneOverride(viejo, "marketing.productosFoco")) {
    productosFoco = viejo.marketing.productosFoco;
  } else if (viejo.overrides && typeof viejo.overrides === "object") {
    productosFoco = nuevo.marketing.productosFoco;
  } else if (Array.isArray(viejo.marketing?.productosFoco)) {
    productosFoco = viejo.marketing.productosFoco;
  } else {
    productosFoco = nuevo.marketing.productosFoco;
  }

  let segmentosObjetivo: string[];
  if (tieneOverride(viejo, "marketing.segmentosObjetivo")) {
    segmentosObjetivo = viejo.marketing.segmentosObjetivo;
  } else if (viejo.overrides && typeof viejo.overrides === "object") {
    segmentosObjetivo = nuevo.marketing.segmentosObjetivo;
  } else if (Array.isArray(viejo.marketing?.segmentosObjetivo)) {
    segmentosObjetivo = viejo.marketing.segmentosObjetivo;
  } else {
    segmentosObjetivo = nuevo.marketing.segmentosObjetivo;
  }

  let canalesPreferidos: ("meta" | "google")[];
  if (tieneOverride(viejo, "marketing.canalesPreferidos")) {
    canalesPreferidos = viejo.marketing.canalesPreferidos;
  } else if (viejo.overrides && typeof viejo.overrides === "object") {
    canalesPreferidos = nuevo.marketing.canalesPreferidos;
  } else if (Array.isArray(viejo.marketing?.canalesPreferidos)) {
    canalesPreferidos = viejo.marketing.canalesPreferidos;
  } else {
    canalesPreferidos = nuevo.marketing.canalesPreferidos;
  }

  const ofertasViejas = evaluarOfertasTemporales(viejo.marketing?.ofertasTemporales ?? []);
  const ofertasNuevas = evaluarOfertasTemporales(nuevo.marketing?.ofertasTemporales ?? []);
  const ofertasTemporales = [
    ...ofertasViejas,
    ...ofertasNuevas.filter(
      (no) => !ofertasViejas.some((vo) => vo.id === no.id || vo.titulo.trim().toLowerCase() === no.titulo.trim().toLowerCase()),
    ),
  ];

  const marketingHumano: MarketingProfile = {
    ...nuevo.marketing,
    prioridadActual,
    productosFoco,
    segmentosObjetivo,
    canalesPreferidos,
    metaConversion: campoTriState(
      viejo,
      "marketing.metaConversion",
      viejo.marketing.metaConversion,
      nuevo.marketing.metaConversion,
    ),
    ofertasTemporales,
  };

  // ── MERGE DE ENTIDADES COMERCIALES (FASE 5) ──────────────────────────────
  // 1. Vende: los productos declarados por personas van al frente con máxima autoridad.
  //    Luego se incorporan los nuevos productos automáticos que no colisionen.
  const declaradosViejos = (viejo.commercial?.vende ?? []).filter((v) => v.fuente === "declarado");
  const vendeMerged: typeof nuevo.commercial.vende = [...declaradosViejos];

  for (const nv of nuevo.commercial.vende) {
    const yaExiste = vendeMerged.some((dv) => dv.nombre.trim().toLowerCase() === nv.nombre.trim().toLowerCase());
    if (!yaExiste) {
      vendeMerged.push(nv);
    }
  }

  const ofertasDeclaradas = (viejo.commercial?.ofertas ?? []).filter((o) => o.fuente === "declarado");
  const ofertasMerged = [
    ...ofertasDeclaradas,
    ...nuevo.commercial.ofertas.filter(
      (no) => !ofertasDeclaradas.some((od) => od.texto.trim().toLowerCase() === no.texto.trim().toLowerCase()),
    ),
  ];

  const pruebasDeclaradas = (viejo.commercial?.pruebas ?? []).filter((p) => p.fuente === "declarado");
  const pruebasMerged = [
    ...pruebasDeclaradas,
    ...nuevo.commercial.pruebas.filter(
      (np) => !pruebasDeclaradas.some((pd) => pd.texto.trim().toLowerCase() === np.texto.trim().toLowerCase()),
    ),
  ];

  const audienciaHumana = tieneOverride(viejo, "commercial.audiencia") ||
    (Boolean(viejo.commercial?.audiencia?.descripcion) && Boolean(viejo.editado));
  const audienciaFinal = audienciaHumana ? viejo.commercial.audiencia : nuevo.commercial.audiencia;

  const problemaHumano = tieneOverride(viejo, "commercial.propuesta.problema") ||
    (Boolean(viejo.editado) && Boolean(viejo.commercial?.propuesta?.problema));
  const resultadoHumano = tieneOverride(viejo, "commercial.propuesta.resultado") ||
    (Boolean(viejo.editado) && Boolean(viejo.commercial?.propuesta?.resultado));

  const vozFinal = viejo.commercial?.voz?.origen === "declarada" ? viejo.commercial.voz : nuevo.commercial.voz;

  const commercialHumano: ContextoComercial = {
    ...nuevo.commercial,
    vende: vendeMerged.length ? vendeMerged : nuevo.commercial.vende,
    ofertas: ofertasMerged,
    pruebas: pruebasMerged,
    audiencia: audienciaFinal,
    propuesta: {
      problema: problemaHumano ? viejo.commercial.propuesta.problema : nuevo.commercial.propuesta.problema,
      resultado: resultadoHumano ? viejo.commercial.propuesta.resultado : nuevo.commercial.propuesta.resultado,
    },
    voz: vozFinal,
    noAfirmar: Array.from(new Set([...nuevo.commercial.noAfirmar, ...(viejo.commercial?.noAfirmar ?? [])])),
  };

  const overridesFinal: Record<string, boolean> = {
    ...(nuevo.overrides ?? {}),
    ...(viejo.overrides ?? {}),
  };

  return {
    ...nuevo,
    business: businessHumano,
    brand: brandHumano,
    commercial: commercialHumano,
    marketing: marketingHumano,
    overrides: overridesFinal,
    editado: viejo.editado || nuevo.editado,
  };
}

/* ── Proyecciones Canónicas ──────────────────────────────────────────────── */

/**
 * Proyección para el Estudio Creativo (generador de anuncios, copy e imágenes).
 * Incorpora prioridades de marketing, ofertas temporales vigentes y prohibiciones de marca.
 */
export function proyeccionCreative(perfil: PerfilNegocioMarketing): ContextoComercial {
  const ofertasVigentes = evaluarOfertasTemporales(perfil.marketing.ofertasTemporales)
    .filter((o) => o.activo)
    .map((o) => ({ texto: `${o.titulo}: ${o.detalle}`, fuente: o.fuente, reserva: null }));

  const prohibicionesVisuales = perfil.brand.elementosProhibidos.map((e) => `Estilo de marca: prohibido ${e}.`);

  const diferenciadoresConPrioridad = [...perfil.commercial.diferenciadores];
  if (perfil.marketing.prioridadActual) {
    diferenciadoresConPrioridad.unshift(`Prioridad comercial actual: ${perfil.marketing.prioridadActual}`);
  }
  if (perfil.marketing.productosFoco.length) {
    diferenciadoresConPrioridad.push(`Productos foco: ${perfil.marketing.productosFoco.join(", ")}`);
  }

  // Ordenar productos en venta priorizando los productos foco
  const vendeOrdenado = [...perfil.commercial.vende].sort((a, b) => {
    const aFoco = perfil.marketing.productosFoco.some((pf) => a.nombre.toLowerCase().includes(pf.toLowerCase()));
    const bFoco = perfil.marketing.productosFoco.some((pf) => b.nombre.toLowerCase().includes(pf.toLowerCase()));
    if (aFoco && !bFoco) return -1;
    if (!aFoco && bFoco) return 1;
    return 0;
  });

  return {
    ...perfil.commercial,
    vende: vendeOrdenado,
    diferenciadores: diferenciadoresConPrioridad,
    ofertas: [...perfil.commercial.ofertas, ...ofertasVigentes],
    noAfirmar: Array.from(new Set([...perfil.commercial.noAfirmar, ...prohibicionesVisuales])),
  };
}

/**
 * Proyección para el Arquitecto de Campañas (Google Ads / Meta Ads).
 */
export function proyeccionArchitect(perfil: PerfilNegocioMarketing): {
  contextoTexto: string;
  canalesSugeridos: ("meta" | "google")[];
  productosFoco: string[];
  whatsappConectado: boolean;
  ubicacion: string | null;
} {
  const partes: string[] = [
    `NEGOCIO: ${perfil.business.nombre} (${perfil.business.rubro})`,
    `CATEGORÍA: ${perfil.business.categoria} · TIPO: ${perfil.business.tipoNegocio.toUpperCase()}`,
  ];
  if (perfil.business.ubicacion) partes.push(`UBICACIÓN: ${perfil.business.ubicacion}`);
  if (perfil.business.cobertura) partes.push(`COBERTURA: ${perfil.business.cobertura}`);
  if (perfil.business.sitioWeb) partes.push(`SITIO WEB: ${perfil.business.sitioWeb}`);

  if (perfil.marketing.prioridadActual) {
    partes.push(`PRIORIDAD ACTUAL: ${perfil.marketing.prioridadActual}`);
  }

  if (perfil.commercial.propuesta.problema || perfil.commercial.propuesta.resultado) {
    partes.push(`PROPUESTA DE VALOR:`);
    if (perfil.commercial.propuesta.problema) partes.push(`  · Resuelve: ${perfil.commercial.propuesta.problema}`);
    if (perfil.commercial.propuesta.resultado) partes.push(`  · Logra: ${perfil.commercial.propuesta.resultado}`);
  }

  if (perfil.commercial.vende.length > 0) {
    partes.push("CATÁLOGO DE PRODUCTOS/SERVICIOS:");
    for (const v of perfil.commercial.vende) {
      const precio = v.precio ? ` [${v.precio}]` : "";
      partes.push(`  · ${v.nombre}${precio}: ${v.detalle}`);
    }
  }

  const ofertasActivas = evaluarOfertasTemporales(perfil.marketing.ofertasTemporales).filter((o) => o.activo);
  if (ofertasActivas.length || perfil.commercial.ofertas.length) {
    partes.push("OFERTAS VIGENTES:");
    for (const o of perfil.commercial.ofertas) partes.push(`  · ${o.texto}`);
    for (const ot of ofertasActivas) partes.push(`  · ${ot.titulo}: ${ot.detalle} (expira ${ot.expiraEn})`);
  }

  if (perfil.commercial.vocabularioCliente.length > 0) {
    partes.push("VOCABULARIO REAL DE LOS CLIENTES:");
    for (const voc of perfil.commercial.vocabularioCliente.slice(0, 6)) {
      partes.push(`  · «${voc}»`);
    }
  }

  return {
    contextoTexto: partes.join("\n"),
    canalesSugeridos: perfil.marketing.canalesPreferidos.length ? perfil.marketing.canalesPreferidos : ["meta", "google"],
    productosFoco: perfil.marketing.productosFoco,
    whatsappConectado: perfil.business.whatsappConectado,
    ubicacion: perfil.business.ubicacion,
  };
}

/**
 * Proyección para el Copiloto de Marketing.
 */
export function proyeccionCopiloto(perfil: PerfilNegocioMarketing): {
  contextoTexto: string;
  perfilResumido: {
    nombre: string;
    rubro: string;
    tipo: TipoNegocio;
    prioridad: string | null;
    focos: string[];
    productos: string[];
  };
} {
  const architect = proyeccionArchitect(perfil);
  return {
    contextoTexto: architect.contextoTexto,
    perfilResumido: {
      nombre: perfil.business.nombre,
      rubro: perfil.business.rubro,
      tipo: perfil.business.tipoNegocio,
      prioridad: perfil.marketing.prioridadActual,
      focos: perfil.marketing.productosFoco,
      productos: perfil.commercial.vende.map((v) => v.nombre),
    },
  };
}

/**
 * Proyección hacia el legacy `ContextoMarca`.
 * Elimina la dualidad conceptual haciendo que cualquier consumidor antiguo
 * reciba exactamente la misma verdad canónica.
 */
export function proyeccionContextoMarca(
  perfil: PerfilNegocioMarketing,
  demo = false,
): ContextoMarca {
  const ofertas = perfil.commercial.vende.map((v) => ({
    titulo: v.nombre,
    detalle: [v.precio, v.detalle].filter(Boolean).join(" — ") || v.nombre,
  }));

  const saber = perfil.commercial.vocabularioCliente.map((voc, idx) => ({
    tipo: "piden" as const,
    clave: `item_${idx + 1}`,
    texto: voc,
    veces: 10 - idx,
  }));

  const descripcion =
    perfil.commercial.propuesta.resultado ||
    perfil.commercial.propuesta.problema ||
    `${perfil.business.nombre}, ${perfil.business.rubro}${perfil.business.ubicacion ? ` en ${perfil.business.ubicacion}` : ""}.`;

  return {
    nombre: perfil.business.nombre,
    rubro: perfil.business.rubro,
    descripcion,
    ofertas,
    saber,
    saberTexto: perfil.commercial.vocabularioCliente.map((v) => `· ${v}`).join("\n"),
    whatsapp: perfil.business.whatsappConectado ? "WhatsApp conectado" : null,
    zona: perfil.business.ubicacion,
    demo,
  };
}

/* ── Fixture Determinista de Demostración ────────────────────────────────── */

export function perfilMarketingDemo(): PerfilNegocioMarketing {
  const comDemo = contextoComercialDemo();
  return {
    clienteId: "demo-cliente-000",
    business: {
      nombre: NEGOCIO_DEMO.nombre,
      rubro: NEGOCIO_DEMO.rubro,
      categoria: "Imprenta y Gráfica",
      sitioWeb: "https://graficaandina.cl",
      ubicacion: NEGOCIO_DEMO.ciudad,
      cobertura: "Chillán y Región de Ñuble",
      tipoNegocio: "b2b",
      whatsappConectado: true,
    },
    brand: {
      logoUrl: "/marketing/demo/logo.png",
      paletaColores: {
        primario: "#2563eb",
        secundario: "#1e293b",
        acento: "#f59e0b",
        fondo: "#ffffff",
      },
      estiloVisual: "Fotografía publicitaria limpia, materiales reales de imprenta sobre mesa de trabajo.",
      elementosProhibidos: ["mockups con texto ilegible", "logos ajenos", "fotos genéricas de stock"],
    },
    commercial: comDemo,
    marketing: {
      prioridadActual: "Impulsar pendones roller y gigantografías con entrega en 24h para eventos",
      productosFoco: ["Pendón roller 80×200", "Gigantografía PVC"],
      segmentosObjetivo: ["Empresas locales", "Organizaciones de eventos", "Comercios"],
      canalesPreferidos: ["meta", "google"],
      metaConversion: "cotizaciones",
      ofertasTemporales: [
        {
          id: "promo-roller-24h",
          titulo: "Pendón roller express",
          detalle: "Listo en 24 horas con bolso incluido",
          expiraEn: "2099-12-31",
          activo: true,
          fuente: "declarado",
        },
      ],
    },
    invalidation: {
      stale: false,
      razonStale: null,
      fichasHash: "demo-hash",
      ultimoCalculo: new Date().toISOString(),
    },
    editado: false,
    actualizadoEn: new Date().toISOString(),
  };
}

/* ── Validación Runtime de Server Actions (FASE 10) ──────────────────────── */

export type ParcialPerfilMarketing = {
  business?: Partial<BusinessProfile>;
  brand?: Partial<BrandProfile>;
  marketing?: Partial<MarketingProfile>;
  commercial?: Partial<ContextoComercial>;
};

export type ResultadoValidacionParcial =
  | { ok: true; valido: true; datos: ParcialPerfilMarketing }
  | { ok: false; valido: false; motivo: string };

export function validarParcialPerfil(
  datos: unknown,
): ResultadoValidacionParcial {
  const fallo = (motivo: string): ResultadoValidacionParcial => ({ ok: false, valido: false, motivo });
  const exito = (res: ParcialPerfilMarketing): ResultadoValidacionParcial => ({ ok: true, valido: true, datos: res });

  if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
    return fallo("El payload debe ser un objeto válido.");
  }

  const d = datos as Record<string, unknown>;
  const topKeys = Object.keys(d);
  const permitidas = new Set(["business", "brand", "marketing", "commercial"]);

  for (const k of topKeys) {
    if (!permitidas.has(k)) {
      return fallo(`Propiedad no permitida: ${k}`);
    }
  }

  const res: ParcialPerfilMarketing = {};

  // Validar business
  if (d.business !== undefined) {
    if (!d.business || typeof d.business !== "object" || Array.isArray(d.business)) {
      return fallo("business debe ser un objeto.");
    }
    const b = d.business as Record<string, unknown>;
    const permitidasB = new Set(["nombre", "rubro", "categoria", "sitioWeb", "ubicacion", "cobertura", "tipoNegocio", "telefonoContacto"]);
    for (const k of Object.keys(b)) {
      if (!permitidasB.has(k)) return fallo(`Propiedad no permitida en business: ${k}`);
    }
    if (b.nombre !== undefined && (typeof b.nombre !== "string" || b.nombre.length > 120)) {
      return fallo("nombre debe ser un string de máximo 120 caracteres.");
    }
    if (b.rubro !== undefined && (typeof b.rubro !== "string" || b.rubro.length > 100)) {
      return fallo("rubro debe ser un string de máximo 100 caracteres.");
    }
    if (b.categoria !== undefined && (typeof b.categoria !== "string" || b.categoria.length > 100)) {
      return fallo("categoria debe ser un string de máximo 100 caracteres.");
    }
    if (b.sitioWeb !== undefined && b.sitioWeb !== null && (typeof b.sitioWeb !== "string" || b.sitioWeb.length > 200)) {
      return fallo("sitioWeb debe ser un string o null de máximo 200 caracteres.");
    }
    if (b.ubicacion !== undefined && b.ubicacion !== null && (typeof b.ubicacion !== "string" || b.ubicacion.length > 100)) {
      return fallo("ubicacion debe ser un string o null de máximo 100 caracteres.");
    }
    if (b.cobertura !== undefined && b.cobertura !== null && (typeof b.cobertura !== "string" || b.cobertura.length > 100)) {
      return fallo("cobertura debe ser un string o null de máximo 100 caracteres.");
    }
    if (b.tipoNegocio !== undefined && !["b2b", "b2c", "ambos"].includes(b.tipoNegocio as string)) {
      return fallo("tipoNegocio debe ser 'b2b', 'b2c' o 'ambos'.");
    }
    res.business = b as Partial<BusinessProfile>;
  }

  // Validar brand
  if (d.brand !== undefined) {
    if (!d.brand || typeof d.brand !== "object" || Array.isArray(d.brand)) {
      return fallo("brand debe ser un objeto.");
    }
    const br = d.brand as Record<string, unknown>;
    const permitidasBr = new Set(["logoUrl", "paletaColores", "estiloVisual", "elementosProhibidos"]);
    for (const k of Object.keys(br)) {
      if (!permitidasBr.has(k)) return fallo(`Propiedad no permitida en brand: ${k}`);
    }
    if (br.logoUrl !== undefined && br.logoUrl !== null && (typeof br.logoUrl !== "string" || br.logoUrl.length > 300)) {
      return fallo("logoUrl debe ser un string o null de máximo 300 caracteres.");
    }
    if (br.estiloVisual !== undefined && br.estiloVisual !== null && (typeof br.estiloVisual !== "string" || br.estiloVisual.length > 300)) {
      return fallo("estiloVisual debe ser un string o null de máximo 300 caracteres.");
    }
    if (br.paletaColores !== undefined && br.paletaColores !== null) {
      if (typeof br.paletaColores !== "object" || Array.isArray(br.paletaColores)) {
        return fallo("paletaColores debe ser un objeto o null.");
      }
      const pc = br.paletaColores as Record<string, unknown>;
      const hexRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
      for (const [colKey, colVal] of Object.entries(pc)) {
        if (!["primario", "secundario", "acento", "fondo"].includes(colKey)) {
          return fallo(`Color no permitido en paleta: ${colKey}`);
        }
        if (colVal !== undefined && (typeof colVal !== "string" || !hexRegex.test(colVal))) {
          return fallo(`Color hexadecimal inválido para ${colKey}: ${colVal}`);
        }
      }
    }
    if (br.elementosProhibidos !== undefined) {
      if (!Array.isArray(br.elementosProhibidos)) {
        return fallo("elementosProhibidos debe ser un array.");
      }
      if (br.elementosProhibidos.length > 30) {
        return fallo("Máximo 30 elementos prohibidos permitidos.");
      }
      for (const ep of br.elementosProhibidos) {
        if (typeof ep !== "string" || ep.length > 100) {
          return fallo("Cada elemento en elementosProhibidos debe ser un string de máximo 100 caracteres.");
        }
      }
    }
    res.brand = br as Partial<BrandProfile>;
  }

  // Validar marketing
  if (d.marketing !== undefined) {
    if (!d.marketing || typeof d.marketing !== "object" || Array.isArray(d.marketing)) {
      return fallo("marketing debe ser un objeto.");
    }
    const m = d.marketing as Record<string, unknown>;
    const permitidasM = new Set(["prioridadActual", "productosFoco", "segmentosObjetivo", "canalesPreferidos", "metaConversion", "ofertasTemporales"]);
    for (const k of Object.keys(m)) {
      if (!permitidasM.has(k)) return fallo(`Propiedad no permitida en marketing: ${k}`);
    }
    if (m.prioridadActual !== undefined && m.prioridadActual !== null && (typeof m.prioridadActual !== "string" || m.prioridadActual.length > 300)) {
      return fallo("prioridadActual debe ser un string o null de máximo 300 caracteres.");
    }
    if (m.productosFoco !== undefined) {
      if (!Array.isArray(m.productosFoco)) return fallo("productosFoco debe ser un array.");
      if (m.productosFoco.length > 20) return fallo("Máximo 20 productos foco permitidos.");
      for (const pf of m.productosFoco) {
        if (typeof pf !== "string" || pf.length > 100) return fallo("Cada producto foco debe ser un string de máximo 100 caracteres.");
      }
    }
    if (m.segmentosObjetivo !== undefined) {
      if (!Array.isArray(m.segmentosObjetivo)) return fallo("segmentosObjetivo debe ser un array.");
      if (m.segmentosObjetivo.length > 20) return fallo("Máximo 20 segmentos objetivo permitidos.");
      for (const so of m.segmentosObjetivo) {
        if (typeof so !== "string" || so.length > 100) return fallo("Cada segmento objetivo debe ser un string de máximo 100 caracteres.");
      }
    }
    if (m.canalesPreferidos !== undefined) {
      if (!Array.isArray(m.canalesPreferidos)) return fallo("canalesPreferidos debe ser un array.");
      for (const cp of m.canalesPreferidos) {
        if (cp !== "meta" && cp !== "google") return fallo("canalesPreferidos solo admite 'meta' o 'google'.");
      }
    }
    if (m.metaConversion !== undefined && m.metaConversion !== null && (typeof m.metaConversion !== "string" || m.metaConversion.length > 100)) {
      return fallo("metaConversion debe ser un string o null de máximo 100 caracteres.");
    }
    if (m.ofertasTemporales !== undefined) {
      if (!Array.isArray(m.ofertasTemporales)) return fallo("ofertasTemporales debe ser un array.");
      if (m.ofertasTemporales.length > 20) return fallo("Máximo 20 ofertas temporales permitidas.");
      const fuentesValidas = new Set(["declarado", "catalogo", "conocimiento", "publicidad", "conversaciones", "inferido"]);
      for (const ot of m.ofertasTemporales) {
        if (!ot || typeof ot !== "object") return fallo("Cada oferta temporal debe ser un objeto.");
        const o = ot as Record<string, unknown>;
        if (typeof o.id !== "string" || o.id.length > 60) return fallo("id de oferta inválido.");
        if (typeof o.titulo !== "string" || o.titulo.length > 100) return fallo("titulo de oferta inválido.");
        if (typeof o.detalle !== "string" || o.detalle.length > 250) return fallo("detalle de oferta inválido.");
        if (typeof o.expiraEn !== "string" || resolverInstanteExpiracionMs(o.expiraEn) === null) {
          return fallo(`Fecha de expiración inválida en oferta: ${o.expiraEn}`);
        }
        if (typeof o.activo !== "boolean") return fallo("activo en oferta debe ser un booleano.");
        if (typeof o.fuente !== "string" || !fuentesValidas.has(o.fuente)) {
          return fallo(`fuente en oferta inválida: ${o.fuente}`);
        }
      }
    }
    res.marketing = m as Partial<MarketingProfile>;
  }

  // Validar commercial
  if (d.commercial !== undefined) {
    if (!d.commercial || typeof d.commercial !== "object" || Array.isArray(d.commercial)) {
      return fallo("commercial debe ser un objeto.");
    }
    const c = d.commercial as Record<string, unknown>;
    const permitidasC = new Set([
      "negocio",
      "vende",
      "capacidades",
      "audiencia",
      "propuesta",
      "diferenciadores",
      "ofertas",
      "pruebas",
      "voz",
      "noAfirmar",
      "vocabularioCliente",
      "fuentes",
      "descartados",
      "aviso",
    ]);

    for (const k of Object.keys(c)) {
      if (!permitidasC.has(k)) {
        return fallo(`Propiedad no permitida en commercial: ${k}`);
      }
    }

    if (c.negocio !== undefined) {
      if (!c.negocio || typeof c.negocio !== "object" || Array.isArray(c.negocio)) {
        return fallo("commercial.negocio debe ser un objeto.");
      }
      const neg = c.negocio as Record<string, unknown>;
      const permitidasNeg = new Set(["nombre", "rubro", "zona", "sitio"]);
      for (const nk of Object.keys(neg)) {
        if (!permitidasNeg.has(nk)) return fallo(`Propiedad no permitida en commercial.negocio: ${nk}`);
      }
      if (neg.nombre !== undefined && (typeof neg.nombre !== "string" || neg.nombre.length > 120)) {
        return fallo("commercial.negocio.nombre debe ser un string de máximo 120 caracteres.");
      }
      if (neg.rubro !== undefined && (typeof neg.rubro !== "string" || neg.rubro.length > 100)) {
        return fallo("commercial.negocio.rubro debe ser un string de máximo 100 caracteres.");
      }
      if (neg.zona !== undefined && neg.zona !== null && (typeof neg.zona !== "string" || neg.zona.length > 100)) {
        return fallo("commercial.negocio.zona debe ser un string o null de máximo 100 caracteres.");
      }
      if (neg.sitio !== undefined && neg.sitio !== null && (typeof neg.sitio !== "string" || neg.sitio.length > 200)) {
        return fallo("commercial.negocio.sitio debe ser un string o null de máximo 200 caracteres.");
      }
    }

    const fuentesValidas = new Set(["declarado", "catalogo", "conocimiento", "conversaciones", "publicidad", "inferido"]);

    if (c.vende !== undefined) {
      if (!Array.isArray(c.vende)) return fallo("commercial.vende debe ser un array.");
      if (c.vende.length > 50) return fallo("Máximo 50 productos permitidos en commercial.vende.");
      const permitidasVende = new Set(["nombre", "tipo", "detalle", "precio", "fuente"]);
      for (const item of c.vende) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return fallo("Cada elemento de commercial.vende debe ser un objeto.");
        }
        const v = item as Record<string, unknown>;
        for (const vk of Object.keys(v)) {
          if (!permitidasVende.has(vk)) return fallo(`Propiedad no permitida en item de commercial.vende: ${vk}`);
        }
        if (typeof v.nombre !== "string" || !v.nombre.trim() || v.nombre.length > 120) {
          return fallo("commercial.vende: nombre es obligatorio y debe tener máximo 120 caracteres.");
        }
        if (v.tipo !== undefined && v.tipo !== "producto" && v.tipo !== "servicio" && v.tipo !== "plan") {
          return fallo("commercial.vende: tipo debe ser 'producto', 'servicio' o 'plan'.");
        }
        if (v.detalle !== undefined && (typeof v.detalle !== "string" || v.detalle.length > 300)) {
          return fallo("commercial.vende: detalle debe ser un string de máximo 300 caracteres.");
        }
        if (v.precio !== undefined && v.precio !== null && (typeof v.precio !== "string" || v.precio.length > 100)) {
          return fallo("commercial.vende: precio debe ser un string o null de máximo 100 caracteres.");
        }
        if (v.fuente !== undefined && (typeof v.fuente !== "string" || !fuentesValidas.has(v.fuente))) {
          return fallo(`commercial.vende: fuente inválida: ${v.fuente}`);
        }
      }
    }

    if (c.capacidades !== undefined) {
      if (!Array.isArray(c.capacidades)) return fallo("commercial.capacidades debe ser un array.");
      if (c.capacidades.length > 30) return fallo("Máximo 30 capacidades permitidas.");
      for (const cap of c.capacidades) {
        if (typeof cap !== "string" || cap.length > 200) {
          return fallo("Cada capacidad debe ser un string de máximo 200 caracteres.");
        }
      }
    }

    if (c.audiencia !== undefined) {
      if (!c.audiencia || typeof c.audiencia !== "object" || Array.isArray(c.audiencia)) {
        return fallo("commercial.audiencia debe ser un objeto.");
      }
      const aud = c.audiencia as Record<string, unknown>;
      const permitidasAud = new Set(["descripcion", "rubros"]);
      for (const ak of Object.keys(aud)) {
        if (!permitidasAud.has(ak)) return fallo(`Propiedad no permitida en commercial.audiencia: ${ak}`);
      }
      if (aud.descripcion !== undefined && (typeof aud.descripcion !== "string" || aud.descripcion.length > 300)) {
        return fallo("commercial.audiencia.descripcion debe ser un string de máximo 300 caracteres.");
      }
      if (aud.rubros !== undefined) {
        if (!Array.isArray(aud.rubros)) return fallo("commercial.audiencia.rubros debe ser un array.");
        if (aud.rubros.length > 20) return fallo("Máximo 20 rubros en audiencia.");
        for (const r of aud.rubros) {
          if (typeof r !== "string" || r.length > 100) return fallo("Cada rubro debe ser un string de máximo 100 caracteres.");
        }
      }
    }

    if (c.propuesta !== undefined) {
      if (!c.propuesta || typeof c.propuesta !== "object" || Array.isArray(c.propuesta)) {
        return fallo("commercial.propuesta debe ser un objeto.");
      }
      const prop = c.propuesta as Record<string, unknown>;
      const permitidasProp = new Set(["problema", "resultado"]);
      for (const pk of Object.keys(prop)) {
        if (!permitidasProp.has(pk)) return fallo(`Propiedad no permitida en commercial.propuesta: ${pk}`);
      }
      if (prop.problema !== undefined && (typeof prop.problema !== "string" || prop.problema.length > 300)) {
        return fallo("commercial.propuesta.problema debe ser un string de máximo 300 caracteres.");
      }
      if (prop.resultado !== undefined && (typeof prop.resultado !== "string" || prop.resultado.length > 300)) {
        return fallo("commercial.propuesta.resultado debe ser un string de máximo 300 caracteres.");
      }
    }

    if (c.diferenciadores !== undefined) {
      if (!Array.isArray(c.diferenciadores)) return fallo("commercial.diferenciadores debe ser un array.");
      if (c.diferenciadores.length > 30) return fallo("Máximo 30 diferenciadores permitidos.");
      for (const dif of c.diferenciadores) {
        if (typeof dif !== "string" || dif.length > 200) {
          return fallo("Cada diferenciador debe ser un string de máximo 200 caracteres.");
        }
      }
    }

    if (c.ofertas !== undefined) {
      if (!Array.isArray(c.ofertas)) return fallo("commercial.ofertas debe ser un array.");
      if (c.ofertas.length > 30) return fallo("Máximo 30 ofertas permitidas.");
      const permitidasOf = new Set(["texto", "fuente", "reserva"]);
      for (const item of c.ofertas) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return fallo("Cada oferta debe ser un objeto.");
        }
        const o = item as Record<string, unknown>;
        for (const ok of Object.keys(o)) {
          if (!permitidasOf.has(ok)) return fallo(`Propiedad no permitida en item de commercial.ofertas: ${ok}`);
        }
        if (typeof o.texto !== "string" || !o.texto.trim() || o.texto.length > 300) {
          return fallo("commercial.ofertas: texto es obligatorio y debe tener máximo 300 caracteres.");
        }
        if (o.fuente !== undefined && (typeof o.fuente !== "string" || !fuentesValidas.has(o.fuente))) {
          return fallo(`commercial.ofertas: fuente inválida: ${o.fuente}`);
        }
        if (o.reserva !== undefined && o.reserva !== null && (typeof o.reserva !== "string" || o.reserva.length > 200)) {
          return fallo("commercial.ofertas: reserva debe ser un string o null de máximo 200 caracteres.");
        }
      }
    }

    if (c.pruebas !== undefined) {
      if (!Array.isArray(c.pruebas)) return fallo("commercial.pruebas debe ser un array.");
      if (c.pruebas.length > 30) return fallo("Máximo 30 pruebas permitidas.");
      const permitidasPr = new Set(["texto", "fuente", "reserva"]);
      for (const item of c.pruebas) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return fallo("Cada prueba debe ser un objeto.");
        }
        const p = item as Record<string, unknown>;
        for (const pk of Object.keys(p)) {
          if (!permitidasPr.has(pk)) return fallo(`Propiedad no permitida en item de commercial.pruebas: ${pk}`);
        }
        if (typeof p.texto !== "string" || !p.texto.trim() || p.texto.length > 300) {
          return fallo("commercial.pruebas: texto es obligatorio y debe tener máximo 300 caracteres.");
        }
        if (p.fuente !== undefined && (typeof p.fuente !== "string" || !fuentesValidas.has(p.fuente))) {
          return fallo(`commercial.pruebas: fuente inválida: ${p.fuente}`);
        }
        if (p.reserva !== undefined && p.reserva !== null && (typeof p.reserva !== "string" || p.reserva.length > 200)) {
          return fallo("commercial.pruebas: reserva debe ser un string o null de máximo 200 caracteres.");
        }
      }
    }

    if (c.voz !== undefined) {
      if (!c.voz || typeof c.voz !== "object" || Array.isArray(c.voz)) {
        return fallo("commercial.voz debe ser un objeto.");
      }
      const v = c.voz as Record<string, unknown>;
      const permitidasVoz = new Set(["formalidad", "energia", "tecnicidad", "franqueza", "emojis", "frase", "afirmacion", "prohibidas", "origen"]);
      for (const vk of Object.keys(v)) {
        if (!permitidasVoz.has(vk)) return fallo(`Propiedad no permitida en commercial.voz: ${vk}`);
      }
      if (v.formalidad !== undefined && !["tuteo", "neutro", "usted"].includes(v.formalidad as string)) {
        return fallo("commercial.voz.formalidad inválida.");
      }
      if (v.energia !== undefined && !["sobria", "media", "alta"].includes(v.energia as string)) {
        return fallo("commercial.voz.energia inválida.");
      }
      if (v.tecnicidad !== undefined && !["llana", "media", "tecnica"].includes(v.tecnicidad as string)) {
        return fallo("commercial.voz.tecnicidad inválida.");
      }
      if (v.franqueza !== undefined && !["suave", "directa"].includes(v.franqueza as string)) {
        return fallo("commercial.voz.franqueza inválida.");
      }
      if (v.emojis !== undefined && !["nunca", "ocasional"].includes(v.emojis as string)) {
        return fallo("commercial.voz.emojis inválida.");
      }
      if (v.frase !== undefined && !["corta", "mixta", "desarrollada"].includes(v.frase as string)) {
        return fallo("commercial.voz.frase inválida.");
      }
      if (v.afirmacion !== undefined && !["cauta", "directa", "rotunda"].includes(v.afirmacion as string)) {
        return fallo("commercial.voz.afirmacion inválida.");
      }
      if (v.origen !== undefined && !["declarada", "rubro", "por defecto"].includes(v.origen as string)) {
        return fallo("commercial.voz.origen inválida.");
      }
      if (v.prohibidas !== undefined) {
        if (!Array.isArray(v.prohibidas)) return fallo("commercial.voz.prohibidas debe ser un array.");
        if (v.prohibidas.length > 30) return fallo("Máximo 30 frases prohibidas en commercial.voz.");
        for (const p of v.prohibidas) {
          if (typeof p !== "string" || p.length > 100) return fallo("Cada frase prohibida debe ser un string de máximo 100 caracteres.");
        }
      }
    }

    if (c.noAfirmar !== undefined) {
      if (!Array.isArray(c.noAfirmar)) return fallo("commercial.noAfirmar debe ser un array.");
      if (c.noAfirmar.length > 50) return fallo("Máximo 50 elementos en commercial.noAfirmar.");
      for (const na of c.noAfirmar) {
        if (typeof na !== "string" || na.length > 200) return fallo("Cada elemento en commercial.noAfirmar debe ser un string de máximo 200 caracteres.");
      }
    }

    if (c.vocabularioCliente !== undefined) {
      if (!Array.isArray(c.vocabularioCliente)) return fallo("commercial.vocabularioCliente debe ser un array.");
      if (c.vocabularioCliente.length > 50) return fallo("Máximo 50 elementos en commercial.vocabularioCliente.");
      for (const vc of c.vocabularioCliente) {
        if (typeof vc !== "string" || vc.length > 100) return fallo("Cada elemento en commercial.vocabularioCliente debe ser un string de máximo 100 caracteres.");
      }
    }

    if (c.fuentes !== undefined) {
      if (!Array.isArray(c.fuentes)) return fallo("commercial.fuentes debe ser un array.");
      if (c.fuentes.length > 50) return fallo("Máximo 50 elementos en commercial.fuentes.");
      const rolesValidos = new Set([
        "identidad",
        "catalogo",
        "capacidad",
        "oferta",
        "prueba",
        "audiencia",
        "problema",
        "voz",
        "precio",
        "mecanica",
        "faq",
        "operacion",
      ]);
      const permitidasItemFuente = new Set(["rol", "titulo", "motivo"]);
      for (const item of c.fuentes) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return fallo("Cada elemento de commercial.fuentes debe ser un objeto.");
        }
        const f = item as Record<string, unknown>;
        for (const fk of Object.keys(f)) {
          if (!permitidasItemFuente.has(fk)) {
            return fallo(`Propiedad no permitida en item de commercial.fuentes: ${fk}`);
          }
        }
        if (typeof f.rol !== "string" || !rolesValidos.has(f.rol)) {
          return fallo("commercial.fuentes: rol inválido.");
        }
        if (typeof f.titulo !== "string" || !f.titulo.trim() || f.titulo.length > 200) {
          return fallo("commercial.fuentes: titulo es obligatorio y debe tener máximo 200 caracteres.");
        }
        if (typeof f.motivo !== "string" || f.motivo.length > 300) {
          return fallo("commercial.fuentes: motivo es obligatorio y debe tener máximo 300 caracteres.");
        }
      }
    }

    if (c.descartados !== undefined) {
      if (!Array.isArray(c.descartados)) return fallo("commercial.descartados debe ser un array.");
      if (c.descartados.length > 50) return fallo("Máximo 50 elementos en commercial.descartados.");
      const permitidasItemDescartado = new Set(["titulo", "motivo"]);
      for (const item of c.descartados) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return fallo("Cada elemento de commercial.descartados debe ser un objeto.");
        }
        const dItem = item as Record<string, unknown>;
        for (const dk of Object.keys(dItem)) {
          if (!permitidasItemDescartado.has(dk)) {
            return fallo(`Propiedad no permitida en item de commercial.descartados: ${dk}`);
          }
        }
        if (typeof dItem.titulo !== "string" || !dItem.titulo.trim() || dItem.titulo.length > 200) {
          return fallo("commercial.descartados: titulo es obligatorio y debe tener máximo 200 caracteres.");
        }
        if (typeof dItem.motivo !== "string" || dItem.motivo.length > 300) {
          return fallo("commercial.descartados: motivo es obligatorio y debe tener máximo 300 caracteres.");
        }
      }
    }

    if (c.aviso !== undefined && c.aviso !== null && (typeof c.aviso !== "string" || c.aviso.length > 300)) {
      return fallo("commercial.aviso debe ser un string o null de máximo 300 caracteres.");
    }

    res.commercial = c as Partial<ContextoComercial>;
  }

  return exito(res);
}

export { AUTORIDAD, type Fuente, type EntidadComercial, type Afirmacion };
