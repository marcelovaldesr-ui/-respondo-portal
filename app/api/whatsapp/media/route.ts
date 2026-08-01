import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { mediaDeMensajeWaha, reanclarUrlWaha } from "@/lib/waha";

export const dynamic = "force-dynamic";
// La resolución bajo demanda puede requerir que WAHA descargue el archivo
// primero (medido: varios segundos en Core). Holgura para no cortar a mitad.
export const maxDuration = 30;

/**
 * Proxy autenticado para VER un adjunto que mandó el cliente (imagen, PDF, audio).
 *
 * Por qué existe: el archivo vive en el servidor de WAHA y su descarga requiere
 * la clave X-Api-Key, que jamás debe llegar al navegador. Este endpoint:
 *   1) exige sesión de portal,
 *   2) valida que el mensaje sea de un empleado del cliente logueado (aislamiento
 *      entre negocios — sin esto, cambiar el id dejaría ver adjuntos ajenos),
 *   3) resuelve la URL del archivo y lo reenvía al navegador.
 *
 * CÓMO SE RESUELVE LA URL (verificado en vivo, 1-ago-2026, WAHA Core/GOWS):
 *  - El webhook de Core llega con hasMedia=true pero media=null → media_url en
 *    la base queda NULL. Por eso, si hay adjunto (media_tipo) y tenemos el
 *    wa_message_id, se le PIDE a WAHA bajo demanda (downloadMedia=true) y la
 *    URL resuelta se cachea en media_url para las próximas veces.
 *  - WAHA devuelve URLs con host `localhost:8080` (no conoce su URL pública):
 *    SIEMPRE se re-ancla el path sobre WAHA_API_URL (reanclarUrlWaha). Ese
 *    re-anclado, además, elimina el riesgo SSRF: nunca se descarga de un host
 *    distinto del WAHA propio, sin importar qué haya guardado en la base.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return new NextResponse("Sesión no válida", { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return new NextResponse("Falta id", { status: 400 });

  const supa = db();

  // Traer el mensaje + el cliente dueño del empleado (aislamiento por tenant).
  const { data: msg } = await supa
    .from("ed_mensajes")
    .select(
      "id, chat_id, wa_message_id, media_url, media_mime, media_tipo, media_nombre, ed_empleados!inner(cliente_id)",
    )
    .eq("id", id)
    .maybeSingle();

  const clienteDelMensaje = (msg as { ed_empleados?: { cliente_id?: string } } | null)
    ?.ed_empleados?.cliente_id;
  if (!msg || clienteDelMensaje !== usuario.clienteId) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  let url = (msg.media_url as string | null) ?? "";
  let mime = (msg.media_mime as string | null) ?? "";

  // Sin URL guardada (el caso normal en WAHA Core): resolver bajo demanda.
  if (!url && msg.media_tipo && msg.wa_message_id) {
    const res = await mediaDeMensajeWaha(
      msg.chat_id as string,
      msg.wa_message_id as string,
    );
    if (res) {
      url = res.url;
      mime = mime || res.mimetype || "";
      // Cachear para la próxima (best-effort; si falla, se vuelve a resolver).
      await supa
        .from("ed_mensajes")
        .update({ media_url: url, media_mime: mime || null })
        .eq("id", msg.id)
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }
  if (!url) return new NextResponse("Sin archivo", { status: 404 });

  // Re-anclar SIEMPRE al host de WAHA configurado (anti-SSRF por construcción).
  const urlFinal = reanclarUrlWaha(url);
  if (!urlFinal) return new NextResponse("Origen no permitido", { status: 400 });

  const key = process.env.WAHA_API_KEY;
  try {
    const r = await fetch(urlFinal, {
      headers: key ? { "X-Api-Key": key } : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return new NextResponse("No disponible", { status: 502 });

    const buf = await r.arrayBuffer();
    const tipo = mime || r.headers.get("content-type") || "application/octet-stream";
    const nombre = (msg.media_nombre as string | null) || "archivo";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": tipo,
        // Se muestra inline (imágenes/PDF) pero con nombre por si se descarga.
        "Content-Disposition": `inline; filename="${nombre.replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse("Error al descargar", { status: 502 });
  }
}
