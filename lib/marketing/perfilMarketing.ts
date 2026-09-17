import { db } from "@/lib/db";
import { listarFichas } from "@/lib/conocimiento";
import {
  contextoComercial,
  limpiarMemoriaContexto,
} from "@/lib/marketing/contextoComercial";
import type { ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import {
  conservarCorreccionesPerfil,
  evaluarOfertasTemporales,
  perfilMarketingDemo,
  proyeccionArchitect,
  proyeccionCopiloto,
  proyeccionCreative,
  proyeccionContextoMarca,
  validarParcialPerfil,
  type BrandProfile,
  type BusinessProfile,
  type InvalidationState,
  type MarketingProfile,
  type ParcialPerfilMarketing,
  type PerfilNegocioMarketing,
  type TipoNegocio,
} from "@/lib/marketing/perfilMarketingCore";
import { exigirId, leerDe, modificarEn, insertarEn, soloDe } from "@/lib/marketing/tenant";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOTOR DE PERSONALIZACIÓN PROFUNDA — ALMACENAMIENTO, CACHÉ E INVALIDACIÓN
 *
 * Conecta la ficha del cliente (`ed_clientes`), el conocimiento (`ed_conocimiento`),
 * el saber conversacional (`ed_isabel_saber`) y el contexto guardado (`ed_mk_contexto`)
 * en un único documento canónico `PerfilNegocioMarketing`.
 *
 * Mantiene compatibilidad total con la migración 310 persistiendo el perfil
 * completo dentro de `ed_mk_contexto.documento` y las columnas SQL de la 312.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TABLA = "ed_mk_contexto" as const;
const MEMORIA_PERFIL = new Map<string, { perfil: PerfilNegocioMarketing; hasta: number }>();
const VIDA_CACHE_MS = 10 * 60 * 1000;

function inferirTipoNegocio(rubro: string): TipoNegocio {
  const r = (rubro ?? "").toLowerCase();
  if (/abogad|legal|jur[ií]dic|imprenta|gr[aá]fic|b2b|consultor|software|saas|mayorist/i.test(r)) return "b2b";
  if (/peluquer|est[eé]tic|cl[ií]nic|veterinari|restauran|comida|tienda|retail|moda/i.test(r)) return "b2c";
  return "ambos";
}

function calcularHashFichas(fichas: Array<{ id?: string; actualizado_en?: string; titulo?: string; contenido?: string }>): string {
  if (!fichas.length) return "sin_fichas";
  const str = fichas
    .map((f) => `${f.id ?? ""}:${f.actualizado_en ?? ""}:${f.titulo ?? ""}:${(f.contenido ?? "").slice(0, 100)}`)
    .sort()
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Ensambla un perfil completo partiendo del cliente y el contexto comercial.
 */
export async function ensamblarPerfilMarketing(
  clienteId: string,
  comercial: ContextoComercial,
  fichasCrudas: Array<{ id?: string; actualizado_en?: string; titulo?: string }>,
  existente?: PerfilNegocioMarketing | null,
): Promise<PerfilNegocioMarketing> {
  exigirId(clienteId);

  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("nombre, rubro, waba_phone_id, telefono")
    .eq("id", clienteId)
    .maybeSingle();

  const nombre = String(cliente?.nombre ?? comercial.negocio.nombre ?? "Tu negocio");
  const rubro = String(cliente?.rubro ?? comercial.negocio.rubro ?? "");
  const ubicacion = comercial.negocio.zona ?? null;
  const sitioWeb = comercial.negocio.sitio ?? null;
  const tipoNegocio = inferirTipoNegocio(rubro);
  const whatsappConectado = Boolean(cliente?.waba_phone_id);

  const business: BusinessProfile = {
    nombre,
    rubro,
    categoria: rubro || "Comercio y Servicios",
    sitioWeb,
    ubicacion,
    cobertura: ubicacion ? `${ubicacion} y alrededores` : "Nacional",
    tipoNegocio,
    telefonoContacto: cliente?.telefono ? String(cliente.telefono) : null,
    whatsappConectado,
  };

  const brand: BrandProfile = {
    logoUrl: null,
    paletaColores: null,
    estiloVisual: "Limpio, profesional y enfocado en el producto real.",
    elementosProhibidos: ["precios no confirmados", "mockups con texto inventado", "logos de terceros"],
  };

  const marketing: MarketingProfile = {
    prioridadActual: null,
    productosFoco: comercial.vende.slice(0, 2).map((v) => v.nombre),
    segmentosObjetivo: comercial.audiencia.rubros.length ? comercial.audiencia.rubros : ["Público general"],
    canalesPreferidos: ["meta", "google"],
    metaConversion: comercial.vende.some((v) => v.tipo === "servicio") ? "cotizaciones" : "conversaciones",
    ofertasTemporales: [],
  };

  const hashActual = calcularHashFichas(fichasCrudas);

  const invalidation: InvalidationState = {
    stale: false,
    razonStale: null,
    fichasHash: hashActual,
    ultimoCalculo: new Date().toISOString(),
  };

  const nuevo: PerfilNegocioMarketing = {
    clienteId,
    business,
    brand,
    commercial: comercial,
    marketing: {
      ...marketing,
      ofertasTemporales: evaluarOfertasTemporales(marketing.ofertasTemporales),
    },
    invalidation,
    editado: Boolean(existente?.editado),
    actualizadoEn: new Date().toISOString(),
  };

  return existente ? conservarCorreccionesPerfil(nuevo, existente) : nuevo;
}

/**
 * Obtiene el perfil de marketing del negocio, con caché, verificación de
 * vigencia e invalidación just-in-time conservando correcciones humanas.
 */
export async function obtenerPerfilMarketing(
  clienteId: string,
  opciones: { demo?: boolean; refrescar?: boolean; reconstruir?: boolean } = {},
): Promise<PerfilNegocioMarketing> {
  if (opciones.demo) {
    return perfilMarketingDemo();
  }

  exigirId(clienteId);

  if (opciones.refrescar || opciones.reconstruir) {
    MEMORIA_PERFIL.delete(clienteId);
  }

  const enMemoria = MEMORIA_PERFIL.get(clienteId);
  if (enMemoria && enMemoria.hasta > Date.now() && !opciones.reconstruir) {
    return enMemoria.perfil;
  }

  const { data: dbData } = await leerDe(clienteId, TABLA).limit(1);
  const filas = soloDe(clienteId, TABLA, dbData as Record<string, unknown>[] | null);
  const fila = filas[0] ?? null;

  let perfilExistente: PerfilNegocioMarketing | null = null;
  if (fila?.documento) {
    const doc = fila.documento as Record<string, unknown>;
    if (doc.perfil && typeof doc.perfil === "object") {
      perfilExistente = doc.perfil as PerfilNegocioMarketing;
    } else if (doc.business && doc.commercial && doc.marketing) {
      perfilExistente = doc as unknown as PerfilNegocioMarketing;
    }
  }

  // Si la fila en la BD tiene las columnas 312, sincronizar estado de invalidación
  const filaStale = Boolean(fila?.stale);
  const filaStaleMotivo = (fila?.stale_motivo as string) ?? null;
  const filaFichasHash = (fila?.fichas_hash as string) ?? null;

  if (perfilExistente) {
    if (filaStale) {
      perfilExistente.invalidation.stale = true;
      if (filaStaleMotivo) perfilExistente.invalidation.razonStale = filaStaleMotivo;
    }
    if (filaFichasHash) {
      perfilExistente.invalidation.fichasHash = filaFichasHash;
    }
  }

  // Verificar si el conocimiento cambió desde el último cálculo
  const fichas = await listarFichas(clienteId).catch(() => []);
  const fichasVigentes = fichas.filter((f) => f.vigente);
  const hashActual = calcularHashFichas(fichasVigentes);

  const fichasCambiaron =
    Boolean(perfilExistente?.invalidation.fichasHash) &&
    perfilExistente?.invalidation.fichasHash !== hashActual;

  const necesitaReconstruir =
    opciones.reconstruir ||
    !perfilExistente ||
    fichasCambiaron ||
    filaStale ||
    Boolean(perfilExistente.invalidation.stale);

  if (!necesitaReconstruir && perfilExistente) {
    // Evaluar expiración de ofertas en tiempo real
    const ofertasEvaluadas = evaluarOfertasTemporales(perfilExistente.marketing.ofertasTemporales);
    const perfilActualizado: PerfilNegocioMarketing = {
      ...perfilExistente,
      marketing: {
        ...perfilExistente.marketing,
        ofertasTemporales: ofertasEvaluadas,
      },
    };
    MEMORIA_PERFIL.set(clienteId, { perfil: perfilActualizado, hasta: Date.now() + VIDA_CACHE_MS });
    return perfilActualizado;
  }

  // Obtener el ContextoComercial canónico
  const { contexto: comercial } = await contextoComercial(clienteId, {
    demo: false,
    refrescar: opciones.refrescar || fichariaronOStale(fichasCambiaron, perfilExistente),
    reconstruir: opciones.reconstruir,
  });

  const perfilFinal = await ensamblarPerfilMarketing(
    clienteId,
    comercial,
    fichasVigentes,
    perfilExistente,
  );

  // Al reconstruir, el estado de stale se limpia
  perfilFinal.invalidation.stale = false;
  perfilFinal.invalidation.razonStale = null;
  perfilFinal.invalidation.fichasHash = hashActual;

  // Guardar en la base de datos (dentro de ed_mk_contexto.documento y columnas 312)
  await guardarPerfilMarketingCanonica(clienteId, perfilFinal, fila?.id as string | undefined);

  MEMORIA_PERFIL.set(clienteId, { perfil: perfilFinal, hasta: Date.now() + VIDA_CACHE_MS });
  return perfilFinal;
}

function fichariaronOStale(fichasCambiaron: boolean, perfil: PerfilNegocioMarketing | null): boolean {
  return fichasCambiaron || Boolean(perfil?.invalidation.stale);
}

/**
 * Guarda el perfil en la base de datos dentro de `ed_mk_contexto.documento`
 * y sincroniza las columnas dedicadas de la migración 312 (`stale`, `stale_motivo`, `fichas_hash`).
 * También guarda las propiedades planas de `ContextoComercial` en el documento
 * para 100% de compatibilidad con lectores existentes de `ed_mk_contexto`.
 */
export async function guardarPerfilMarketingCanonica(
  clienteId: string,
  perfil: PerfilNegocioMarketing,
  idExistente?: string,
): Promise<boolean> {
  exigirId(clienteId);

  let id = idExistente;
  if (!id) {
    const { data: dbData } = await leerDe(clienteId, TABLA).limit(1);
    const filas = soloDe(clienteId, TABLA, dbData as Record<string, unknown>[] | null);
    id = (filas[0]?.id as string) ?? undefined;
  }

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

  const cuerpo: Record<string, unknown> = {
    documento: documentoFusionado as unknown as Record<string, unknown>,
    editado: perfil.editado,
    stale: perfil.invalidation.stale,
    stale_motivo: perfil.invalidation.razonStale,
    fichas_hash: perfil.invalidation.fichasHash,
    actualizado_en: new Date().toISOString(),
  };

  const r = id
    ? await modificarEn(clienteId, TABLA, id, cuerpo)
    : await insertarEn(clienteId, TABLA, cuerpo);

  if (!r.error) {
    MEMORIA_PERFIL.set(clienteId, { perfil, hasta: Date.now() + VIDA_CACHE_MS });
    limpiarMemoriaContexto(clienteId);
  }

  return !r.error;
}

/**
 * Guarda correcciones explícitas hechas por una persona al perfil.
 * Las correcciones reciben autoridad `declarado` (100) y registran overrides tri-estado.
 */
export async function actualizarPerfilMarketing(
  clienteId: string,
  parcial: ParcialPerfilMarketing,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  exigirId(clienteId);

  const validacion = validarParcialPerfil(parcial);
  if (!validacion.valido) {
    return { ok: false, motivo: validacion.motivo };
  }

  MEMORIA_PERFIL.delete(clienteId);
  limpiarMemoriaContexto(clienteId);

  const actual = await obtenerPerfilMarketing(clienteId);

  const nuevosOverrides: Record<string, boolean> = { ...(actual.overrides ?? {}) };
  if (parcial.business) {
    for (const k of Object.keys(parcial.business)) {
      nuevosOverrides[`business.${k}`] = true;
    }
  }
  if (parcial.brand) {
    for (const k of Object.keys(parcial.brand)) {
      nuevosOverrides[`brand.${k}`] = true;
    }
  }
  if (parcial.marketing) {
    for (const k of Object.keys(parcial.marketing)) {
      nuevosOverrides[`marketing.${k}`] = true;
    }
  }
  if (parcial.commercial) {
    for (const k of Object.keys(parcial.commercial)) {
      nuevosOverrides[`commercial.${k}`] = true;
    }
  }

  const actualizado: PerfilNegocioMarketing = {
    ...actual,
    business: parcial.business ? { ...actual.business, ...parcial.business } : actual.business,
    brand: parcial.brand ? { ...actual.brand, ...parcial.brand } : actual.brand,
    marketing: parcial.marketing ? { ...actual.marketing, ...parcial.marketing } : actual.marketing,
    commercial: parcial.commercial ? { ...actual.commercial, ...parcial.commercial } : actual.commercial,
    overrides: nuevosOverrides,
    editado: true,
    actualizadoEn: new Date().toISOString(),
  };

  const ok = await guardarPerfilMarketingCanonica(clienteId, actualizado);
  if (!ok) return { ok: false, motivo: "No se pudo guardar el perfil de marketing." };

  return { ok: true };
}

/**
 * Marca el perfil como stale (p.ej. cuando se crea, edita o borra una ficha).
 */
export async function marcarPerfilStale(clienteId: string, razon: string): Promise<void> {
  exigirId(clienteId);
  MEMORIA_PERFIL.delete(clienteId);
  limpiarMemoriaContexto(clienteId);

  const { data: dbData } = await leerDe(clienteId, TABLA).limit(1);
  const filas = soloDe(clienteId, TABLA, dbData as Record<string, unknown>[] | null);
  const fila = filas[0] ?? null;
  if (!fila?.documento) return;

  const doc = fila.documento as Record<string, unknown>;
  const invalidation: InvalidationState = {
    stale: true,
    razonStale: razon,
    fichasHash: (doc.invalidation as InvalidationState)?.fichasHash ?? (fila.fichas_hash as string) ?? null,
    ultimoCalculo: (doc.invalidation as InvalidationState)?.ultimoCalculo ?? new Date().toISOString(),
  };

  const docPerfil = (doc.perfil as PerfilNegocioMarketing) ?? null;
  const docActualizado = {
    ...doc,
    invalidation,
    ...(docPerfil ? { perfil: { ...docPerfil, invalidation } } : {}),
  };

  await modificarEn(clienteId, TABLA, fila.id as string, {
    documento: docActualizado,
    stale: true,
    stale_motivo: razon,
    actualizado_en: new Date().toISOString(),
  });
}

// Re-exportar proyecciones y tipos convenientes
export {
  proyeccionCreative,
  proyeccionArchitect,
  proyeccionCopiloto,
  proyeccionContextoMarca,
};
