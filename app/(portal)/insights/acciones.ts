"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { generarInsight } from "@/lib/insights";
import { limitarDistribuido } from "@/lib/seguridad";

/**
 * Genera el informe de la semana bajo demanda.
 *
 * El cliente_id sale SIEMPRE de la sesión, nunca del formulario (misma regla
 * que el resto de las acciones del portal).
 *
 * Tope de uso: generar cuesta una llamada larga al modelo. Sin límite, alguien
 * apretando el botón en bucle dispararía el gasto.
 */
export async function generarInformeAhora(
  formData: FormData,
): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  if (!(await limitarDistribuido(`insight:${usuario.clienteId}`, 4, 600)).ok) {
    return {
      ok: false,
      motivo: "Ya generaste varios informes seguidos. Espera unos minutos.",
    };
  }

  const semanasAtras = Number(formData.get("semanasAtras") ?? 0);
  const r = await generarInsight(usuario.clienteId, {
    semanasAtras: Number.isFinite(semanasAtras) ? Math.min(Math.max(semanasAtras, 0), 8) : 0,
  });

  revalidatePath("/insights");
  return { ok: r.ok, motivo: r.motivo };
}
