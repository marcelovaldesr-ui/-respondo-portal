import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";

/**
 * Estados de una conversación (columna ed_chat_estado.modo):
 *  - "bot":     Tino puede responder (AI_ACTIVE).
 *  - "humano":  una persona tomó el control; Tino guarda contexto pero NO responde.
 *  - "pausado": Tino detenido a mano; tampoco responde.
 *
 * Regla de convivencia: Tino NUNCA reanuda solo por tiempo. Volver a "bot" es una
 * acción explícita (persona en el portal, o comando de reanudación), nunca
 * automática mientras una persona atiende. Ver docs/CONVIVENCIA_TINO.md.
 */
export type ModoChat = "bot" | "humano" | "pausado";

/** Lee el modo actual del chat. Default "bot" si no existe fila. */
export async function modoDe(
  empleadoId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<ModoChat> {
  const { data } = await supa
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();
  return ((data?.modo as ModoChat) ?? "bot") as ModoChat;
}

/**
 * Fija el modo del chat (upsert). Actualiza actualizado_en.
 * Se usa en la toma de control humana (→ "humano"), al pausar/reanudar desde el
 * portal, y en la escalación.
 */
export async function setModo(
  empleadoId: string,
  chatId: string,
  modo: ModoChat,
  supa: SupabaseClient = db(),
): Promise<void> {
  await supa.from("ed_chat_estado").upsert(
    {
      empleado_id: empleadoId,
      chat_id: chatId,
      modo,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "empleado_id,chat_id" },
  );
}

/**
 * Marca que el cliente acaba de escribir (ventana de 24h) SIN pisar el modo.
 * Si no existe la fila, la crea en modo "bot".
 */
export async function tocarVentanaEntrante(
  empleadoId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<void> {
  const ahora = new Date().toISOString();
  const { data } = await supa
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (data) {
    await supa
      .from("ed_chat_estado")
      .update({ ultimo_entrante_en: ahora })
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId);
  } else {
    await supa.from("ed_chat_estado").insert({
      empleado_id: empleadoId,
      chat_id: chatId,
      modo: "bot",
      ultimo_entrante_en: ahora,
    });
  }
}
