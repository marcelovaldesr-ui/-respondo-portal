import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { guardarMensaje } from "@/lib/mensajes";
import { revisarAdjuntoSalida } from "@/lib/adjuntoSalida";
import {
  restaurarControl,
  tomarControlTemporal,
  transporteSalida,
} from "@/lib/controlChat";
import { enviarMediaWaha } from "@/lib/waha";
import { enviarMediaMeta, subirMediaMeta } from "@/lib/whatsapp";
import { limitarDistribuido } from "@/lib/seguridad";

export const dynamic = "force-dynamic";
// Subir a Meta + enviar son dos viajes, y un PDF de varios MB no es instantáneo.
export const maxDuration = 60;

/**
 * ENVIAR UN ADJUNTO DESDE EL INBOX.
 *
 * POR QUÉ ES UNA RUTA DE API Y NO UNA SERVER ACTION
 * -------------------------------------------------
 * Antes esto era una server action y el archivo viajaba **en base64 dentro de un
 * FormData**. Tres problemas de fondo:
 *
 *  1. Base64 infla el contenido un 33%. Con el tope de 12 MB de la acción, el
 *     límite real para la persona quedaba en 8 MB — y el mensaje de error hablaba
 *     de 8 MB sin poder explicar por qué.
 *  2. El navegador tenía que leer el archivo entero a memoria y convertirlo antes
 *     de empezar a subir. En un teléfono con una foto grande, eso son segundos de
 *     nada mientras la interfaz parece congelada.
 *  3. No había forma de mostrar progreso: una server action es opaca.
 *
 * Ahora el binario viaja tal cual y se puede seguir el avance de la subida.
 *
 * QUÉ MÁS CAMBIÓ
 * --------------
 * **Cloud API ya puede enviar archivos.** Hasta hoy el portal respondía «los
 * archivos solo se pueden enviar en los números conectados por WAHA», o sea que
 * la función no existía para ningún cliente nuevo.
 *
 * Y el mensaje se guarda **con metadatos de adjunto**, así que la imagen se ve en
 * la conversación. Antes se guardaba como el texto «📷 Imagen enviada» y quien
 * miraba el historial no sabía qué se había mandado.
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  // Freno de abuso: subir archivos es lo más caro que expone el portal.
  const permitido = await limitarDistribuido(`adjunto:${usuario.clienteId}`, 30, 60);
  if (!permitido) {
    return NextResponse.json(
      { ok: false, error: "Demasiados envíos seguidos. Espera un momento." },
      { status: 429 },
    );
  }

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
  const revision = revisarAdjuntoSalida({
    bytes,
    mime: archivo.type,
    nombre: archivo.name,
  });
  if (!revision.ok) {
    return NextResponse.json({ ok: false, error: revision.error }, { status: 400 });
  }

  const supa = db();
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa
      .from("ed_empleados")
      .select("id")
      .eq("id", empleadoId)
      .eq("cliente_id", usuario.clienteId)
      .maybeSingle(),
    supa
      .from("ed_contactos")
      .select("chat_id")
      .eq("cliente_id", usuario.clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);
  if (!empleado || !contacto) {
    return NextResponse.json({ ok: false, error: "Sin acceso a este chat" }, { status: 403 });
  }

  if (chatId.startsWith("ig:")) {
    return NextResponse.json({
      ok: false,
      error: "Por ahora los archivos solo se pueden enviar por WhatsApp. En Instagram puedes responder con texto.",
    });
  }

  const transporte = await transporteSalida(usuario.clienteId);
  if (transporte.tipo === "error") {
    return NextResponse.json({ ok: false, error: transporte.error });
  }

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) {
    return NextResponse.json({ ok: false, error: "No se pudo tomar el control del chat" });
  }

  /** `meta:<id>` para que el proxy sepa resolverlo después; null en WAHA. */
  let refMedia: string | null = null;
  let envio: { ok: boolean; waId?: string; error?: string };

  if (transporte.tipo === "cloud") {
    const subida = await subirMediaMeta(transporte.config, {
      bytes,
      mime: revision.mime,
      nombre: revision.nombre,
    });
    if (!subida.ok) {
      await restaurarControl(supa, empleadoId, chatId, control);
      return NextResponse.json({ ok: false, error: `No se pudo subir el archivo: ${subida.error}` });
    }
    refMedia = `meta:${subida.id}`;
    envio = await enviarMediaMeta(transporte.config, chatId, {
      id: subida.id,
      tipo: revision.esImagen ? "image" : "document",
      caption: caption || undefined,
      nombre: revision.nombre,
    });
  } else {
    // WAHA sigue recibiendo base64: es su API, no una decisión nuestra.
    envio = await enviarMediaWaha(chatId, {
      data: Buffer.from(bytes).toString("base64"),
      mimetype: revision.mime,
      filename: revision.nombre,
      caption: caption || undefined,
    });
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return NextResponse.json({ ok: false, error: envio.error || "No se pudo enviar el archivo" });
  }

  /**
   * El texto describe el adjunto para que el historial se entienda sin imagen
   * (y para que el modelo, que lee texto, sepa qué pasó). El adjunto real va en
   * los metadatos y es lo que dibuja el inbox.
   */
  const etiqueta = revision.esImagen ? "📷 Imagen enviada" : `📎 Archivo enviado: ${revision.nombre}`;
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto: caption ? `${etiqueta} — ${caption}` : etiqueta,
    waId: envio.waId,
    canal: "whatsapp",
    media: {
      url: refMedia, // null en WAHA: no expone una URL estable del saliente
      tipo: revision.esImagen ? "imagen" : "documento",
      mime: revision.mime,
      nombre: revision.nombre,
    },
  });
  if (!guardado.ok) {
    return NextResponse.json({
      ok: false,
      enviado: true,
      error: "El archivo salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    });
  }

  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  return NextResponse.json({ ok: true });
}
