"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { moverEtapa, liberarEtapa, type Etapa } from "@/lib/embudo";

/**
 * Mueve una conversación de etapa a mano.
 * El cliente_id sale de la sesión, nunca del formulario (regla de la casa).
 */
export async function cambiarEtapa(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_embudo");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const chatId = String(formData.get("chatId") ?? "");
  const etapa = String(formData.get("etapa") ?? "") as Etapa;
  if (!chatId || !etapa) return { ok: false, error: "Faltan datos" };

  const r = await moverEtapa(usuario.clienteId, chatId, etapa);
  revalidatePath("/embudo");
  revalidatePath("/conversaciones");
  return r;
}

/** Devuelve la etapa al cálculo automático del asistente. */
export async function volverAutomatico(formData: FormData): Promise<{ ok: boolean }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_embudo");
  if (!usuario) return { ok: false };
  const chatId = String(formData.get("chatId") ?? "");
  if (!chatId) return { ok: false };
  const r = await liberarEtapa(usuario.clienteId, chatId);
  revalidatePath("/embudo");
  return r;
}
