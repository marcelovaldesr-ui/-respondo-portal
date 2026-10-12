import { db } from "@/lib/db";
import { normalizeWaId, enviarTextoPool } from "@/lib/wahaPool";
import { esMensajeDeBaja, registrarBaja, CONFIRMACION_BAJA } from "@/lib/bajas";
import { emitirEvento } from "@/lib/webhookSalida";
import { asegurarContacto } from "@/lib/contactoEntrante";
import { guardarMensaje } from "@/lib/mensajes";
import { tinoDe } from "@/lib/whatsapp";

/**
 * PROCESAMIENTO DE WEBHOOKS ENTRANTES DEL POOL WAHA.
 *
 * Maneja:
 *  1. message.ack: ACKs de entrega/lectura/fallo -> ed_envios_api + message.status
 *  2. message / message.any: Mensajes entrantes -> bandeja humana + message.inbound.
 *     Si es orden de BAJA -> marca no_contactar, avisa a Kambak y responde confirmación.
 *     Cuenta de solo mensajería: NUNCA llama a modelos de IA.
 *  3. session.status: Estado de la sesión (se delega / procesa para salud y rotación).
 */

export type ResultadoInboundWahaPool = {
  accion: string;
  detalle?: string;
  duplicado?: boolean;
};

export async function manejarEntranteWahaPool(
  payload: unknown,
  supa = db(),
): Promise<ResultadoInboundWahaPool> {
  const body = payload as {
    event?: string;
    session?: string;
    payload?: {
      id?: unknown;
      from?: string;
      fromMe?: boolean;
      body?: string;
      timestamp?: number;
      notifyName?: string;
      ack?: number;
      ackName?: string;
      status?: string;
      _data?: {
        notifyName?: string;
        pushName?: string;
        caption?: string;
      };
    };
  };

  const evento = body?.event;
  const sesion = body?.session;

  // 1) ACKs de entrega (message.ack)
  if (evento === "message.ack") {
    const p = body?.payload ?? {};
    const waId = normalizeWaId(p.id);
    if (!waId) return { accion: "ack_sin_id" };

    const porNombre: Record<string, "sent" | "delivered" | "read" | "failed"> = {
      SERVER: "sent",
      DEVICE: "delivered",
      READ: "read",
      PLAYED: "read",
      ERROR: "failed",
    };
    const porNumero: Record<number, "sent" | "delivered" | "read" | "failed"> = {
      [-1]: "failed",
      0: "failed",
      2: "sent",
      3: "delivered",
      4: "read",
      5: "read",
    };

    const ackName = (p.ackName || "").toUpperCase();
    const estado =
      porNombre[ackName] ??
      (typeof p.ack === "number" ? porNumero[p.ack] : undefined);

    if (!estado) return { accion: "ack_ignorado", detalle: ackName || String(p.ack) };

    // Buscar el envío en ed_envios_api por wamid
    const { data: envio } = await supa
      .from("ed_envios_api")
      .select("id, cliente_id, estado")
      .eq("wamid", waId)
      .maybeSingle();

    if (envio) {
      if (estado === "failed") {
        await supa
          .from("ed_envios_api")
          .update({ estado: "fallido", motivo: "ack_error" })
          .eq("id", envio.id);
      }
      await emitirEvento(
        envio.cliente_id as string,
        "message.status",
        `status:${waId}:${estado}`,
        {
          id: envio.id,
          message_id: waId,
          status: estado,
          ...(estado === "failed" ? { reason: "error_entrega_waha" } : {}),
        },
      );
      return { accion: "ack_procesado", detalle: `${waId}:${estado}` };
    }

    return { accion: "ack_sin_envio", detalle: waId };
  }

  // 2) Mensajes entrantes (message o message.any)
  if (evento === "message" || evento === "message.any") {
    const p = body?.payload ?? {};
    const from = p.from ?? "";
    if (
      !from ||
      from.endsWith("@g.us") ||
      from.endsWith("@broadcast") ||
      from.includes("status@")
    ) {
      return { accion: "mensaje_ignorado" };
    }

    // Ignorar ecos salientes (mensajes enviados por nosotros)
    if (p.fromMe === true) {
      return { accion: "eco_saliente" };
    }

    // Resolver el cliente dueño de esta sesión en ed_waha_numeros
    if (!sesion) return { accion: "mensaje_sin_sesion" };
    const { data: numFila } = await supa
      .from("ed_waha_numeros")
      .select("id, cliente_id")
      .eq("sesion", sesion)
      .maybeSingle();

    if (!numFila?.cliente_id) {
      return { accion: "sesion_no_encontrada", detalle: sesion };
    }
    const clienteId = numFila.cliente_id as string;

    const digits = from.replace(/\D/g, "");
    const chatId = digits;
    const telefono = `+${digits}`;
    const nombre = p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? null;
    const texto = (p.body ?? p._data?.caption ?? "").trim();
    const waId = normalizeWaId(p.id);

    // Registrar contacto y guardar mensaje en ed_mensajes para la bandeja humana
    try {
      const tino = await tinoDe(clienteId);
      if (tino) {
        await asegurarContacto(supa, { clienteId, chatId, nombre, telefono });
        await guardarMensaje(supa, {
          empleadoId: tino,
          chatId,
          rol: "cliente",
          texto,
          waId: waId ?? null,
        });
      }
    } catch (e) {
      console.error("[inboundWahaPool] error al guardar en bandeja:", (e as Error).message);
    }

    // Emitir evento message.inbound a Kambak
    const wamid = waId ?? `${chatId}:${Date.now()}`;
    await emitirEvento(clienteId, "message.inbound", `inbound:${wamid}`, {
      from: `+${chatId}`,
      type: "chat",
      text: texto.slice(0, 1000),
      message_id: waId,
    });

    // Detectar si es orden de BAJA
    if (esMensajeDeBaja(texto)) {
      const nueva = await registrarBaja(supa, { clienteId, chatId, nombre });
      if (nueva) {
        await emitirEvento(clienteId, "contact.optout", `optout:${wamid}`, {
          phone: `+${chatId}`,
          source: "whatsapp_keyword",
        });
        // Confirmar baja enviando el texto estándar por el mismo número
        await enviarTextoPool(sesion, chatId, CONFIRMACION_BAJA).catch(() => undefined);
      }
      return { accion: "baja", detalle: chatId };
    }

    // Cuenta de solo mensajería: NUNCA llama a ningún modelo
    return { accion: "cliente:solo_mensajeria", detalle: chatId };
  }

  // 3) Estado de la sesión (session.status)
  if (evento === "session.status") {
    const p = body?.payload ?? {};
    const status = (p.status ?? "").toUpperCase();
    if (sesion && status) {
      const { actualizarEstadoSesion } = await import("@/lib/poolSalud");
      const r = await actualizarEstadoSesion(sesion, status, supa);
      return { accion: "session_status", detalle: `${sesion}:${status}:${r.accion}` };
    }
    return { accion: "session_status", detalle: sesion };
  }

  return { accion: "evento_no_soportado", detalle: evento };
}
