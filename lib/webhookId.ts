import { createHash } from "crypto";

export type ProveedorWebhook = "meta_whatsapp" | "waha" | "instagram";

/** El hash del cuerpo crudo es estable entre reintentos y no almacena PII. */
export function idEventoWebhook(proveedor: ProveedorWebhook, cuerpoCrudo: string): string {
  return createHash("sha256").update(`${proveedor}:`).update(cuerpoCrudo).digest("hex");
}
