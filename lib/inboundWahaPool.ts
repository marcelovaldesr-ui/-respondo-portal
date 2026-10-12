import { db } from "@/lib/db";
import { normalizeWaId, enviarTextoPool } from "@/lib/wahaPool";
import { registrarBaja, CONFIRMACION_BAJA } from "@/lib/bajas";
import { emitirEvento } from "@/lib/webhookSalida";
import { asegurarContacto } from "@/lib/contactoEntrante";
import { guardarMensaje } from "@/lib/mensajes";
import { tinoDe } from "@/lib/whatsapp";
import {
  resolverTelefonoEntrante,
  analizarIntencionBaja,
  alertarHqLidNoResuelto,
} from "@/lib/wahaPoolIdentidad";
import { createHash } from "node:crypto";
import { notificarHQ } from "@/lib/hqBridge";

function huellaTelefono(clienteId: string, telefono: string): string {
  return createHash("sha256").update(`${clienteId}:${telefono}`).digest("hex");
}

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
  autorespuesta?: boolean;
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

    const idRes = await resolverTelefonoEntrante(p, sesion, supa);
    const texto = (p.body ?? p._data?.caption ?? "").trim();
    const waId = normalizeWaId(p.id);
    const wamid = waId ?? `waha:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const nombre = p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? null;
    const bajaCheck = analizarIntencionBaja(texto);

    // 1) Caso de seguridad estricta: teléfono NO resuelto
    if (!idRes.ok) {
      try {
        const tino = await tinoDe(clienteId);
        if (tino) {
          await guardarMensaje(supa, {
            empleadoId: tino,
            chatId: idRes.chatIdOriginal || idRes.lid,
            rol: "cliente",
            texto: `[sin_telefono: LID ${idRes.lid}] ${texto}`,
            waId: waId ?? null,
          });
        }
      } catch (e) {
        console.warn("[inboundWahaPool] error al guardar mensaje de LID no resuelto:", (e as Error).message);
      }

      alertarHqLidNoResuelto(sesion, idRes.lid, bajaCheck.esBaja || bajaCheck.posibleBaja, clienteId);
      return {
        accion: "lid_no_resuelto",
        detalle: `${idRes.lid}:${bajaCheck.esBaja ? "baja_pendiente_revision" : "mensaje_guardado"}`,
      };
    }

    // 2) Teléfono verificado
    const chatId = idRes.telefono;
    const telefono = `+${idRes.telefono}`;

    // A) BAJA unívoca y confirmada
    if (bajaCheck.esBaja) {
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
        console.warn("[inboundWahaPool] error al guardar mensaje de baja:", (e as Error).message);
      }

      await emitirEvento(clienteId, "message.inbound", `inbound:${wamid}`, {
        from: telefono,
        type: "chat",
        text: texto.slice(0, 1000),
        message_id: waId,
      });

      const nueva = await registrarBaja(supa, { clienteId, chatId, nombre });
      if (nueva) {
        await emitirEvento(clienteId, "contact.optout", `optout:${wamid}`, {
          phone: telefono,
          source: "whatsapp_keyword",
        });
        // Confirmar baja enviando al chatId original (conserva @lid si vino por ahí)
        const destinoConfirmacion = idRes.chatIdOriginal?.endsWith("@lid")
          ? idRes.chatIdOriginal
          : chatId;
        await enviarTextoPool(sesion, destinoConfirmacion, CONFIRMACION_BAJA).catch(() => undefined);
      }
      return { accion: "baja", detalle: chatId };
    }

    // B) Posible BAJA (frase ambigua o compleja con palabra clave)
    if (bajaCheck.posibleBaja) {
      try {
        const tino = await tinoDe(clienteId);
        if (tino) {
          await asegurarContacto(supa, { clienteId, chatId, nombre, telefono });
          await guardarMensaje(supa, {
            empleadoId: tino,
            chatId,
            rol: "cliente",
            texto: `[posible_baja] ${texto}`,
            waId: waId ?? null,
          });
        }
      } catch (e) {
        console.warn("[inboundWahaPool] error al guardar posible_baja:", (e as Error).message);
      }

      try {
        notificarHQ({
          tipo: "info",
          clientePortalId: clienteId,
          detalle: `Aviso Pool WAHA: Posible baja ambigua recibida de ${telefono}: "${texto.slice(0, 80)}"`,
        });
      } catch {}

      await emitirEvento(clienteId, "message.inbound", `inbound:${wamid}`, {
        from: telefono,
        type: "chat",
        text: texto.slice(0, 1000),
        message_id: waId,
      });

      return { accion: "posible_baja", detalle: chatId };
    }

    // C) Mensaje normal entrante para la bandeja humana
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

    await emitirEvento(clienteId, "message.inbound", `inbound:${wamid}`, {
      from: telefono,
      type: "chat",
      text: texto.slice(0, 1000),
      message_id: waId,
    });

    let autorespuestaEnviada = false;
    // Auto-respuesta opcional (detrás de WAHA_POOL_AUTORESPUESTA=1, default 0)
    // Se envía como máximo una vez por contacto cada 24 horas.
    if (process.env.WAHA_POOL_AUTORESPUESTA === "1") {
      try {
        const limite24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: yaRespondido } = await supa
          .from("ed_mensajes")
          .select("id")
          .eq("chat_id", chatId)
          .eq("rol", "empleado")
          .gte("creado_en", limite24h)
          .limit(1)
          .maybeSingle();

        if (!yaRespondido) {
          const hash = huellaTelefono(clienteId, idRes.telefono);
          const { data: ultEnvio } = await supa
            .from("ed_envios_api")
            .select("origen_ref")
            .eq("cliente_id", clienteId)
            .eq("telefono_hash", hash)
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();

          const localNombre = ultEnvio?.origen_ref;
          const textoAuto = localNombre
            ? `Este número solo envía avisos de ${localNombre}. Para consultas, escríbele directamente al local.`
            : `Este número solo envía avisos automáticos. Para consultas, escríbele directamente al local.`;

          const destinoRespuesta = idRes.chatIdOriginal?.endsWith("@lid")
            ? idRes.chatIdOriginal
            : chatId;

          await enviarTextoPool(sesion, destinoRespuesta, textoAuto).catch(() => undefined);
          autorespuestaEnviada = true;

          const tino = await tinoDe(clienteId);
          if (tino) {
            await guardarMensaje(supa, {
              empleadoId: tino,
              chatId,
              rol: "empleado",
              texto: textoAuto,
            });
          }
        }
      } catch (err) {
        console.warn("[inboundWahaPool] error en autorespuesta:", (err as Error).message);
      }
    }

    return {
      accion: "cliente:solo_mensajeria",
      detalle: chatId,
      ...(autorespuestaEnviada ? { autorespuesta: true } : {}),
    };
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
