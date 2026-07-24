import { db } from "@/lib/db";
import {
  parsearWebhook,
  parsearAcksMeta,
  parsearEcosMeta,
  configPorPhoneId,
  tinoDe,
  enviarTexto,
  type ConfigWhatsApp,
} from "@/lib/whatsapp";
import {
  guardarMensaje,
  yaProcesado,
  esEcoReciente,
  actualizarEstadoEnvio,
} from "@/lib/mensajes";
import { setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { responderSiBot } from "@/lib/responderBot";

export type ResultadoMeta = { accion: string; detalle?: string };

/**
 * Orquesta un payload del webhook de la WhatsApp Cloud API OFICIAL (Opción B).
 * Gemelo de lib/inboundWaha.ts: MISMO cerebro, MISMA convivencia Tino+persona,
 * MISMO tracking de entregas. Solo cambian los parsers del transporte.
 *
 * Un payload de Meta puede traer VARIOS eventos mezclados (messages, statuses,
 * message_echoes). Se procesan todos y se devuelve el resumen.
 *
 *  0) statuses (ACKs) → actualizar estado_envio.
 *  1) message_echoes (Coexistencia): eco de envío propio → ignorar;
 *     id desconocido → PERSONA escribió desde la app → toma de control humana.
 *  2) messages (cliente) → idempotencia (Meta REINTENTA webhooks) → guardar,
 *     tocar ventana, debounce y responder.
 */
export async function manejarEntranteMeta(
  payload: unknown,
  opts?: {
    /** Inyección del transporte (para pruebas: evita enviar WhatsApp real). */
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoMeta[]> {
  const resultados: ResultadoMeta[] = [];
  const supa = db();

  // Cache de resolución por phone_number_id dentro del mismo payload.
  const cacheCfg = new Map<string, { cfg: ConfigWhatsApp; empleadoId: string } | null>();
  async function resolver(phoneNumberId: string) {
    if (cacheCfg.has(phoneNumberId)) return cacheCfg.get(phoneNumberId)!;
    const cfg = await configPorPhoneId(phoneNumberId);
    if (!cfg) {
      cacheCfg.set(phoneNumberId, null);
      return null;
    }
    const empleadoId = await tinoDe(cfg.clienteId);
    if (!empleadoId) {
      cacheCfg.set(phoneNumberId, null);
      return null;
    }
    const r = { cfg, empleadoId };
    cacheCfg.set(phoneNumberId, r);
    return r;
  }

  // 0) ACKs (statuses).
  for (const ack of parsearAcksMeta(payload)) {
    const ctx = await resolver(ack.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "ack_sin_cliente", detalle: ack.phoneNumberId });
      continue;
    }
    const r = await actualizarEstadoEnvio(supa, ctx.empleadoId, ack.waId, ack.estado);
    if (ack.estado === "error") {
      console.error(
        "[meta ack] envío NO entregado:",
        ack.waId,
        ack.errorDetalle ?? "",
      );
    }
    resultados.push({
      accion: "ack",
      detalle: `${ack.estado}${r.encontrado === false ? " (ajeno)" : ""}`,
    });
  }

  // 1) Ecos de Coexistencia (mensajes salientes del número del negocio).
  for (const eco of parsearEcosMeta(payload)) {
    const ctx = await resolver(eco.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "eco_sin_cliente", detalle: eco.phoneNumberId });
      continue;
    }
    const { empleadoId } = ctx;
    const chatId = eco.para;

    // Eco de un envío propio (API o inbox del portal): id ya guardado o texto
    // recién enviado por Tino → ignorar.
    if (
      (eco.waId && (await yaProcesado(supa, empleadoId, eco.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, eco.texto))
    ) {
      resultados.push({ accion: "eco" });
      continue;
    }
    // ANTI-CARRERA (mismo riesgo B de la auditoría WAHA): el eco puede llegar
    // antes de que el envío haya guardado su id. Esperar y re-verificar antes de
    // concluir "toma humana" (que silenciaría a Tino por error).
    await new Promise((r) => setTimeout(r, 2500));
    if (
      (eco.waId && (await yaProcesado(supa, empleadoId, eco.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, eco.texto))
    ) {
      resultados.push({ accion: "eco" });
      continue;
    }

    // PERSONA real escribiendo desde la app del negocio → toma de control.
    await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "humano",
      texto: eco.texto,
      waId: eco.waId,
      canal: "whatsapp",
    });
    await setModo(empleadoId, chatId, "humano", supa);
    resultados.push({ accion: "toma_humana" });
  }

  // 2) Mensajes del cliente.
  for (const m of parsearWebhook(payload)) {
    const ctx = await resolver(m.phoneNumberId);
    if (!ctx) {
      resultados.push({ accion: "sin_cliente", detalle: m.phoneNumberId });
      continue;
    }
    const { cfg, empleadoId } = ctx;
    const chatId = m.de;

    // IDEMPOTENCIA: Meta reintenta el webhook si el 200 tarda → sin esto, Tino
    // respondería DOS veces al mismo mensaje.
    if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
      resultados.push({ accion: "duplicado" });
      continue;
    }

    await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "cliente",
      texto: m.texto,
      waId: m.waId,
      canal: "whatsapp",
    });

    if (m.nombre) {
      await supa.from("ed_contactos").upsert(
        {
          cliente_id: cfg.clienteId,
          chat_id: chatId,
          nombre: m.nombre,
          telefono: `+${chatId}`,
          etiqueta: "lead",
        },
        { onConflict: "cliente_id,chat_id" },
      );
    }

    await tocarVentanaEntrante(empleadoId, chatId, supa);

    // DEBOUNCE (mismo fix que WAHA): si el cliente manda varios mensajes
    // seguidos, responde solo la invocación del ÚLTIMO (su historial ya los
    // incluye todos). Evita respuestas solapadas y desordenadas.
    const DEBOUNCE_MS = 6000;
    if (m.waId) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      const { data: ultimo } = await supa
        .from("ed_mensajes")
        .select("wa_message_id")
        .eq("empleado_id", empleadoId)
        .eq("chat_id", chatId)
        .eq("rol", "cliente")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultimo?.wa_message_id && ultimo.wa_message_id !== m.waId) {
        resultados.push({ accion: "debounce_superseded" });
        continue;
      }
    }

    const enviar =
      opts?.enviar ??
      (async (para: string, texto: string) => enviarTexto(cfg, para, texto));

    const r = await responderSiBot({
      clienteId: cfg.clienteId,
      empleadoId,
      chatId,
      enviar,
    });
    resultados.push({ accion: `cliente:${r.accion}`, detalle: r.detalle });
  }

  if (resultados.length === 0) resultados.push({ accion: "ignorado" });
  return resultados;
}
