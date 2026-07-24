"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha, enviarMediaWaha } from "@/lib/waha";

/**
 * Control del cliente sobre una conversación: pausar al asistente, tomar el
 * chat o devolvérselo.
 *
 * Estados de ed_chat_estado:
 *  - bot     → el asistente responde normalmente
 *  - humano  → alguien del negocio tomó la conversación; el asistente calla
 *  - pausado → nadie responde automáticamente (el dueño quiere silencio)
 *
 * SEGURIDAD: el empleado_id llega del navegador, así que se valida que sea de
 * un empleado del cliente logueado antes de escribir. Sin esa validación,
 * cambiar un id en la petición dejaría pausar el bot de otro negocio.
 */

const MODOS = ["bot", "humano", "pausado"] as const;
type Modo = (typeof MODOS)[number];

export async function cambiarModo(formData: FormData) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const modo = String(formData.get("modo") ?? "") as Modo;

  if (!empleadoId || !chatId || !MODOS.includes(modo)) return;

  const supa = db();

  // Barrera de acceso: el empleado tiene que pertenecer a este cliente.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!empleado) return;

  // upsert: puede no existir fila de estado si el chat nunca cambió de modo.
  await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo, actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );

  // Al devolverle el control al asistente se cierra la escalación pendiente:
  // si no, la conversación seguiría apareciendo como "te espera" para siempre.
  if (modo === "bot") {
    await supa
      .from("ed_escalaciones")
      .update({ atendida_en: new Date().toISOString() })
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .is("atendida_en", null);
  }

  revalidatePath("/conversaciones");
  revalidatePath("/inicio");
}

/**
 * El humano del negocio responde al cliente desde el inbox (Opción B, Fase 3).
 * Guarda el mensaje como 'humano', pone el chat en modo humano (el bot calla) y
 * lo envía por la Cloud API. Si no hay token configurado (dev sin Meta), el
 * mensaje queda guardado pero no se envía, y se informa.
 */
export async function responderComoHumano(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!empleadoId || !chatId || !texto) return;

  const supa = db();

  // Barrera de acceso: el empleado tiene que ser de este cliente.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!empleado) return;

  // Tomar el control: el bot no responde mientras el humano está en el chat.
  await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo: "humano", actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );

  // Cerrar escalación pendiente de este chat (el humano ya está respondiendo).
  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  // Enviar por WhatsApp, eligiendo el transporte SEGÚN EL CLIENTE (no global):
  //  - Si el cliente tiene Cloud API configurada (waba_token) → Meta oficial.
  //  - Si no → WAHA (no oficial), que es el caso de Impresora Color.
  // Así un cliente de Meta NUNCA sale por la sesión WAHA de otro, y viceversa.
  // (Antes SIEMPRE usaba Cloud API → el texto de la persona no llegaba cuando el
  // cliente está en WAHA, porque configPorCliente devolvía null y no se enviaba.)
  const cfg = await configPorCliente(usuario.clienteId);
  if (cfg) {
    await enviarTexto(cfg, chatId, texto);
  } else {
    await enviarTextoWaha(chatId, texto);
  }

  // Guardar el mensaje del humano. No se pone 'canal' explícito: lo aporta el
  // default de la migración 210, y así este insert funciona aunque 210 no esté
  // aplicada todavía (columna inexistente = se omite sin error).
  await supa.from("ed_mensajes").insert({
    empleado_id: empleadoId,
    chat_id: chatId,
    rol: "humano",
    texto,
  });

  revalidatePath("/conversaciones");
}

/**
 * La persona del negocio envía una IMAGEN o un PDF al cliente desde el inbox.
 * Igual que responderComoHumano: toma el control (el bot calla), manda por WAHA y
 * deja registro en el historial. `data` llega en base64 (sin prefijo) desde el
 * navegador. Devuelve {ok} para que el compositor muestre el error si lo hay.
 *
 * Límite: 12MB de base64 (~9MB de archivo). El tope real lo fija también
 * `serverActions.bodySizeLimit` en next.config.mjs; si falta, un archivo grande
 * falla con "Body exceeded limit" antes de llegar acá.
 */
export async function enviarArchivoComoHumano(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const filename = String(formData.get("filename") ?? "archivo");
  const mimetype = String(formData.get("mimetype") ?? "application/octet-stream");
  const data = String(formData.get("data") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  if (!empleadoId || !chatId || !data) {
    return { ok: false, error: "Faltan datos del archivo" };
  }

  const supa = db();

  // Barrera de acceso: el empleado tiene que ser de este cliente.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!empleado) return { ok: false, error: "Sin acceso a este chat" };

  // Tomar el control: el bot no responde mientras la persona está en el chat.
  await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo: "humano", actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );
  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  // Transporte por cliente (mismo criterio que el texto). El envío de media por
  // Cloud API todavía no está implementado; los clientes de Meta reciben un aviso
  // claro en vez de un envío silencioso por el canal equivocado.
  const cfg = await configPorCliente(usuario.clienteId);
  if (cfg) {
    return {
      ok: false,
      error:
        "Por ahora los archivos solo se pueden enviar en los números conectados por WAHA. En Meta (Cloud API) llega en una próxima etapa.",
    };
  }

  // Enviar por WAHA (imagen inline o documento según el mimetype).
  const r = await enviarMediaWaha(chatId, {
    data,
    mimetype,
    filename,
    caption: caption || undefined,
  });
  if (!r.ok) return { ok: false, error: r.error || "No se pudo enviar el archivo" };

  // Registro en el historial. El portal todavía no renderiza media en la línea de
  // tiempo, así que se guarda un texto descriptivo (y el caption si lo hubo).
  const etiqueta = mimetype.startsWith("image/")
    ? "📷 Imagen enviada"
    : `📎 Archivo enviado: ${filename}`;
  await supa.from("ed_mensajes").insert({
    empleado_id: empleadoId,
    chat_id: chatId,
    rol: "humano",
    texto: caption ? `${etiqueta} — ${caption}` : etiqueta,
  });

  revalidatePath("/conversaciones");
  return { ok: true };
}

/**
 * Agrega o quita una etiqueta de una conversación (manual, por el humano).
 * Las etiquetas viven en ed_contactos.etiquetas (arreglo). Se valida que el
 * contacto sea del cliente logueado.
 */
export async function cambiarEtiqueta(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) throw new Error("Sesión no válida");

  const chatId = String(formData.get("chatId") ?? "");
  const etiqueta = String(formData.get("etiqueta") ?? "").trim();
  const accion = String(formData.get("accion") ?? ""); // "agregar" | "quitar"
  if (!chatId || !etiqueta || !["agregar", "quitar"].includes(accion)) return;

  const supa = db();

  // Traer el contacto (y validar cliente). Si no existe, crearlo con la etiqueta.
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("etiquetas")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();

  const actuales: string[] = (contacto?.etiquetas as string[] | null) ?? [];
  const nuevas =
    accion === "agregar"
      ? Array.from(new Set([...actuales, etiqueta]))
      : actuales.filter((e) => e !== etiqueta);

  await supa
    .from("ed_contactos")
    .upsert(
      {
        cliente_id: usuario.clienteId,
        chat_id: chatId,
        etiquetas: nuevas,
        etiqueta: "lead",
      },
      { onConflict: "cliente_id,chat_id" },
    );

  revalidatePath("/conversaciones");
}
