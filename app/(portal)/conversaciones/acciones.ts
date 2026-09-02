"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { MODOS, type Modo } from "@/lib/controlChat";
import { enviarComoHumano, fijarModo } from "@/lib/responderChat";

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

export async function cambiarModo(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const modo = String(formData.get("modo") ?? "") as Modo;

  if (!empleadoId || !chatId || !MODOS.includes(modo)) return;

  // El trabajo real vive en lib/responderChat.ts, compartido con la ruta de
  // API que usa la app de gestión del cliente. Acá solo va la sesión.
  await fijarModo({ clienteId: usuario.clienteId, empleadoId, chatId, modo });

  revalidatePath("/conversaciones");
  revalidatePath("/inicio");
}

/**
 * El humano del negocio responde al cliente desde el inbox (Opción B, Fase 3).
 * Pone el chat en modo humano, entrega por el transporte configurado y solo
 * después registra el mensaje y cierra la escalación.
 */
export async function responderComoHumano(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; enviado?: boolean }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!empleadoId || !chatId || !texto) return { ok: false, error: "Faltan datos" };
  if (texto.length > 4000) return { ok: false, error: "El mensaje es demasiado largo" };

  // Igual que arriba: el envío, la toma de control y el registro viven en
  // lib/responderChat.ts. El ritmo se cuenta por persona logueada.
  const r = await enviarComoHumano({
    clienteId: usuario.clienteId,
    empleadoId,
    chatId,
    texto,
    limiteClave: usuario.email,
  });
  if (!r.ok) return r;

  revalidatePath("/conversaciones");
  return { ok: true };
}

/*
 * ENVÍO DE ADJUNTOS: se mudó a app/api/whatsapp/adjunto/route.ts (21-ago-2026).
 *
 * Acá vivía `enviarArchivoComoHumano`, una server action que recibía el archivo
 * EN BASE64. Se eliminó, no se dejó "por si acaso", por tres razones:
 *
 *  1. Base64 inflaba el archivo un 33% y el tope real para la persona quedaba en
 *     8 MB sin que el mensaje de error pudiera explicar por qué.
 *  2. No permitía mostrar progreso: una foto grande parecía colgada.
 *  3. **Solo sabía enviar por WAHA.** A los clientes en Cloud API —o sea a todo
 *     cliente nuevo— les respondía "llega en una próxima etapa".
 *
 * Dejar las dos convivendo era garantizar que una se quedara atrás, que es
 * exactamente lo que pasó con la lógica de versiones duplicada.
 */

/**
 * Agrega o quita una etiqueta de una conversación (manual, por el humano).
 * Las etiquetas viven en ed_contactos.etiquetas (arreglo). Se valida que el
 * contacto sea del cliente logueado.
 */
export async function cambiarEtiqueta(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
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
