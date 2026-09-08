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

/**
 * CÓMO LLAMA EL NEGOCIO A SU NÚMERO DE TRABAJO.
 *
 * «N° de presupuesto» en una imprenta, «N° de OT» en un taller, «N° de pedido»
 * en una tienda. Tiene que ser la MISMA palabra que el cliente ve en el
 * formulario de pago: si el mensaje dice una cosa y la pantalla otra, la
 * persona tiene que traducir justo cuando está por pagar.
 *
 * Vacío = el mensaje dice «la referencia», como antes.
 */
export async function guardarEtiquetaRef(formData: FormData): Promise<void> {
  const usuario = await exigirPermisoPortal("editar_conocimiento");

  // Una etiqueta va dentro de una frase: sin saltos de línea y corta.
  const etiqueta = String(formData.get("etiqueta") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

  await db()
    .from("ed_clientes")
    .update({ pago_ref_etiqueta: etiqueta || null })
    .eq("id", usuario.clienteId);

  revalidatePath("/informacion");
}
