import { db } from "@/lib/db";
import { autenticarExterno } from "@/lib/externo";
import { empleadoDelChat } from "@/lib/responderChat";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";

/**
 * EL HILO DE UNA CONVERSACIÓN, para que el negocio lo lea desde su propia app.
 *
 * Es POST y no GET a propósito: así la firma se calcula sobre el cuerpo, igual
 * que en el resto del puente, y no hay que inventar una forma canónica de
 * firmar una query string.
 *
 * Cuerpo: { clienteId, chatId, limite? }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_POR_OMISION = 60;
const LIMITE_MAXIMO = 200;

export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;

  const { clienteId, cuerpo } = auth;
  const chatId = typeof cuerpo.chatId === "string" ? cuerpo.chatId : "";
  if (!chatId) return Response.json({ ok: false, error: "Falta chatId" }, { status: 400 });

  const limite = Math.min(
    Number(cuerpo.limite) > 0 ? Number(cuerpo.limite) : LIMITE_POR_OMISION,
    LIMITE_MAXIMO,
  );

  const supa = db();

  // AISLAMIENTO POR NEGOCIO: el contacto tiene que ser de este cliente. Sin
  // esta línea, un `chatId` cualquiera dejaría leer la conversación de otro.
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, telefono, etapa, etiquetas, ultimo_mensaje_en, total_mensajes")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) return Response.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });

  const empleadoId = await empleadoDelChat(clienteId, chatId, supa);
  if (!empleadoId) {
    return Response.json({ ok: false, error: "Este negocio no tiene asistente activo" }, { status: 409 });
  }

  // Se piden los ÚLTIMOS y después se dan vuelta: el orden natural para leer es
  // del más viejo al más nuevo, pero traer los primeros 60 de una conversación
  // de 300 mensajes mostraría el saludo de hace meses.
  // El hilo es por NÚMERO: mensajes y derivaciones de TODOS los empleados del
  // cliente (Tino, Beto, Vera), no solo del dueño del chat (auditoría 3-sep).
  const hilo = await idsEmpleadosDeCliente(clienteId);
  const [{ data: mensajes }, { data: estado }, { data: escalacion }] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("id, rol, texto, creado_en, canal, media_tipo, media_nombre, estado_envio")
      .in("empleado_id", hilo)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: false })
      .limit(limite),
    supa
      .from("ed_chat_estado")
      .select("modo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    supa
      .from("ed_escalaciones")
      .select("trigger, resumen, creado_en")
      .in("empleado_id", hilo)
      .eq("chat_id", chatId)
      .is("atendida_en", null)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return Response.json({
    ok: true,
    contacto,
    empleadoId,
    // Sin fila de estado el chat nunca cambió de modo: el asistente responde.
    modo: (estado?.modo as string | null) ?? "bot",
    // Lo que el asistente no supo resolver. Es el motivo por el que esta
    // conversación está esperando a una persona, y ayuda a saber con qué abrir.
    esperando: escalacion ?? null,
    mensajes: (mensajes ?? []).slice().reverse(),
  });
}
