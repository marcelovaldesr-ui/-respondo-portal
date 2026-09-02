import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { guardarMensaje } from "@/lib/mensajes";
import { revisarAdjuntoSalida } from "@/lib/adjuntoSalida";
import { restaurarControl, tomarControlTemporal, transporteSalida } from "@/lib/controlChat";
import { enviarMediaWaha } from "@/lib/waha";
import { enviarMediaMeta, subirMediaMeta } from "@/lib/whatsapp";
import { limitarDistribuido } from "@/lib/seguridad";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import type { ResultadoEnvio } from "@/lib/responderChat";

/**
 * ENVIAR UN ADJUNTO — el núcleo, sin sesión.
 *
 * Hermano de responderChat.ts (enviarComoHumano), mismo motivo de existir: esto
 * vivía solo dentro de app/api/whatsapp/adjunto/route.ts, atado a la sesión del
 * portal. El puente hacia el sistema del cliente (Gestión) necesita mandar
 * fotos y PDF igual que un operador del inbox, sin duplicar subida a Meta,
 * validación del archivo ni el guardado con metadatos.
 *
 * Quien llame esto ya tuvo que autenticar por su cuenta (sesión de portal o
 * firma externa) — acá no se vuelve a comprobar quién pide, solo que el
 * empleado y el contacto sean de este `clienteId`.
 */
export async function enviarAdjuntoComoHumano(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  bytes: Uint8Array;
  mime: string;
  nombre: string;
  caption?: string;
  /** Clave del anti-abuso: identifica a QUIÉN se le cuenta el ritmo. */
  limiteClave: string;
  supa?: SupabaseClient;
}): Promise<ResultadoEnvio> {
  const { clienteId, empleadoId, chatId, bytes, limiteClave } = params;
  const caption = (params.caption ?? "").trim();
  const supa = params.supa ?? db();

  if (!empleadoId || !chatId) return { ok: false, error: "Faltan datos" };

  // Freno de abuso: subir archivos es lo más caro que expone este camino.
  if (!(await limitarDistribuido(`adjunto:${limiteClave}`, 30, 60)).ok) {
    return { ok: false, error: "Demasiados envíos seguidos. Espera un momento." };
  }

  const revision = revisarAdjuntoSalida({ bytes, mime: params.mime, nombre: params.nombre });
  if (!revision.ok) return { ok: false, error: revision.error };

  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa.from("ed_empleados").select("id").eq("id", empleadoId).eq("cliente_id", clienteId).maybeSingle(),
    supa.from("ed_contactos").select("chat_id").eq("cliente_id", clienteId).eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat" };

  if (chatId.startsWith("ig:")) {
    return {
      ok: false,
      error: "Por ahora los archivos solo se pueden enviar por WhatsApp. En Instagram puedes responder con texto.",
    };
  }

  const transporte = await transporteSalida(clienteId);
  if (transporte.tipo === "error") return { ok: false, error: transporte.error };

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat" };

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
      return { ok: false, error: `No se pudo subir el archivo: ${subida.error}` };
    }
    refMedia = `meta:${subida.id}`;
    envio = await enviarMediaMeta(transporte.config, chatId, {
      id: subida.id,
      tipo: revision.esImagen ? "image" : "document",
      caption: caption || undefined,
      nombre: revision.nombre,
    });
  } else {
    envio = await enviarMediaWaha(chatId, {
      data: Buffer.from(bytes).toString("base64"),
      mimetype: revision.mime,
      filename: revision.nombre,
      caption: caption || undefined,
    });
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: envio.error || "No se pudo enviar el archivo" };
  }

  const etiqueta = revision.esImagen ? "📷 Imagen enviada" : `📎 Archivo enviado: ${revision.nombre}`;
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto: caption ? `${etiqueta} — ${caption}` : etiqueta,
    waId: envio.waId,
    canal: "whatsapp",
    media: {
      url: refMedia,
      tipo: revision.esImagen ? "imagen" : "documento",
      mime: revision.mime,
      nombre: revision.nombre,
    },
  });
  if (!guardado.ok) {
    return {
      ok: false,
      enviado: true,
      error: "El archivo salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }

  await cerrarEscalacionesPendientes(supa, { empleadoIds: [empleadoId], chatId, clienteId });

  return { ok: true };
}
