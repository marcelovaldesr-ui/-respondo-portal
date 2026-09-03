import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { guardarMensaje } from "@/lib/mensajes";
import { revisarAdjuntoSalida } from "@/lib/adjuntoSalida";
import {
  conservarPausa,
  restaurarControl,
  tomarControlTemporal,
  transporteSalida,
} from "@/lib/controlChat";
import { enviarMediaWaha } from "@/lib/waha";
import { enviarMediaMeta, subirMediaMeta } from "@/lib/whatsapp";
import { limitarDistribuido } from "@/lib/seguridad";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { ventanaAbierta } from "@/lib/ventana24";
import { explicarErrorMeta } from "@/lib/erroresMeta";
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
    return { ok: false, error: "Demasiados envíos seguidos. Espera un momento.", codigo: "limite" };
  }

  const revision = revisarAdjuntoSalida({ bytes, mime: params.mime, nombre: params.nombre });
  if (!revision.ok) return { ok: false, error: revision.error };

  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa.from("ed_empleados").select("id").eq("id", empleadoId).eq("cliente_id", clienteId).maybeSingle(),
    supa.from("ed_contactos").select("chat_id").eq("cliente_id", clienteId).eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat", codigo: "sin_acceso" };

  if (chatId.startsWith("ig:")) {
    return {
      ok: false,
      codigo: "canal",
      error: "Por ahora los archivos solo se pueden enviar por WhatsApp. En Instagram puedes responder con texto.",
    };
  }

  const transporte = await transporteSalida(clienteId);
  if (transporte.tipo === "error") return { ok: false, error: transporte.error, codigo: "canal" };

  // Fuera de las 24 h Meta acepta el envío y lo rechaza después por el webhook
  // (131047): el archivo "salía" y no llegaba. Mismo chequeo que en el texto.
  if (transporte.tipo === "cloud" && !(await ventanaAbierta({ clienteId, chatId, supa }))) {
    return {
      ok: false,
      codigo: "ventana_cerrada",
      error:
        "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp no entrega archivos ni texto libre. " +
        "Retoma la conversación con una plantilla y manda el archivo cuando responda.",
    };
  }

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat", codigo: "registro" };

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
      return { ok: false, error: explicarErrorMeta(subida.error, "archivo"), codigo: "proveedor" };
    }
    refMedia = `meta:${subida.id}`;
    envio = await enviarMediaMeta(transporte.config, chatId, {
      id: subida.id,
      // Solo JPEG/PNG ≤ 5 MB van como imagen; WEBP/GIF o fotos grandes van
      // como documento, que Meta sí acepta (ver adjuntoSalida.ts).
      tipo: revision.imagenParaMeta ? "image" : "document",
      caption: caption || undefined,
      nombre: revision.nombre,
    });
  } else {
    envio = await enviarMediaWaha(
      chatId,
      {
        data: Buffer.from(bytes).toString("base64"),
        mimetype: revision.mime,
        filename: revision.nombre,
        caption: caption || undefined,
      },
      // La sesión de WAHA es de UN negocio: si este no es el dueño, no sale.
      { clienteId },
    );
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: explicarErrorMeta(envio.error, "archivo"), codigo: "proveedor" };
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
      codigo: "registro",
      error: "El archivo salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }

  // Por CHAT, no por [empleadoId]: la derivación pudo abrirla Tino aunque el
  // adjunto se registre bajo otro empleado.
  await cerrarEscalacionesPendientes(supa, {
    empleadoIds: await idsEmpleadosDeCliente(clienteId),
    chatId,
    clienteId,
  });
  await conservarPausa(supa, empleadoId, chatId, control);

  // El id real y el adjunto ya resuelto, para que la bandeja reemplace la
  // burbuja temporal en vez de mostrar la temporal Y la real (auditoría
  // 3-sep-2026, C). La URL es la del proxy autenticado, como en inboxConsulta.
  return {
    ok: true,
    mensajeId: guardado.id ?? undefined,
    texto: caption ? `${etiqueta} — ${caption}` : etiqueta,
    media: guardado.id
      ? {
          tipo: revision.esImagen ? "imagen" : "documento",
          mime: revision.mime,
          nombre: revision.nombre,
          url: `/api/whatsapp/media?id=${encodeURIComponent(guardado.id)}`,
        }
      : null,
  };
}
