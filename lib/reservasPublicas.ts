/** Utilidades puras compartidas por los endpoints públicos de reservas. */

export const MAX_JSON_PUBLICO_BYTES = 16 * 1024;

export function parsearJsonAcotado(
  texto: string,
  maxBytes = MAX_JSON_PUBLICO_BYTES,
): Record<string, unknown> | null {
  if (Buffer.byteLength(texto, "utf8") > maxBytes) return null;
  try {
    const valor = JSON.parse(texto) as unknown;
    return valor !== null && typeof valor === "object" && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizarTelefono(crudo: string): string | null {
  const digitos = crudo.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  if (digitos.startsWith("56")) return digitos;
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;
  return digitos;
}

export function normalizarNombre(crudo: string): string {
  return crudo.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor,
  );
}

export function coincideConSlotOfrecido(
  slots: { inicio: string; profesionalId: string }[],
  profesionalId: string,
  inicio: string,
): boolean {
  const instante = Date.parse(inicio);
  if (!Number.isFinite(instante)) return false;
  return slots.some(
    (slot) => slot.profesionalId === profesionalId && Date.parse(slot.inicio) === instante,
  );
}

export function ipDeRequest(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "desconocida"
  );
}
