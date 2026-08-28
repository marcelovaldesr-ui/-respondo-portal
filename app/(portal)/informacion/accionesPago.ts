"use server";

import { revalidatePath } from "next/cache";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GUARDAR EL ENLACE DE PAGO DEL NEGOCIO.
 *
 * Es la ÚNICA configuración que necesita el cobro en conversación: el link de
 * Mercado Pago / Flow / Getnet que el negocio ya tiene. Se guarda una vez y el
 * botón «Cobrar» de la bandeja queda operativo.
 *
 * Validación mínima acá (https o vacío para apagar); la validación fuerte corre
 * en cada cobro (`validarCobro`), así que un enlace roto guardado por error no
 * puede llegar a un cliente final igual.
 */
export async function guardarLinkPago(formData: FormData): Promise<void> {
  const usuario = await exigirPermisoPortal("editar_conocimiento");

  const link = String(formData.get("link") ?? "").trim();

  // Vacío = apagar la función. Válido y deliberado.
  if (link !== "") {
    try {
      const u = new URL(link);
      if (u.protocol !== "https:") return;
    } catch {
      return;
    }
  }

  await db()
    .from("ed_clientes")
    .update({ pago_link_base: link || null })
    .eq("id", usuario.clienteId);

  revalidatePath("/informacion");
}
