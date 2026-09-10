"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { preguntarAIsabel, type ConsultaIsabel } from "@/lib/isabel";
import { limitarDistribuido } from "@/lib/seguridad";

/**
 * Le pregunta a Isabel.
 *
 * El cliente_id sale SIEMPRE de la sesión, nunca del formulario: misma regla
 * que el resto de las acciones del portal. Si viniera del formulario, cualquiera
 * con sesión podría leer el historial de otro negocio cambiando un campo.
 *
 * Tope de uso: cada pregunta cuesta una llamada larga al modelo sobre cientos
 * de mensajes. Doce en media hora es más de lo que cualquiera pregunta de
 * verdad, y frena de sobra a alguien apretando en bucle.
 */
export async function preguntar(
  formData: FormData,
): Promise<{ ok: boolean; motivo?: string; consulta?: ConsultaIsabel }> {
  const usuario = await obtenerUsuarioConPermiso("preguntar_isabel");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  if (!(await limitarDistribuido(`isabel:${usuario.clienteId}`, 12, 1800)).ok) {
    return {
      ok: false,
      motivo: "Isabel contestó varias seguidas. Dale unos minutos y vuelve a preguntar.",
    };
  }

  const r = await preguntarAIsabel(usuario.clienteId, String(formData.get("pregunta") ?? ""));

  // Para que la próxima carga de la página muestre la pregunta en el historial.
  revalidatePath("/isabel");
  return r;
}
