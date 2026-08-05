import { randomUUID } from "crypto";

export function idSolicitud(headers?: Headers): string {
  const recibido = headers?.get("x-request-id")?.trim();
  return recibido && /^[A-Za-z0-9._:-]{8,100}$/.test(recibido)
    ? recibido
    : randomUUID();
}

type Nivel = "info" | "warn" | "error";

/** Log JSON pequeño, correlacionable y sin cuerpos/tokens/datos personales. */
export function logOperacion(
  nivel: Nivel,
  evento: string,
  contexto: { requestId: string; proveedor?: string; tenantId?: string },
  detalle: Record<string, string | number | boolean | null> = {},
): void {
  const entrada = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...contexto,
    ...detalle,
  });
  if (nivel === "error") console.error(entrada);
  else if (nivel === "warn") console.warn(entrada);
  else console.info(entrada);
}
