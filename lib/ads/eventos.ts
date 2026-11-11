import { createHash } from "node:crypto";
import type { EventoConversion } from "@/lib/ads/conversionesConfig";

/**
 * EVENTOS DE CONVERSIÓN — el núcleo puro, sin base de datos ni red.
 *
 * QUÉ ES ESTO Y POR QUÉ IMPORTA MÁS QUE EL PANEL
 * Hoy, en un anuncio Click-to-WhatsApp, lo único que Meta llega a saber es que
 * alguien ABRIÓ una conversación. Con eso optimiza: le manda el aviso a la
 * gente que abre conversaciones, no a la que compra. Devolverle el evento real
 * —«esta persona pagó $45.000»— es lo que hace que reparta la plata hacia los
 * avisos que traen compradores. Es la única pieza de esta sección que mejora el
 * resultado en vez de solo explicarlo.
 *
 * LO QUE ESTE ARCHIVO RESUELVE, QUE ES DONDE ESTOS SISTEMAS FALLAN
 *  · **Identificador estable.** Meta NO deduplica estos eventos: la
 *    deduplicación es nuestra. El id se deriva del hecho —cliente, chat, tipo
 *    y, en compras, la venta— y la base rechaza el duplicado.
 *  · **Cero datos personales.** Solo el id de la WABA y el `ctwa_clid`.
 *  · **`ctwa_clid` obligatorio.** Sin el identificador del clic el evento no se
 *    puede atribuir a nada. Un evento así NO se manda: ensucia la cuenta del
 *    cliente y no aporta.
 *  · **Nada se manda dos veces.** El estado vive en la base; acá se decide.
 *
 * Puro y probable con Node pelado, que es donde se cazan los errores de dedupe.
 */

export type TipoEvento = EventoConversion;

/**
 * Los eventos que Respondo manda, y de dónde sale cada uno.
 *
 * ⚠️ Son nombres OFICIALES de la Conversions API para mensajería. La versión de
 * septiembre mandaba `Lead` y `Schedule`, que Meta NO acepta en este canal: se
 * cambiaron (nov-2026) antes de que ningún tenant los usara.
 */
export const EVENTOS: Record<
  TipoEvento,
  { etiqueta: string; explicacion: string; origen: string }
> = {
  LeadSubmitted: {
    etiqueta: "Pidió cotización",
    explicacion: "El cliente entregó los datos mínimos: producto y cantidad.",
    origen: "Cuando la IA lee producto y cantidad en la conversación.",
  },
  QualifiedLead: {
    etiqueta: "Cotización calificada",
    explicacion: "La cotización cumple la regla del negocio (por ejemplo, 500 unidades o más).",
    origen: "Por la regla configurada, o a mano con «Cotización calificada».",
  },
  Purchase: {
    etiqueta: "Venta",
    explicacion: "Una persona del negocio marcó la venta con su monto neto.",
    origen: "Con el botón «Marcar como venta» de la conversación.",
  },
};

export type EventoPendiente = {
  clienteId: string;
  chatId: string;
  tipo: TipoEvento;
  /** Momento del hecho, en segundos (lo que pide Meta). */
  ocurridoEn: number;
  /** Identificador del clic. Sin esto el evento no sirve. */
  ctwaClid: string;
  /** Solo Purchase: monto neto en CLP. */
  valor?: number | null;
  moneda?: string | null;
  /** Solo Purchase: el id de ESA venta. Una venta = un Purchase. */
  ventaId?: string | null;
};

/**
 * El identificador del evento, para NUESTRA deduplicación.
 *
 * ⭐ Meta NO deduplica los eventos de mensajería: si mandamos dos, cuenta dos.
 * La regla (nov-2026) es la del negocio, no la del reloj:
 *   · LeadSubmitted y QualifiedLead → UNO por conversación, para siempre.
 *   · Purchase → uno por VENTA (su propio id). Dos pedidos del mismo cliente
 *     son dos compras; la misma venta reintentada es una.
 * La llave única `(cliente_id, evento_id)` de la tabla hace cumplir esto
 * aunque el código se equivoque.
 */
export function idDeEvento(e: {
  clienteId: string;
  chatId: string;
  tipo: TipoEvento;
  ventaId?: string | null;
}): string {
  const llave =
    e.tipo === "Purchase"
      ? `${e.clienteId}|${e.chatId}|Purchase|${e.ventaId ?? ""}`
      : `${e.clienteId}|${e.chatId}|${e.tipo}`;
  return createHash("sha256").update(llave).digest("hex").slice(0, 32);
}

export type Verificacion =
  | { ok: true }
  | {
      ok: false;
      motivo: string;
      codigo: "sin_clid" | "sin_fecha" | "valor_invalido" | "sin_venta";
    };

