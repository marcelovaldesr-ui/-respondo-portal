"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { preguntarAIsabel, type ConsultaIsabel } from "@/lib/isabel";
import type { TurnoIsabel } from "@/lib/isabelCore";
import { limitarDistribuido } from "@/lib/seguridad";
import { db } from "@/lib/db";

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


/**
 * CORREGIR A ISABEL.
 *
 * Es la función que la hace aprender: lo que el dueño escribe acá entra a su
 * prompt con prioridad sobre los datos y se queda para siempre. Por eso el tope
 * de largo y la validación son estrictos — una corrección mal escrita
 * contamina TODAS las respuestas siguientes, no solo una.
 *
 * Si la migración 300 no está aplicada, se devuelve el motivo en vez de fallar
 * en silencio: acá el dueño está esperando que algo quede guardado, y decirle
 * que sí sin guardarlo es la peor de las respuestas.
 */
export async function corregir(
  formData: FormData,
): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("preguntar_isabel");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  const pregunta = String(formData.get("pregunta") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const correcta = String(formData.get("correcta") ?? "").replace(/\s+/g, " ").trim().slice(0, 600);

  if (correcta.length < 5) {
    return { ok: false, motivo: "Escribe cómo era en realidad y lo guardo." };
  }

  if (!(await limitarDistribuido(`isabel-correccion:${usuario.clienteId}`, 20, 3600)).ok) {
    return { ok: false, motivo: "Muchas correcciones seguidas. Espera un rato." };
  }

  try {
    const { error } = await db().from("ed_isabel_correcciones").insert({
      cliente_id: usuario.clienteId,
      pregunta,
      respuesta_correcta: correcta,
      creado_por: usuario.email,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    return {
      ok: false,
      motivo: `No se pudo guardar (¿falta la migración 300?): ${(e as Error).message}`,
    };
  }

  revalidatePath("/isabel");
  return { ok: true };
}

/**
 * Apaga una corrección. No se borra: una corrección vieja explica por qué
 * Isabel respondía distinto hace un mes, y eso vale cuando algo se ve raro.
 */
export async function olvidarCorreccion(
  formData: FormData,
): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("preguntar_isabel");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, motivo: "Falta cuál" };

  try {
    // El filtro por cliente va SIEMPRE, aunque el id sea único: sin él, un id
    // adivinado de otro negocio se apagaría desde acá.
    const { error } = await db()
      .from("ed_isabel_correcciones")
      .update({ activa: false })
      .eq("id", id)
      .eq("cliente_id", usuario.clienteId);
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }

  revalidatePath("/isabel");
  return { ok: true };
}
