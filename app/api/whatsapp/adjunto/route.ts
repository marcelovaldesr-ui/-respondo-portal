import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { enviarAdjuntoComoHumano } from "@/lib/adjuntoChat";

export const dynamic = "force-dynamic";
// Subir a Meta + enviar son dos viajes, y un PDF de varios MB no es instantáneo.
export const maxDuration = 60;

/**
 * ENVIAR UN ADJUNTO DESDE EL INBOX DEL PORTAL.
 *
 * Todo el trabajo — validar el archivo, subirlo a Meta, mandarlo, guardarlo
 * con metadatos — vive en lib/adjuntoChat.ts (enviarAdjuntoComoHumano), que es
 * el MISMO código que usa /api/externo/adjunto para el puente con Gestión. Acá
 * solo se autentica por sesión y se lee el FormData.
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo leer el archivo." }, { status: 400 });
  }

  const empleadoId = String(form.get("empleadoId") ?? "");
  const chatId = String(form.get("chatId") ?? "");
  const caption = String(form.get("caption") ?? "").trim();
  const archivo = form.get("archivo");

  if (!empleadoId || !chatId || !(archivo instanceof File)) {
    return NextResponse.json({ ok: false, error: "Faltan datos del archivo" }, { status: 400 });
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());

  const r = await enviarAdjuntoComoHumano({
    clienteId: usuario.clienteId,
    empleadoId,
    chatId,
    bytes,
    mime: archivo.type,
    nombre: archivo.name,
    caption,
    // El ritmo se cuenta por PERSONA logueada, igual que el texto: con la
    // clave por negocio, dos operadores del mismo cliente se bloqueaban entre
    // sí (auditoría 3-sep-2026).
    limiteClave: usuario.email,
  });

  return NextResponse.json(r);
}
