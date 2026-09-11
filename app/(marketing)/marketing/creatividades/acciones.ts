"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { modoDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";
import {
  cambiarEstadoCreatividad,
  eliminarCreatividad,
  generarImagen,
  generarPaquete,
  guardarCreatividad,
  obtenerCreatividad,
  type EntradaCreatividad,
} from "@/lib/marketing/creatividades";
import type { PaqueteCreativo, PedidoCreativo } from "@/lib/marketing/creatividadesCore";
import type { Creatividad, FormatoCreatividad } from "@/lib/marketing/tipos";

/**
 * ACCIONES DEL ESTUDIO CREATIVO.
 *
 * Reglas que valen para todas:
 *   · El `cliente_id` sale de la sesión, nunca del formulario.
 *   · En DEMO se puede generar (texto e imagen de muestra) pero NO guardar:
 *     los datos de demostración no se mezclan con los del negocio. Cada
 *     acción de escritura lo dice con estas palabras en vez de fallar mudo.
 *   · Generar texto e imagen son DOS pasos separados a propósito: la imagen
 *     tarda ~5 s y puede fallar; el texto no tiene por qué esperarla.
 */

const DEMO_BLOQUEADO = "Estás en datos de demostración: se puede probar, pero no se guarda. Apaga la demo para crear de verdad.";

/** Imágenes de muestra para no gastar generación en la demo. */
const IMAGENES_DEMO: Record<FormatoCreatividad, string> = {
  "1:1": "/marketing/demo/pendon-feria.jpg",
  "4:5": "/marketing/demo/pendon-express.jpg",
  "9:16": "/marketing/demo/poleras-evento.jpg",
  "16:9": "/marketing/demo/gigantografia.jpg",
};

export async function generarTextoCreativo(
  pedido: Omit<PedidoCreativo, "contexto">,
): Promise<{ ok: true; paquete: PaqueteCreativo; demo: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };
  const r = await generarPaquete(usuario.clienteId, pedido, demo);
  return r.ok ? { ok: true, paquete: r.paquete, demo } : r;
}

export async function generarImagenCreativa(
  prompt: string,
  formato: FormatoCreatividad,
): Promise<{ ok: true; url: string; demo: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: true, url: IMAGENES_DEMO[formato] ?? IMAGENES_DEMO["1:1"], demo: true };
  const topado = await cupoDisponible(usuario.clienteId, "imagen");
  if (topado) return { ok: false, motivo: topado };
  const r = await generarImagen(usuario.clienteId, prompt.slice(0, 1200), formato);
  return r.ok ? { ok: true, url: r.url, demo: false } : r;
}

export async function guardarCreatividadAccion(
  entrada: EntradaCreatividad,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  if (!entrada.titular.trim() || !entrada.texto.trim()) return { ok: false, motivo: "Faltan el titular o el texto." };
  const r = await guardarCreatividad(usuario.clienteId, entrada, id);
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function cambiarEstadoCreatividadAccion(id: string, estado: Creatividad["estado"]): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await cambiarEstadoCreatividad(usuario.clienteId, id, estado);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo cambiar el estado." };
}

export async function duplicarCreatividadAccion(id: string): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const c = await obtenerCreatividad(usuario.clienteId, id);
  if (!c) return { ok: false, motivo: "No se encontró la creatividad." };
  const r = await guardarCreatividad(usuario.clienteId, {
    ...c,
    nombre: `${c.nombre} (copia)`.slice(0, 80),
    estado: "borrador",
    campanaId: null,
    varianteDe: c.id,
  });
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function eliminarCreatividadAccion(id: string): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await eliminarCreatividad(usuario.clienteId, id);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo eliminar." };
}
