import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { mediaDeMensajeWaha, reanclarUrlWaha } from "@/lib/waha";
import { configPorCliente, resolverMediaMeta, hostDeMediaPermitido } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
// La resolución bajo demanda puede requerir que WAHA descargue el archivo
// primero (medido: varios segundos en Core). Holgura para no cortar a mitad.
export const maxDuration = 30;

/**
 * Proxy autenticado para VER un adjunto que mandó el cliente (imagen, PDF, audio).
 *
 * Por qué existe: el archivo vive en el servidor del proveedor y su descarga
 * requiere una credencial que jamás debe llegar al navegador. Este endpoint:
 *   1) exige sesión de portal,
 *   2) valida que el mensaje sea de un empleado del cliente logueado (aislamiento
 *      entre negocios — sin esto, cambiar el id dejaría ver adjuntos ajenos),
 *   3) resuelve la URL del archivo y lo reenvía al navegador.
 *
 * DOS TRANSPORTES, DOS FORMAS DE RESOLVER
 *
 * **WAHA** (verificado en vivo, 1-ago-2026, Core/GOWS): el webhook llega con
 * `hasMedia=true` pero `media=null`, así que `media_url` queda NULL y hay que
 * pedirle el archivo a WAHA bajo demanda. La URL resuelta SÍ se cachea, porque
 * no caduca. WAHA devuelve URLs con host `localhost:8080`, así que siempre se
 * re-ancla sobre `WAHA_API_URL` — eso además elimina el riesgo de SSRF.
 *
 * **Meta / Cloud API** (agregado el 21-ago-2026, brecha G5): se guarda
 * `meta:<media_id>` en `media_url` y se canjea contra Graph en CADA visita,
 * porque la URL que devuelve Meta **caduca en minutos**. Cachear esa URL sería
 * cachear basura.
 *
 * ⚠️ Hasta hoy este endpoint solo sabía resolver por WAHA. Como todo cliente
 * nuevo entra por Cloud API, en la práctica **las fotos de los clientes no se
 * podían ver** salvo en el único negocio que quedó en WAHA.
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
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

  const guardado = (msg.media_url as string | null) ?? "";
  let mime = (msg.media_mime as string | null) ?? "";

  /** Lo que hay que descargar y con qué cabeceras. Se arma según el transporte. */
  let urlFinal = "";
  let cabeceras: Record<string, string> | undefined;

  /**
   * ── ARCHIVADO EN NUESTRO PROPIO ALMACENAMIENTO ─────────────────────────────
   *
   * Camino preferido y el único que no caduca. `lib/archivarMedia.ts` bajó el
   * archivo de Meta antes de que lo borrara (7 días para lo que llega por
   * webhook) y dejó acá la ruta del bucket.
   *
   * Se responde con el binario, no con una URL firmada: el bucket es privado y
   * mandarle al navegador un enlace directo a Storage saltaría la validación de
   * `cliente_id` que ya se hizo arriba. El aislamiento entre negocios en este
   * portal es por código, y este es uno de los lugares donde se sostiene.
   */
  if (guardado.startsWith("sb:")) {
    const ruta = guardado.slice("sb:".length);
    const { data, error } = await supa.storage.from("adjuntos").download(ruta);
    if (error || !data) {
      console.error("[media] archivado pero no se pudo leer:", error?.message);
      return new NextResponse("No disponible", { status: 502 });
    }
    return new NextResponse(data, {
      headers: {
        "Content-Type": mime || data.type || "application/octet-stream",
        // Un año: el contenido de un mensaje es inmutable. Ya archivado, además,
        // no hay ningún viaje a Meta que ahorrar en las visitas siguientes.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  /**
   * ── ERA MUY GRANDE, O META YA LO BORRÓ ─────────────────────────────────────
   *
   * Se responde 410 (Gone) y no 404 a propósito: no es que no exista, es que
   * existió y ya no. Decirlo con claridad es mejor que un error mudo que deja a
   * la persona recargando la página pensando que se rompió algo.
   */
  if (guardado.startsWith("meta-grande:")) {
    return new NextResponse(
      "Este archivo superaba los 10 MB que guardamos, y WhatsApp ya lo eliminó de sus servidores.",
      { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  /**
   * Llegamos tarde: cuando el archivador fue a buscarlo, Meta ya lo había
   * borrado. Se distingue del caso anterior a propósito — decirle a alguien que
   * su archivo «era muy grande» cuando en realidad venció lo manda a revisar un
   * límite que no tuvo nada que ver.
   */
  if (guardado.startsWith("meta-vencido:")) {
    return new NextResponse(
      "WhatsApp elimina los archivos a los 7 días y este ya no está disponible.",
      { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (guardado.startsWith("meta:")) {
    // ── Cloud API ────────────────────────────────────────────────────────────
    const mediaId = guardado.slice("meta:".length);
    const cfg = await configPorCliente(usuario.clienteId);
    if (!cfg) return new NextResponse("Sin WhatsApp configurado", { status: 409 });

    const res = await resolverMediaMeta(cfg, mediaId);
    if (!res) return new NextResponse("Sin archivo", { status: 404 });
    if (!hostDeMediaPermitido(res.url)) {
      // Nunca mandar el token del negocio a un host que no sea de Meta.
      console.error("[media] host no permitido en la URL de Meta");
      return new NextResponse("Origen no permitido", { status: 400 });
    }
    urlFinal = res.url;
    mime = mime || res.mime || "";
    cabeceras = { Authorization: `Bearer ${cfg.token}` };
  } else {
    // ── WAHA ─────────────────────────────────────────────────────────────────
    let url = guardado;
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

    const anclada = reanclarUrlWaha(url);
    if (!anclada) return new NextResponse("Origen no permitido", { status: 400 });
    urlFinal = anclada;
    const key = process.env.WAHA_API_KEY;
    cabeceras = key ? { "X-Api-Key": key } : undefined;
  }

  try {
    const r = await fetch(urlFinal, {
      headers: cabeceras,
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return new NextResponse("No disponible", { status: 502 });

    const tipoDeclarado = (mime || r.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const tiposInline = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "audio/mpeg",
      "audio/ogg",
      "audio/mp4",
      "audio/wav",
      "audio/aac",
      "audio/amr",
      "video/mp4",
      "application/pdf",
    ]);
    const seguroInline = tiposInline.has(tipoDeclarado);
    const tipo = seguroInline ? tipoDeclarado : "application/octet-stream";
    const nombre = (msg.media_nombre as string | null) || "archivo";
    const largo = Number(r.headers.get("content-length") ?? "0");
    if (Number.isFinite(largo) && largo > 25 * 1024 * 1024) {
      return new NextResponse("Archivo demasiado grande", { status: 413 });
    }
    // Reenviar como stream: un adjunto grande ya no se copia entero a memoria
    // dentro de la función serverless.
    return new NextResponse(r.body, {
      status: 200,
      headers: {
        "Content-Type": tipo,
        // Se muestra inline (imágenes/PDF) pero con nombre por si se descarga.
        "Content-Disposition": `${seguroInline ? "inline" : "attachment"}; filename="${nombre.replace(/[^\w.\- ]/g, "_")}"`,
        /**
         * CACHÉ LARGA, A PROPÓSITO (21-ago-2026). Antes eran 5 minutos, así que
         * volver a abrir una conversación volvía a descargar cada foto — y en
         * Cloud API cada descarga son DOS viajes a Meta, no uno.
         *
         * El contenido de un mensaje es inmutable: la foto que mandó alguien el
         * martes es la misma para siempre. `private` mantiene la caché en el
         * navegador de esa persona y fuera de cualquier CDN compartida, que es
         * lo correcto para material de un cliente.
         */
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Error al descargar", { status: 502 });
  }
}
