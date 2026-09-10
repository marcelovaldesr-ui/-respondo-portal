"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { conexionDe } from "@/lib/ads/meta";
import { eliminarBorrador, guardarBorrador, type EntradaBorrador } from "@/lib/marketing/campanas";
import { generarPaquete } from "@/lib/marketing/creatividades";
import { modoDemo } from "@/lib/marketing/modo";
import type { EstadoCampana } from "@/lib/marketing/tipos";

/**
 * ACCIONES DEL ASISTENTE DE CAMPAÑAS.
 *
 * El estado del borrador lo calcula `estadoDeBorrador` con lo que la
 * instalación PUEDE hacer hoy: Meta conectada o no, permiso de publicar o
 * no. `puedePublicar` es false a secas: publicar por API exige
 * `ads_management` y una revisión de app que no se pidió. Cuando exista, se
 * cambia acá y el resto del producto ya sabe qué hacer.
 */
const DEMO_BLOQUEADO = "Estás en datos de demostración: se puede probar, pero no se guarda. Apaga la demo para crear de verdad.";
const PUEDE_PUBLICAR = false;

export async function guardarBorradorAccion(
  entrada: EntradaBorrador,
  id?: string,
): Promise<{ ok: true; id: string; estado: EstadoCampana } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const conexion = await conexionDe(usuario.clienteId);
  const r = await guardarBorrador(
    usuario.clienteId,
    entrada,
    { metaConectada: Boolean(conexion && conexion.cuentaId && conexion.estado === "conectada"), puedePublicar: PUEDE_PUBLICAR },
    id,
  );
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function eliminarBorradorAccion(id: string): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await eliminarBorrador(usuario.clienteId, id);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo eliminar." };
}

/**
 * Escribe dos copies para la campaña con el mismo motor del estudio
 * creativo: mismo contexto del negocio, mismas reglas de Meta.
 */
export async function sugerirCopiesAccion(entrada: {
  objetivo: string;
  oferta: string;
  producto: string;
}): Promise<{ ok: true; copies: { titular: string; texto: string; cta: string }[] } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const r = await generarPaquete(
    usuario.clienteId,
    { objetivo: entrada.objetivo, producto: entrada.producto, oferta: entrada.oferta, plataforma: "ambas", formato: "1:1" },
    demo,
  );
  if (!r.ok) return r;
  const p = r.paquete;
  return {
    ok: true,
    copies: [{ titular: p.titular, texto: p.texto, cta: p.cta }, ...p.variantes.slice(0, 1).map((v) => ({ titular: v.titular, texto: v.texto, cta: v.cta }))],
  };
}
