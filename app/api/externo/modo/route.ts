import { autenticarExterno } from "@/lib/externo";
import { MODOS, type Modo } from "@/lib/controlChat";
import { empleadoDelChat, fijarModo } from "@/lib/responderChat";

/**
 * Pausar al asistente, tomar el chat o devolvérselo, desde la app del negocio.
 *
 * En la práctica se usa poco: si la persona responde desde su teléfono, el
 * webhook ya detecta el mensaje propio y deja el chat en modo humano solo. Esto
 * sirve para el caso que eso no cubre — callar al asistente SIN escribir.
 *
 * Cuerpo: { clienteId, chatId, modo: "bot" | "humano" | "pausado" }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;

  const { clienteId, cuerpo } = auth;
  const chatId = typeof cuerpo.chatId === "string" ? cuerpo.chatId : "";
  const modo = String(cuerpo.modo ?? "") as Modo;
  if (!chatId || !MODOS.includes(modo)) {
    return Response.json({ ok: false, error: "Falta chatId o modo válido" }, { status: 400 });
  }

  const empleadoId = await empleadoDelChat(clienteId, chatId);
  if (!empleadoId) {
    return Response.json({ ok: false, error: "Este negocio no tiene asistente activo" }, { status: 409 });
  }

  return Response.json(await fijarModo({ clienteId, empleadoId, chatId, modo }));
}
