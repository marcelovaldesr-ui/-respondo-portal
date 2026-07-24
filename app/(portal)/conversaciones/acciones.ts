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

  // Enviar por WhatsApp: Cloud API si el cliente la tiene configurada; si no,
  // WAHA (Opción A). Antes solo intentaba Cloud API → para clientes en WAHA
  // (como Impresora) el mensaje del humano quedaba guardado pero NUNCA se
  // enviaba al cliente. Este fallback lo corrige.
  const cfg = await configPorCliente(usuario.clienteId);
  if (cfg) await enviarTexto(cfg, chatId, texto);
  else await enviarTextoWaha(chatId, texto);

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
 * El humano envía un ARCHIVO al cliente desde el inbox (imagen o documento/PDF).
 * Toma el control, lo envía por WAHA (sendImage/sendFile) y guarda el registro.
 * Recibe el archivo como base64 (data) para no depender de storage externo.
 * Límite defensivo de tamaño para no reventar el request serverless.
 */
export async function enviarArchivoComoHumano(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const filename = String(formData.get("filename") ?? "archivo");
  const mimetype = String(formData.get("mimetype") ?? "application/octet-stream");
  const data = String(formData.get("data") ?? ""); // base64 sin prefijo data:
  const caption = String(formData.get("caption") ?? "").trim();
  if (!empleadoId || !chatId || !data) return { ok: false, error: "Faltan datos" };

  // Límite ~16MB en base64 (~12MB de archivo). WhatsApp de todos modos limita.
  if (data.length > 16_000_000) return { ok: false, error: "Archivo muy grande (máx ~12MB)" };

  const supa = db();

  // Barrera de acceso.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!empleado) return { ok: false, error: "No encontrado" };

  // Tomar el control (el bot calla) y cerrar escalación pendiente.
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

  // Enviar por WAHA.
  const envio = await enviarMediaWaha(chatId, { data, mimetype, filename, caption });

  // Registrar en el historial (texto descriptivo para que se vea en el inbox).
  const esImg = mimetype.startsWith("image/");
  const etiqueta = esImg ? "📷 Imagen" : "📎 Archivo";
  await supa.from("ed_mensajes").insert({
    empleado_id: empleadoId,
    chat_id: chatId,
    rol: "humano",
    texto: caption ? `${etiqueta}: ${caption}` : `${etiqueta} enviado (${filename})`,
  });

  revalidatePath("/conversaciones");
  return envio.ok ? { ok: true } : { ok: false, error: envio.error };
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
