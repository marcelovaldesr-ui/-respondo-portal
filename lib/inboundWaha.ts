import { db } from "@/lib/db";
import {
  parsearWaha,
  parsearAckWaha,
  clientePorInstanciaWaha,
  enviarTextoWaha,
  resolverContacto,
  nombreDeContacto,
} from "@/lib/waha";
import { tinoDe } from "@/lib/whatsapp";
import {
  guardarMensaje,
  yaProcesado,
  esEcoReciente,
  actualizarEstadoEnvio,
  enviosUltimoMinuto,
} from "@/lib/mensajes";
import { setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { responderSiBot } from "@/lib/responderBot";

export type ResultadoEntrante = { accion: string; detalle?: string };

/**
 * Orquesta un evento entrante de WAHA (WhatsApp Opción A — motor GOWS).
 * Gemelo de lib/inboundEvolution.ts: MISMO cerebro, MISMA convivencia
 * Tino+persona, MISMO tracking de ACKs. Solo cambia el parser del transporte.
 *
 * IDENTIDAD ESTABLE (23-jul-2026): la clave de la conversación (chatId) es
 * SIEMPRE el número real del contacto, resuelto desde el LID si hace falta
 * (resolverContacto). Así la misma persona NO se fragmenta en varios chats,
 * aunque a veces entre como @lid y a veces como @c.us. El ENVÍO se hace a la
 * dirección original (m.jid), que es la que WhatsApp espera y ya entrega bien.
 *
 *  0) ACK (message.ack) → actualizar estado_envio y salir.
 *  1) Parsear message. Si no hay texto / es grupo → ignorar.
 *  2) Resolver cliente (por instancia) y Tino.
 *  2b) Resolver identidad estable del contacto (número real).
 *  3) Idempotencia por id (cubre reenvíos y eco de Tino).
 *  4) fromMe con id desconocido = persona → toma de control humana.
 *  5) Mensaje del cliente → guardar, tocar ventana, responder.
 */
export async function manejarEntranteWaha(
  payload: unknown,
  opts?: {
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoEntrante> {
  // 0) ACK de entrega.
  const ack = parsearAckWaha(payload);
  if (ack) {
    const clienteId = await clientePorInstanciaWaha(ack.instancia);
    if (!clienteId) return { accion: "ack_sin_cliente", detalle: ack.instancia };
    const empleadoId = await tinoDe(clienteId);
    if (!empleadoId) return { accion: "ack_sin_tino" };
    const r = await actualizarEstadoEnvio(db(), empleadoId, ack.waId, ack.estado);
    if (ack.estado === "error") console.error("[waha ack] envío NO entregado:", ack.waId);
    return {
      accion: "ack",
      detalle: `${ack.estado}${r.encontrado === false ? " (ajeno)" : ""}`,
    };
  }

  const m = parsearWaha(payload);
  if (!m) return { accion: "ignorado" };

  const clienteId = await clientePorInstanciaWaha(m.instancia);
  if (!clienteId) return { accion: "sin_cliente", detalle: m.instancia };
  const empleadoId = await tinoDe(clienteId);
  if (!empleadoId) return { accion: "sin_tino" };

  const supa = db();

  // 2b) Identidad estable: la clave del chat es el NÚMERO REAL (resuelto del LID).
  const contacto = await resolverContacto(m.jid);
  const chatId = contacto.chatId; // ← clave única de la conversación en la BD

  // 3) Idempotencia + eco de Tino.
  if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
    return { accion: "duplicado" };
  }

  // 4) fromMe con id desconocido = mensaje humano → toma de control.
  if (m.fromMe) {
    // Detección de ECO (mensaje del propio Tino que WhatsApp devuelve):
    //  a) por id ya guardado, o b) por texto reciente igual (rol=empleado).
    if (
      (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, m.texto))
    ) {
      return { accion: "eco" };
    }
    // ANTI-CARRERA (riesgo B de la auditoría): el eco de Tino llega como un
    // webhook APARTE y puede adelantarse a que se guarde el id/mensaje del envío.
    // Antes de concluir "toma humana" (que silenciaría a Tino por error),
    // esperamos un momento y re-verificamos. Un mensaje humano REAL no calzará
    // ni por id ni por texto reciente, así que esto no lo bloquea.
    await new Promise((r) => setTimeout(r, 2500));
    if (
      (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, m.texto))
    ) {
      return { accion: "eco" };
    }
    await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "humano",
      texto: m.texto,
      waId: m.waId,
      canal: "whatsapp",
    });
    await setModo(empleadoId, chatId, "humano", supa);
    return { accion: "toma_humana" };
  }

  // 5) Mensaje del cliente.
  await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "cliente",
    texto: m.texto,
    waId: m.waId,
    canal: "whatsapp",
  });

  // Contacto: guardar con el número real + nombre visible (best-effort).
  const nombre = m.nombre ?? (await nombreDeContacto(m.jid));
  await supa.from("ed_contactos").upsert(
    {
      cliente_id: clienteId,
      chat_id: chatId,
      nombre: nombre ?? undefined,
      telefono: contacto.telefono ?? undefined,
      etiqueta: "lead",
    },
    { onConflict: "cliente_id,chat_id" },
  );

  await tocarVentanaEntrante(empleadoId, chatId, supa);

  // DEBOUNCE (fix estabilización 24-jul): agrupar mensajes rápidos seguidos.
  // Esperamos una ventana corta; si en ese lapso el cliente manda un mensaje
  // MÁS NUEVO, esta invocación se retira y deja que la del último responda —
  // su historial ya incluirá todos. Evita respuestas solapadas y desordenadas.
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
      // Llegó un mensaje más nuevo: que responda esa invocación, no ésta.
      return { accion: "debounce_superseded" };
    }
  }

  const enviar =
    opts?.enviar ??
    (async (_chatId: string, texto: string) => {
      // Freno de ritmo humano ≥8/min (reutiliza la lógica de la Fase 5).
      const enUltimoMinuto = await enviosUltimoMinuto(supa, empleadoId);
      if (enUltimoMinuto >= 8) {
        const pausa = 8000 + Math.floor(Math.random() * 4000);
        console.log(`[ritmo] ${enUltimoMinuto} envíos/min → pausa ${pausa}ms`);
        await new Promise((r) => setTimeout(r, pausa));
      }
      // Responder a la dirección ORIGINAL (m.jid): es la que WhatsApp espera y
      // la que ya entrega bien (con @lid o @c.us). La unificación es solo de la
      // CLAVE del chat (chatId = número real), no del transporte.
      return enviarTextoWaha(m.jid, texto);
    });

  const r = await responderSiBot({
    clienteId,
    empleadoId,
    chatId,
    enviar,
  });
  return { accion: `cliente:${r.accion}`, detalle: r.detalle };
}
