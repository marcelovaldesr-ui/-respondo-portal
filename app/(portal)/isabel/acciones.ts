"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { preguntarAIsabel, type ConsultaIsabel } from "@/lib/isabel";
import type { TurnoIsabel } from "@/lib/isabelCore";
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

  /**
   * EL HILO viene del navegador, no de la base: así funciona con o sin la
   * migración 298, y es la misma pantalla la que lo tiene en pantalla.
   *
   * Igual se sanea acá y no se confía en la forma: es texto que entra a un
   * prompt. Se recortan los turnos, el largo de cada uno, y cualquier cosa que
   * no sea un par pregunta/respuesta se descarta en silencio.
   */
  let hilo: TurnoIsabel[] = [];
  try {
    const crudo = JSON.parse(String(formData.get("hilo") ?? "[]")) as unknown;
    if (Array.isArray(crudo)) {
      hilo = crudo
        .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
        .slice(0, 3)
        .map((t) => ({
          pregunta: String(t.pregunta ?? "").slice(0, 300),
          respuesta: String(t.respuesta ?? "").slice(0, 600),
        }))
        .filter((t) => t.pregunta || t.respuesta);
    }
  } catch {
    // Sin hilo: Isabel contesta como si fuera la primera pregunta.
  }

  const r = await preguntarAIsabel(
    usuario.clienteId,
    String(formData.get("pregunta") ?? ""),
    hilo,
  );

  // Para que la próxima carga de la página muestre la pregunta en el historial.
  revalidatePath("/isabel");
  return r;
}
