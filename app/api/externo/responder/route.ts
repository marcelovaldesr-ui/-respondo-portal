import { autenticarExterno } from "@/lib/externo";
import { empleadoDelChat, enviarComoHumano } from "@/lib/responderChat";

/**
 * El negocio responde a su cliente desde su propia app.
 *
 * Todo el trabajo —silenciar al asistente antes de esperar a WhatsApp, elegir
 * el canal, guardar el mensaje con el id del envío para que el eco no se
 * duplique, cerrar la escalación— vive en lib/responderChat.ts, que es el
 * MISMO código que usa el inbox del portal. Acá solo se autentica y se resuelve
 * qué asistente atiende el chat.
 *
 * Cuerpo: { clienteId, chatId, texto }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;

  const { clienteId, cuerpo } = auth;
  const chatId = typeof cuerpo.chatId === "string" ? cuerpo.chatId : "";
  const texto = typeof cuerpo.texto === "string" ? cuerpo.texto : "";
  if (!chatId || !texto.trim()) {
    return Response.json({ ok: false, error: "Falta chatId o texto" }, { status: 400 });
  }

  const empleadoId = await empleadoDelChat(clienteId, chatId);
  if (!empleadoId) {
    return Response.json({ ok: false, error: "Este negocio no tiene asistente activo" }, { status: 409 });
  }

  const r = await enviarComoHumano({
    clienteId,
    empleadoId,
    chatId,
    texto,
    // El ritmo se cuenta por negocio: es el número de WhatsApp que se protege.
    limiteClave: `externo:${clienteId}`,
  });

  // 200 aunque `ok:false`: son errores de negocio (chat ajeno, texto largo,
  // WhatsApp rechazó), no fallas del servidor. El detalle va en el cuerpo para
  // que la app del cliente lo muestre tal cual.
  return Response.json(r);
}
