import { clienteDeFirmaExterna } from "@/lib/externo";
import { empleadoDelChat } from "@/lib/responderChat";
import { enviarAdjuntoComoHumano } from "@/lib/adjuntoChat";

/**
 * El negocio manda una foto o un PDF a su cliente desde su propia app.
 *
 * Hermano de /api/externo/responder, pero con archivo: no se puede firmar el
 * cuerpo entero (es multipart binario), así que se firma una cadena canónica
 * — `chatId=<chatId>` — igual que ya hace /api/whatsapp/media para las
 * descargas. El trabajo de verdad (subir a Meta, enviar, guardar con
 * metadatos) vive en lib/adjuntoChat.ts, el MISMO código del inbox del portal.
 *
 * FormData: chatId, caption (opcional), archivo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "No se pudo leer el archivo." }, { status: 400 });
  }

  const chatId = String(form.get("chatId") ?? "");
  const caption = String(form.get("caption") ?? "").trim();
  const archivo = form.get("archivo");

  if (!chatId || !(archivo instanceof File)) {
    return Response.json({ ok: false, error: "Falta chatId o el archivo" }, { status: 400 });
  }

  const clienteId = await clienteDeFirmaExterna(request, `chatId=${chatId}`);
  if (!clienteId) return Response.json({ ok: false, error: "Firma inválida" }, { status: 401 });

  const empleadoId = await empleadoDelChat(clienteId, chatId);
  if (!empleadoId) {
    return Response.json({ ok: false, error: "Este negocio no tiene asistente activo" }, { status: 409 });
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());

  const r = await enviarAdjuntoComoHumano({
    clienteId,
    empleadoId,
    chatId,
    bytes,
    mime: archivo.type,
    nombre: archivo.name,
    caption,
    limiteClave: `externo:${clienteId}`,
  });

  return Response.json(r);
}
