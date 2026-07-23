import { db } from "@/lib/db";
import {
  parsearWaha,
  parsearAckWaha,
  clientePorInstanciaWaha,
  enviarTextoWaha,
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
 *  0) ACK (message.ack) → actualizar estado_envio y salir.
 *  1) Parsear message. Si no hay texto / es grupo → ignorar.
 *  2) Resolver cliente (por instancia lógica) y Tino.
 *  3) Idempotencia por id (cubre reenvíos y eco de Tino).
 *  4) fromMe con id desconocido = persona (Cecilia) → toma de control humana.
 *  5) Mensaje del cliente → guardar, tocar ventana, responder (respeta el modo).
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

  // 3) Idempotencia + eco de Tino.
  if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
    return { accion: "duplicado" };
  }

  // 4) fromMe con id desconocido = mensaje humano → toma de control.
  if (m.fromMe) {
    if (await esEcoReciente(supa, empleadoId, m.chatId, m.texto)) {
      return { accion: "eco" };
    }
    await guardarMensaje(supa, {
      empleadoId,
      chatId: m.chatId,
      rol: "humano",
      texto: m.texto,
      waId: m.waId,
      canal: "whatsapp",
    });
    await setModo(empleadoId, m.chatId, "humano", supa);
    return { accion: "toma_humana" };
  }

  // 5) Mensaje del cliente.
  await guardarMensaje(supa, {
    empleadoId,
    chatId: m.chatId,
    rol: "cliente",
    texto: m.texto,
    waId: m.waId,
    canal: "whatsapp",
  });

  if (m.nombre) {
    await supa.from("ed_contactos").upsert(
      {
        cliente_id: clienteId,
        chat_id: m.chatId,
        nombre: m.nombre,
        telefono: `+${m.chatId}`,
        etiqueta: "lead",
      },
      { onConflict: "cliente_id,chat_id" },
    );
  }

  await tocarVentanaEntrante(empleadoId, m.chatId, supa);

  const enviar =
    opts?.enviar ??
    (async (chatId: string, texto: string) => {
      // Freno de ritmo humano ≥8/min (reutiliza la lógica de la Fase 5).
      const enUltimoMinuto = await enviosUltimoMinuto(supa, empleadoId);
      if (enUltimoMinuto >= 8) {
        const pausa = 8000 + Math.floor(Math.random() * 4000);
        console.log(`[ritmo] ${enUltimoMinuto} envíos/min → pausa ${pausa}ms`);
        await new Promise((r) => setTimeout(r, pausa));
      }
      return enviarTextoWaha(chatId, texto);
    });

  const r = await responderSiBot({
    clienteId,
    empleadoId,
    chatId: m.chatId,
    enviar,
  });
  return { accion: `cliente:${r.accion}`, detalle: r.detalle };
}