/**
 * ¿Este evento se puede mandar?
 *
 * Se prefiere NO mandar antes que mandar algo dudoso: un evento mal atribuido
 * le enseña a Meta a buscar a la gente equivocada, y eso le cuesta plata al
 * cliente durante semanas sin que nadie sepa por qué.
 */
export function verificar(e: EventoPendiente): Verificacion {
  if (!e.ctwaClid || e.ctwaClid.length < 5) {
    return {
      ok: false,
      codigo: "sin_clid",
      motivo:
        "Esta conversación no vino de un anuncio (no trae el identificador del clic), así que Meta no podría atribuirla.",
    };
  }
  if (!Number.isFinite(e.ocurridoEn) || e.ocurridoEn <= 0) {
    return { ok: false, codigo: "sin_fecha", motivo: "El evento no tiene una fecha válida." };
  }
  if (e.tipo === "Purchase") {
    if (!e.ventaId) {
      return { ok: false, codigo: "sin_venta", motivo: "Una compra necesita el id de la venta." };
    }
    if (!Number.isFinite(e.valor) || (e.valor as number) <= 0) {
      return { ok: false, codigo: "valor_invalido", motivo: "El monto de la venta no es válido." };
    }
  }
  return { ok: true };
}

/**
 * Arma el cuerpo que espera la Conversions API para mensajería de negocios.
 *
 * ⭐⭐ NADA DE DATOS PERSONALES: `user_data` lleva solo el id de la WABA y el
 * `ctwa_clid`. La versión de septiembre agregaba el teléfono hasheado; se
 * sacó (nov-2026) porque el clic ya identifica a la persona para Meta y el
 * teléfono no suma atribución, solo exposición.
 *
 * ⚠️ Los tres campos que la vuelven específica de WhatsApp y que si faltan
 * hacen que Meta acepte el evento y no lo use para nada:
 *   `action_source: "business_messaging"` · `messaging_channel: "whatsapp"` ·
 *   `ctwa_clid` dentro de `user_data`.
 */
export function armarPayload(
  e: EventoPendiente,
  wabaId: string,
  opciones: { testEventCode?: string | null; partnerAgent?: string | null } = {},
): Record<string, unknown> {
  const valor = e.tipo === "Purchase" && Number.isFinite(e.valor) && (e.valor as number) > 0 ? Math.round(e.valor as number) : 0;
  const cuerpo: Record<string, unknown> = {
    data: [
      {
        event_name: e.tipo,
        event_time: Math.floor(e.ocurridoEn),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: wabaId,
          ctwa_clid: e.ctwaClid,
        },
        custom_data: { currency: String(e.moneda ?? "CLP").toUpperCase(), value: valor },
      },
    ],
  };
  if (opciones.partnerAgent) cuerpo.partner_agent = opciones.partnerAgent;
  if (opciones.testEventCode) cuerpo.test_event_code = opciones.testEventCode;
  return cuerpo;
}

/**
 * Lo que se guarda de la respuesta de Meta: el cuerpo, recortado, y sin nada
 * que se parezca a un token. Sirve para explicar un rechazo sin exponer nada.
 */
export function respuestaParaGuardar(cuerpo: unknown): Record<string, unknown> {
  const limpio = JSON.parse(
    JSON.stringify(cuerpo ?? {}, (k, v) => (/token|secret|authorization/i.test(k) ? undefined : v)),
  ) as Record<string, unknown>;
  const s = JSON.stringify(limpio);
  return s.length <= 2000 ? limpio : { recortado: s.slice(0, 2000) };
}

/** Estados de la cola. `descartado` es un final legítimo, no una falla. */
export type EstadoEvento = "pendiente" | "enviado" | "fallido" | "descartado";

/**
 * ¿Se reintenta un evento que falló?
 *
 * Con techo y espaciado creciente: reintentar en bucle contra un límite de API
 * lo empeora, y un evento de hace tres días ya no le sirve a nadie.
 */
export function toca_reintentar(e: {
  estado: EstadoEvento;
  intentos: number;
  ultimoIntento: number | null;
  ahora?: number;
}): boolean {
  if (e.estado !== "fallido") return false;
  if (e.intentos >= 5) return false;
  const ahora = e.ahora ?? Date.now();
  if (!e.ultimoIntento) return true;
  // 5 min, 25 min, 2 h, 10 h — suficiente para que un problema pasajero pase.
  const esperaMs = 5 * 60_000 * Math.pow(5, Math.max(0, e.intentos - 1));
  return ahora - e.ultimoIntento >= esperaMs;
}
