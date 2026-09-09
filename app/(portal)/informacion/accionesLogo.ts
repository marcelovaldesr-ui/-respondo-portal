"use server";

import { revalidatePath } from "next/cache";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * EL LOGO DEL NEGOCIO EN SU PROPIO PORTAL (9-sep-2026).
 *
 * El portal se lo entregamos a cada cliente como SU herramienta, pero se veía
 * igual para todos. Su logo arriba cambia de qué se trata la pantalla: deja de
 * ser «el software que contraté» y pasa a ser «mi negocio».
 *
 * Bucket `logos` (migración 296), público a propósito: un logo es la marca que
 * el negocio ya publica en su vitrina. Ver el razonamiento completo en el SQL.
 */

/** Lo que un navegador y Supabase saben mostrar sin sorpresas. */
const TIPOS = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const MAX_BYTES = 2 * 1024 * 1024;

export async function guardarLogo(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const usuario = await exigirPermisoPortal("editar_conocimiento");
  const archivo = formData.get("logo");

  // Sin archivo: es el botón «Quitar». Se borra la referencia y el portal
  // vuelve a mostrar la inicial del nombre.
  if (!(archivo instanceof File) || archivo.size === 0) {
    if (formData.get("quitar") === "1") {
      await db().from("ed_clientes").update({ logo_url: null }).eq("id", usuario.clienteId);
      revalidatePath("/", "layout");
      return { ok: true };
    }
    return { ok: false, error: "Elige una imagen primero." };
  }

  if (!TIPOS.has(archivo.type)) {
    return { ok: false, error: "Formato no soportado. Usa PNG, JPG, WEBP o SVG." };
  }
  if (archivo.size > MAX_BYTES) {
    return { ok: false, error: "La imagen pesa más de 2 MB. Súbela más liviana." };
  }

  const supa = db();

  /**
   * Nombre con marca de tiempo, no fijo. Si se sobrescribiera siempre la misma
   * ruta, el navegador y el CDN seguirían sirviendo el logo VIEJO durante horas
   * y la persona pensaría que la subida falló. Con ruta nueva, el cambio se ve
   * al instante.
   */
  const ext = EXT[archivo.type] ?? "png";
  const ruta = `${usuario.clienteId}/${Date.now()}.${ext}`;

  const subida = await supa.storage.from("logos").upload(ruta, archivo, {
    contentType: archivo.type,
    upsert: true,
  });

  if (subida.error) {
    // Típico: la migración 296 no está aplicada y el bucket no existe.
    console.error("[logo] subida falló:", subida.error.message);
    return {
      ok: false,
      error: "No se pudo subir la imagen. Si acabas de desplegar, falta aplicar la migración 296.",
    };
  }

  const { data } = supa.storage.from("logos").getPublicUrl(ruta);
  const url = data?.publicUrl;
  if (!url) return { ok: false, error: "La imagen se subió pero no se pudo obtener su enlace." };

  const { error } = await supa
    .from("ed_clientes")
    .update({ logo_url: url })
    .eq("id", usuario.clienteId);

  if (error) {
    console.error("[logo] no se pudo guardar la URL:", error.message);
    return { ok: false, error: "La imagen se subió pero no quedó asociada al negocio." };
  }

  // "layout": el logo vive en la barra lateral, que es parte del layout y no
  // de una página. Sin esto, la persona no vería el cambio hasta recargar.
  revalidatePath("/", "layout");
  return { ok: true };
}
