import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Mensajes de un chat en JSON, para el refresco en vivo del inbox (polling
 * liviano, sin recargar toda la página). Devuelve también el modo actual para
 * reflejar en vivo si el bot o un humano tiene el control.
 *
 * Seguridad: sesión de portal + el empleado debe ser del cliente logueado.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const empleadoId = searchParams.get("emp") ?? "";
  const chatId = searchParams.get("chat") ?? "";
  if (!empleadoId || !chatId) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const supa = db();

  // Barrera de acceso: el empleado tiene que ser del cliente logueado.
  const { data: emp } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const [mensajes, estado] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("rol, texto, creado_en")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: true })
      .limit(200),
    supa
      .from("ed_chat_estado")
      .select("modo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    modo: (estado.data?.modo as string) ?? "bot",
    mensajes: (mensajes.data ?? []).map((m) => ({
      rol: m.rol as string,
      texto: m.texto as string,
      creadoEn: m.creado_en as string,
    })),
  });
}
