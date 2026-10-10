import type { SupabaseClient } from "@supabase/supabase-js";
import { asegurarContacto } from "@/lib/contactoEntrante";

/**
 * BAJA NATIVA (cuentas de solo mensajería).
 *
 * Quien responde BAJA, STOP, «no más», «cancelar» o similar a un aviso de
 * marketing deja de recibir avisos. Se marca el contacto con la etiqueta
 * `no_contactar` (la misma que ya respetan los generadores y la API de envío).
 *
 * Solo se evalúan mensajes CORTOS que sean *únicamente* la orden: «baja» sí;
 * «quiero dar de baja mi tarjeta rota y pedir otra» no. Un falso positivo
 * silencia a una persona que quería seguir recibiendo; un falso negativo se
 * arregla a mano desde la bandeja. Se prefiere lo segundo.
 *
 * Esto vale SOLO para cuentas de solo mensajería: en un negocio con asistente,
 * «cancelar» suele ser «cancelar mi hora», no «no me escriban más».
 */

export const ETIQUETA_BAJA = "no_contactar";

export const CONFIRMACION_BAJA =
  "Listo, no recibirás más avisos. Si quieres volver a recibirlos, escríbenos por acá.";

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ORDENES = new Set([
  "baja", "stop", "alto", "basta", "cancelar", "cancela", "cancelar suscripcion",
  "darme de baja", "dar de baja", "dame de baja", "quiero la baja", "quiero darme de baja",
  "no mas", "no mas mensajes", "no mas avisos", "no quiero mas mensajes", "no quiero mas avisos",
  "no quiero recibir mas mensajes", "no quiero recibir mas avisos", "no quiero recibir mas",
  "desuscribir", "desuscribirme", "desuscribirse", "unsubscribe", "salir", "parar",
  "no me escriban mas", "no me escriban", "dejen de escribirme", "deja de escribirme",
]);

export function esMensajeDeBaja(texto: string | null | undefined): boolean {
  if (!texto || texto.length > 60) return false;
  return ORDENES.has(normalizar(texto));
}

/** Marca el contacto como «no contactar». Devuelve true si era la primera vez. */
export async function registrarBaja(
  supa: SupabaseClient,
  p: { clienteId: string; chatId: string; nombre?: string | null },
): Promise<boolean> {
  const c = await asegurarContacto(supa, {
    clienteId: p.clienteId, chatId: p.chatId, nombre: p.nombre ?? null,
  });
  const etiquetas = ((c?.etiquetas as string[] | null) ?? []).slice();
  if (etiquetas.includes(ETIQUETA_BAJA)) return false;
  etiquetas.push(ETIQUETA_BAJA);
  await supa.from("ed_contactos").update({ etiquetas })
    .eq("cliente_id", p.clienteId).eq("chat_id", p.chatId);
  return true;
}
