import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * REGLAS PURAS DEL PROVEEDOR FLOW.CL — sin red ni base de datos.
 *
 * Testeable con `node --test` directamente sin Supabase ni dependencias externas.
 */

export const FLOW_MONTO_MIN = 350; // Mínimo oficial de Flow en Webpay Plus
export const FLOW_MONTO_MAX = 10_000_000;
export const FLOW_TIMEOUT_DEFECTO_S = 900; // 15 minutos

export const FLOW_URL_SANDBOX = "https://sandbox.flow.cl/api";
export const FLOW_URL_PRODUCCION = "https://www.flow.cl/api";

export type FlowModo = "sandbox" | "produccion";

export type EstadoPagoFlow = "pendiente" | "pagado" | "rechazado" | "anulado" | "expirado";

/**
 * Genera la firma digital HMAC-SHA256 exigida por la API de Flow.cl.
 *
 * Algoritmo oficial:
 *  1. Ordenar alfabéticamente todas las claves (excepto 's').
 *  2. Concatenar clave + valor sin separadores (ej: amount10000apiKeyXYZ...).
 *  3. Aplicar HMAC-SHA256 con secretKey.
 *  4. Convertir a string hexadecimal en minúsculas.
 */
export function firmarParametrosFlow(
  params: Record<string, string | number | boolean | null | undefined>,
  secretKey: string,
): string {
  if (!secretKey) throw new Error("Falta secretKey para firmar llamada Flow");

  const claves = Object.keys(params)
    .filter((k) => k !== "s" && params[k] !== undefined && params[k] !== null)
    .sort();

  let toSign = "";
  for (const k of claves) {
    toSign += `${k}${params[k]}`;
  }

  return createHmac("sha256", secretKey).update(toSign, "utf8").digest("hex");
}

/**
 * Valida la firma en tiempo constante para evitar ataques de timing.
 */
export function verificarFirmaFlow(
  params: Record<string, string | number | boolean | null | undefined>,
  secretKey: string,
  firmaRecibida: string,
): boolean {
  if (!firmaRecibida || !secretKey) return false;
  const esperada = firmarParametrosFlow(params, secretKey);
  const bufA = Buffer.from(esperada, "utf8");
  const bufB = Buffer.from(firmaRecibida, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Mapea el código numérico de estado devuelto por Flow.cl a nuestro modelo de estado.
 *
 * Estados oficiales Flow:
 *  1 = Pendiente de pago
 *  2 = Pagada
 *  3 = Rechazada
 *  4 = Anulada
 */
export function mapearEstadoFlow(statusFlow: number): EstadoPagoFlow {
  switch (statusFlow) {
    case 1:
      return "pendiente";
    case 2:
      return "pagado";
    case 3:
      return "rechazado";
    case 4:
      return "anulado";
    default:
      return "pendiente";
  }
}

/**
 * Genera una referencia única de orden comercial para Flow (`commerceOrder`).
 * Formato: `ORD-P-XXXXXX-TIMESTAMP` (máximo 45 caracteres, compatible con Flow).
 */
export function generarCommerceOrder(referenciaBase: string): string {
  const limpia = referenciaBase.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
  const ts = Date.now().toString(36).toUpperCase();
  return `${limpia}-${ts}`.slice(0, 45);
}

/**
 * Valida los parámetros de solicitud de creación de pago.
 */
export function validarParametrosCrearPago(p: {
  monto: number;
  concepto: string;
  email?: string | null;
  urlConfirmation: string;
  urlReturn: string;
}): { ok: true; monto: number; concepto: string; email: string } | { ok: false; error: string } {
  const monto = Math.round(Number(p.monto));
  if (!Number.isFinite(monto) || monto < FLOW_MONTO_MIN) {
    return { ok: false, error: `El monto mínimo para pagar con Flow es $${FLOW_MONTO_MIN.toLocaleString("es-CL")}.` };
  }
  if (monto > FLOW_MONTO_MAX) {
    return { ok: false, error: `El monto supera el máximo permitido de $${FLOW_MONTO_MAX.toLocaleString("es-CL")}.` };
  }

  const concepto = (p.concepto ?? "").trim().replace(/\s+/g, " ");
  if (!concepto) {
    return { ok: false, error: "Falta el concepto o descripción del cobro." };
  }
  if (concepto.length > 120) {
    return { ok: false, error: "El concepto es demasiado largo (máx 120 caracteres)." };
  }

  const email = (p.email ?? "").trim() || "contacto@respondo.io";
  if (!email.includes("@")) {
    return { ok: false, error: "El email del pagador no tiene un formato válido." };
  }

  try {
    new URL(p.urlConfirmation);
    new URL(p.urlReturn);
  } catch {
    return { ok: false, error: "Las URLs de confirmación o retorno no son válidas." };
  }

  return { ok: true, monto, concepto, email };
}
