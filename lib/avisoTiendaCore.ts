import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AVISO «PEDIDO LISTO» DESDE LA TIENDA (impresoracolor.cl) — parte pura.
 *
 * La tienda nueva de Impresora Color NO habla con Meta: firma una orden y este
 * portal manda la plantilla aprobada `pedido_listo`. Sin imports `@/` y sin red,
 * para poder probarla con `node --test` (patrón de agendaCore.ts).
 *
 * El formato de firma lo fija la tienda (lib/avisoWhatsapp.ts de
 * impresora-color-web), no el esquema de /api/externo/* de Gestión:
 *   X-IC-Timestamp: segundos Unix
 *   X-IC-Signature: HMAC-SHA256 hex de `${timestamp}.${cuerpoCrudo}`
 */

export const TOLERANCIA_RELOJ_SEG = 300;

export function firmaTiendaValida(p: {
  cuerpoCrudo: string;
  timestamp: string | null;
  firma: string | null;
  secreto: string | undefined;
  ahoraSeg?: number;
}): boolean {
  if (!p.secreto || !p.timestamp || !p.firma) return false;
  if (!/^\d{9,12}$/.test(p.timestamp)) return false;
  const ahora = p.ahoraSeg ?? Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - Number(p.timestamp)) > TOLERANCIA_RELOJ_SEG) return false;
  const esperada = createHmac("sha256", p.secreto)
    .update(`${p.timestamp}.${p.cuerpoCrudo}`, "utf8")
    .digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(p.firma.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AvisoTienda = {
  idempotencyKey: string;
  telefono: string;
  nombre: string;
  numeroOrden: string;
  producto: string;
};

export type ResultadoAviso = { ok: true; aviso: AvisoTienda } | { ok: false; error: string };

const texto = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function validarAvisoTienda(body: unknown): ResultadoAviso {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.evento !== "pedido_listo") return { ok: false, error: "evento debe ser pedido_listo" };

  const idempotencyKey = texto(b.idempotency_key, 200);
  if (!idempotencyKey) return { ok: false, error: "falta idempotency_key" };

  const telefono = typeof b.telefono === "string" ? b.telefono : "";
  if (!/^56\d{9}$/.test(telefono)) return { ok: false, error: "telefono debe ser 56 + 9 dígitos" };

  const nombre = texto(b.nombre, 80);
  const numeroOrden = texto(b.numero_orden, 40);
  const producto = texto(b.producto, 200);
  if (!nombre) return { ok: false, error: "falta nombre" };
  if (!numeroOrden) return { ok: false, error: "falta numero_orden" };
  if (!producto) return { ok: false, error: "falta producto" };

  return { ok: true, aviso: { idempotencyKey, telefono, nombre, numeroOrden, producto } };
}

/**
 * Variables de la plantilla `pedido_listo`:
 *   {{1}} nombre · {{2}} negocio · {{3}} «pedido N° <orden>»
 *
 * Se manda el número de orden y no la lista de productos: el cuerpo dice
 * «tu {{3}} ya está listo», y «tu Flyers × 500, Stickers × 100 ya está listo»
 * no se lee. Un carrito es un solo retiro y el cliente reconoce el número que
 * vio al comprar. Solo el primer nombre: «Hola María» y no «Hola María González».
 */
export function paramsPedidoListo(a: AvisoTienda, negocio: string): string[] {
  const primerNombre = a.nombre.split(" ")[0] || "hola";
  return [primerNombre, negocio, `pedido N° ${a.numeroOrden}`];
}
