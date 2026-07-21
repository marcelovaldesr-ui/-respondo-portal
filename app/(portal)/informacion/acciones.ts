"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { PLANTILLAS } from "@/lib/plantillasRubro";

/**
 * PRIMER CAMINO DE ESCRITURA DEL PORTAL.
 *
 * Regla de seguridad: el cliente_id NUNCA viene del formulario — se resuelve
 * siempre desde la sesión. Y toda modificación filtra por cliente_id, así una
 * petición manipulada no puede tocar fichas de otro negocio.
 */

async function clienteActual(): Promise<string> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) throw new Error("Sesión no válida");
  return usuario.clienteId;
}

function texto(f: FormData, campo: string): string {
  return String(f.get(campo) ?? "").trim();
}

export async function crearFicha(formData: FormData) {
  const clienteId = await clienteActual();
  const categoria = texto(formData, "categoria") || "general";
  const titulo = texto(formData, "titulo");
  const contenido = texto(formData, "contenido");
  if (!titulo || !contenido) return;

  await db().from("ed_conocimiento").insert({
    cliente_id: clienteId,
    categoria,
    titulo,
    contenido,
    vigente: true,
  });
  revalidatePath("/informacion");
}

export async function actualizarFicha(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  const titulo = texto(formData, "titulo");
  const contenido = texto(formData, "contenido");
  if (!id || !titulo || !contenido) return;

  await db()
    .from("ed_conocimiento")
    .update({ titulo, contenido, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .eq("cliente_id", clienteId); // barrera de acceso
  revalidatePath("/informacion");
}

export async function alternarVigencia(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  const vigente = texto(formData, "vigente") === "true";
  if (!id) return;

  await db()
    .from("ed_conocimiento")
    .update({ vigente: !vigente })
    .eq("id", id)
    .eq("cliente_id", clienteId);
  revalidatePath("/informacion");
}

export async function eliminarFicha(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;

  await db().from("ed_conocimiento").delete().eq("id", id).eq("cliente_id", clienteId);
  revalidatePath("/informacion");
}

/** Carga las fichas de ejemplo de un rubro (para preparar demos). */
export async function cargarPlantilla(formData: FormData) {
  const clienteId = await clienteActual();
  const rubro = texto(formData, "rubro");
  const plantilla = PLANTILLAS[rubro];
  if (!plantilla) return;

  await db()
    .from("ed_conocimiento")
    .insert(
      plantilla.fichas.map((f) => ({
        cliente_id: clienteId,
        categoria: f.categoria,
        titulo: f.titulo,
        contenido: f.contenido,
        vigente: true,
      })),
    );
  revalidatePath("/informacion");
}
