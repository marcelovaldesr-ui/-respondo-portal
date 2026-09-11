"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { eliminarBorrador, guardarBorrador, type EntradaBorrador } from "@/lib/marketing/campanas";
import { generarPaquete } from "@/lib/marketing/creatividades";
import { modoDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";
import type { EstadoCampana } from "@/lib/marketing/tipos";
import { capacidadesDe } from "@/lib/marketing/capacidades";

/**
 * ACCIONES DEL ASISTENTE DE CAMPAÑAS.
 *
 * El estado del borrador lo calcula `estadoDeBorrador` con lo que la
 * instalación PUEDE hacer hoy. Esas capacidades ya no se recalculan acá: salen
 * de `lib/marketing/capacidades.ts`, el mismo lugar del que las lee la pantalla.
 * Antes eran dos expresiones copiadas, y si una cambiaba sin la otra la píldora
 * que veía el dueño dejaba de coincidir con el estado que se guardaba.
 */
const DEMO_BLOQUEADO = "Estás en datos de demostración: se puede probar, pero no se guarda. Apaga la demo para crear de verdad.";

export async function guardarBorradorAccion(
  entrada: EntradaBorrador,
  id?: string,
): Promise<{ ok: true; id: string; estado: EstadoCampana } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const cap = await capacidadesDe(usuario.clienteId);
  const r = await guardarBorrador(
    usuario.clienteId,
    entrada,
    { metaConectada: cap.metaConectada, puedePublicar: cap.puedePublicarEnMeta },
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
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };
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
