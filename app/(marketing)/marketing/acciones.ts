"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { fijarModoDemo } from "@/lib/marketing/modo";

/**
 * Enciende o apaga los datos de demostración para quien está mirando.
 * Exige sesión con permiso: la cookie es inocua, pero no tiene sentido que la
 * pueda escribir alguien que no puede entrar a Marketing.
 */
export async function cambiarModoDemo(activo: boolean): Promise<void> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return;
  await fijarModoDemo(activo);
  revalidatePath("/marketing", "layout");
}
