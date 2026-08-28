/**
 * VALIDACIÓN DEL WEBHOOK DE PEDIDOS — pura, sin red ni base de datos.
 *
 * El endpoint `/api/integraciones/pedidos` recibe avisos de sistemas EXTERNOS
 * (el ERP del cliente, su app de gestión). Todo lo que llega de afuera es
 * hostil hasta que se demuestre lo contrario, y estas reglas son la primera
 * puerta. Están separadas para poder probarlas con `node --test` — un webhook
 * que solo se puede probar contra producción no está probado.
 */

export const TIPOS_PEDIDO = ["pedido_listo", "encargo_llego"] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];

export type CuerpoPedido =
  | { ok: true; chatId: string; tipo: TipoPedido; detalle: string }
  | { ok: false; error: string };

/**
 * Normaliza y valida el cuerpo del aviso.
 *
 *  - `chat_id` se reduce a dígitos: los sistemas mandan «+56 9 1234 5678»,
 *    «56912345678» o con guiones, y todos deben calzar con el mismo contacto.
 *  - 8 a 15 dígitos: menos no es un teléfono, más tampoco (E.164 tope 15).
 *  - `detalle` se recorta a 80: va dentro de una plantilla de Meta y un valor
 *    kilométrico la rompería (error 132012 si además trae saltos de línea, que
 *    también se limpian acá).
 */
export function validarCuerpoPedido(body: unknown): CuerpoPedido {
  const b = (body ?? {}) as { chat_id?: unknown; tipo?: unknown; detalle?: unknown };

  const chatId = String(b.chat_id ?? "").replace(/\D/g, "");
  if (chatId.length < 8 || chatId.length > 15) {
    return { ok: false, error: "chat_id inválido: se espera un teléfono de 8 a 15 dígitos" };
  }

  const tipo = String(b.tipo ?? "") as TipoPedido;
  if (!TIPOS_PEDIDO.includes(tipo)) {
    return { ok: false, error: `tipo debe ser uno de: ${TIPOS_PEDIDO.join(", ")}` };
  }

  const detalle =
    String(b.detalle ?? "")
      .replace(/\s+/g, " ") // saltos de línea y tabs rompen el parámetro en Meta
      .trim()
      .slice(0, 80) || "tu pedido";

  return { ok: true, chatId, tipo, detalle };
}
