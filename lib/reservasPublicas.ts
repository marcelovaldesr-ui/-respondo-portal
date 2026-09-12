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

/**
 * Rango de días chilenos de un mes "2026-09", acotado a hoy si el mes ya
 * empezó. Devuelve null si el texto no es un mes válido o queda en el pasado.
 */
export function rangoDelMes(mes: string | null, ahora = new Date()): { desde: Date; dias: number } | null {
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return null;
  const [anio, m] = mes.split("-").map(Number);
  if (m < 1 || m > 12 || anio < 2020 || anio > 2100) return null;
  const primero = new Date(Date.UTC(anio, m - 1, 1, 15, 0)); // mediodía chileno aprox.
  const diasDelMes = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  const hoy = new Date(ahora);
  const esMesDeHoy = hoy.getUTCFullYear() === anio && hoy.getUTCMonth() === m - 1;
  if (primero.getTime() + diasDelMes * 86_400_000 < ahora.getTime()) return null; // mes pasado
  const desde = esMesDeHoy ? ahora : primero;
  const diaInicial = esMesDeHoy ? hoy.getUTCDate() : 1;
  return { desde, dias: diasDelMes - diaInicial + 1 };
}

/** Un solo día chileno "2026-09-18". */
export function rangoDelDia(fecha: string | null): { desde: Date; dias: number } | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { desde: new Date(Date.UTC(anio, mes - 1, dia, 15, 0)), dias: 1 };
}

export function ipDeRequest(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "desconocida"
  );
}
