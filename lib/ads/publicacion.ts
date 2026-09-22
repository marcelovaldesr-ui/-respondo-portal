import type { Monto } from "@/lib/ads/moneda";
import type { Proveedor } from "@/lib/ads/canal";

/**
 * MODELO UNIFICADO DE PUBLICACIÓN EN PLATAFORMAS NATIVAS (META + GOOGLE).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * REGLA FUNDAMENTAL SOBRE DINERO:
 * Toda publicación se realiza ESTRICTAMENTE en estado PAUSED / PAUSADA.
 * La campaña se crea en Meta Ads Manager o Google Ads con sus identificadores
 * reales, pero no empieza a gastar dinero hasta una activación explícita.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type EstadoPublicacionPlataforma =
  | "creando"
  | "pausada"
  | "activa"
  | "en_revision"
  | "rechazada"
  | "error";

export type FallaPublicacion = {
  codigo: string;
  tipo?: string;
  mensaje: string;
  campo?: string;
  detalleTecnico?: string;
  accionSugerida?: string;
};

export type VistaPreviaPublicacion = {
  plataforma: Proveedor;
  cuentaId: string;
  cuentaNombre: string;
  moneda: string;
  objetivo: string;
  destino: string;
  destinoDetalle: string;
  presupuesto: {
    diario?: Monto | null;
    total?: Monto | null;
  };
  audienciaResumen: string;
  ubicaciones: string[];
  anuncios: {
    titular: string;
    texto: string;
    cta: string;
    imagenUrl?: string | null;
    formato?: string;
  }[];
  palabrasClave?: { texto: string; concordancia: string }[];
  negativas?: string[];
  trackingUtm: Record<string, string>;
  /** Meta: Página a cuyo nombre sale el anuncio (nombre y foto de perfil). */
  identidad?: {
    paginaId: string;
    nombre: string;
    fotoUrl: string | null;
    enlace: string | null;
  } | null;
  estadoInicial: "PAUSED";
  puedePublicar: boolean;
  advertencias: string[];
  bloqueos: string[];
};

export type ResultadoPublicacion = {
  ok: boolean;
  plataforma: Proveedor;
  clienteId: string;
  cuentaId: string;
  campaignId?: string;
  adGroupOrAdSetId?: string;
  adIds?: string[];
  /** Creatividades creadas (Meta). Se guardan para poder rastrear el anuncio. */
  creativeIds?: string[];
  /** Google: presupuesto creado (campaignBudgets/{id}). */
  budgetId?: string;
  /** Google: criterios de palabra clave creados (adGroupCriteria/{grupo}~{id}). */
  keywordIds?: string[];
  status: EstadoPublicacionPlataforma;
  createdAt: string;
  urlNativa?: string;
  idempotencyKey: string;
  nativeErrors?: FallaPublicacion[];
  mensaje: string;
};

/**
 * Cache de claves de idempotencia en memoria del proceso (TTL: 15 minutos).
 * Previene ejecuciones paralelas o repetidas por doble-click accidental.
 */
type EntradaIdempotencia = {
  tiempo: number;
  resultado?: ResultadoPublicacion;
  enProgreso: boolean;
};

const memoriaIdempotencia = new Map<string, EntradaIdempotencia>();
const TTL_IDEMPOTENCIA_MS = 15 * 60 * 1000;

export function generarClaveIdempotencia(
  clienteId: string,
  borradorId: string,
  plataforma: Proveedor,
): string {
  return `${clienteId}:${borradorId}:${plataforma}`;
}

export function verificarIdempotencia(clave: string): {
  enProgreso: boolean;
  resultado?: ResultadoPublicacion;
} {
  const ahora = Date.now();
  const entrada = memoriaIdempotencia.get(clave);
  if (!entrada) return { enProgreso: false };
  if (ahora - entrada.tiempo > TTL_IDEMPOTENCIA_MS) {
    memoriaIdempotencia.delete(clave);
    return { enProgreso: false };
  }
  return { enProgreso: entrada.enProgreso, resultado: entrada.resultado };
}

export function registrarInicioPublicacion(clave: string): void {
  memoriaIdempotencia.set(clave, {
    tiempo: Date.now(),
    enProgreso: true,
  });
}

export function registrarFinPublicacion(clave: string, resultado: ResultadoPublicacion): void {
  memoriaIdempotencia.set(clave, {
    tiempo: Date.now(),
    enProgreso: false,
    resultado,
  });
}

export function limpiarIdempotencia(clave?: string): void {
  if (clave) {
    memoriaIdempotencia.delete(clave);
  } else {
    memoriaIdempotencia.clear();
  }
}

/**
 * Sanitiza cualquier texto o payload antes de mostrarlo al cliente o loguearlo.
 * Elimina tokens, bearer strings, secrets y llaves privadas.
 */
export function sanitizarMensajeError(crudo: unknown): string {
  if (!crudo) return "Error desconocido";
  let texto = typeof crudo === "string" ? crudo : JSON.stringify(crudo);

  // Redactar tokens de Meta (EAAB..., EAA...)
  texto = texto.replace(/EAA[A-Za-z0-9]+/g, "[REDACTED_META_TOKEN]");
  // Redactar refresh tokens de Google (1//0...)
  texto = texto.replace(/1\/\/[A-Za-z0-9_-]+/g, "[REDACTED_GOOGLE_TOKEN]");
  // Access tokens de Google (ya29....) — viajan en cabeceras y pueden aparecer en un error.
  texto = texto.replace(/ya29\.[A-Za-z0-9._-]+/g, "[REDACTED_GOOGLE_ACCESS_TOKEN]");
  // Redactar Bearer tokens y secrets
  texto = texto.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  texto = texto.replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED]");
  texto = texto.replace(/\"?client_?secret\"?\s*:\s*\"[^\"]+\"/gi, '"client_secret":"[REDACTED]"');

  return texto.slice(0, 1000);
}
