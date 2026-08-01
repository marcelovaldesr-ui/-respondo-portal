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

  // Se intenta traer los metadatos de adjunto (migración 270). Si esas columnas
  // aún no existen, PostgREST devuelve error y se cae a la consulta clásica —
  // así el inbox funciona igual aunque el deploy vaya por delante de la migración.
  const COLS_MEDIA = "id, rol, texto, creado_en, media_tipo, media_mime, media_nombre";
  const consultaMensajes = async () => {
    const rica = await supa
      .from("ed_mensajes")
      .select(COLS_MEDIA)
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: true })
      .limit(200);
    if (!rica.error) return { data: rica.data, conMedia: true };
    const simple = await supa
      .from("ed_mensajes")
      .select("id, rol, texto, creado_en")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: true })
      .limit(200);
    return { data: simple.data, conMedia: false };
  };

  const [mensajes, estado] = await Promise.all([
    consultaMensajes(),
    supa
      .from("ed_chat_estado")
      .select("modo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    modo: (estado.data?.modo as string) ?? "bot",
    mensajes: (mensajes.data ?? []).map((m) => {
      const mm = m as Record<string, unknown>;
      const tipo = (mm.media_tipo as string | null) ?? null;
      return {
        id: mm.id as string,
        rol: mm.rol as string,
        texto: mm.texto as string,
        creadoEn: mm.creado_en as string,
        // Adjunto visible: el navegador lo pide por el proxy autenticado.
        media: tipo
          ? {
              tipo,
              mime: (mm.media_mime as string | null) ?? null,
              nombre: (mm.media_nombre as string | null) ?? null,
              url: `/api/whatsapp/media?id=${encodeURIComponent(String(mm.id))}`,
            }
          : null,
      };
    }),
  });
}
