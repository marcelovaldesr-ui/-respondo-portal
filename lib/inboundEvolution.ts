import { db } from "@/lib/db";
import {
  parsearEvolution,
  clientePorInstancia,
  enviarTextoEvolution,
} from "@/lib/evolution";
import { tinoDe } from "@/lib/whatsapp";
import { guardarMensaje, yaProcesado, esEcoReciente } from "@/lib/mensajes";
import { setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { responderSiBot } from "@/lib/responderBot";

export type ResultadoEntrante = { accion: string; detalle?: string };

/**
 * Orquesta un evento entrante de Evolution (WhatsApp Opción A). Es el corazón
 * de la CONVIVENCIA Tino + persona. Separado de la ruta HTTP para poder probarlo
 * de forma directa (ver scripts/_test_hibrido.ts).
 *
 * Flujo:
 *  1) Parsear. Si no hay texto / es grupo / estado → ignorar.
 *  2) Resolver cliente (por instancia) y Tino.
 *  3) IDEMPOTENCIA: si el id de WhatsApp ya se procesó → salir. Esto cubre a la
 *     vez los reenvíos de Evolution y el ECO de los propios envíos de Tino
 *     (guardamos el id que Evolution devuelve al enviar).
 *  4) Si el mensaje es fromMe y su id NO estaba registrado → lo escribió una
 *     PERSONA desde el WhatsApp del negocio: TOMA DE CONTROL HUMANA. Se guarda
 *     como contexto (rol=humano), se pausa Tino (modo=humano) y NO se responde.
 *  5) Si es del cliente → se guarda, se toca la ventana y responde el cerebro
 *     (que a su vez respeta el modo: si hay humano/pausado, calla).
 */
export async function manejarEntranteEvolution(
  payload: unknown,
  opts?: {
    /** Inyección del transporte (para pruebas: evita enviar WhatsApp real). */
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoEntrante> {
  const m = parsearEvolution(payload);
  if (!m) return { accion: "ignorado" };

  const clienteId = await clientePorInstancia(m.instancia);
  if (!clienteId) return { accion: "sin_cliente", detalle: m.instancia };
  const empleadoId = await tinoDe(clienteId);
  if (!empleadoId) return { accion: "sin_tino" };

  const supa = db();

  // 3) Idempotencia + eco de Tino (ambos comparten el mismo id ya guardado).
  if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
    return { accion: "duplicado" };
  }

  // 4) fromMe con id desconocido = mensaje humano → toma de control.
  if (m.fromMe) {
    // Red de seguridad ante la carrera "eco antes de guardar el id del envío".
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
    ((chatId: string, texto: string) =>
      enviarTextoEvolution(m.instancia, chatId, texto));

  const r = await responderSiBot({
    clienteId,
    empleadoId,
    chatId: m.chatId,
    enviar,
  });
  return { accion: `cliente:${r.accion}`, detalle: r.detalle };
}
