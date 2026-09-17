import { saberEnTexto, type HechoSabido } from "@/lib/isabelCore";
import { exigirId } from "@/lib/marketing/tenant";
import { obtenerPerfilMarketing } from "@/lib/marketing/perfilMarketing";
import { proyeccionContextoMarca } from "@/lib/marketing/perfilMarketingCore";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADAPTADOR CANÓNICO — RETIRO DEL «DOBLE CEREBRO»
 *
 * `ContextoMarca` era el modelo legacy que leía fichas con regex sobre nombres
 * de carpetas y generaba una verdad comercial alternativa e inconsistente con
 * el Estudio Creativo 2.0.
 *
 * Ahora delega 100% en `obtenerPerfilMarketing`, proyectando la verdad canónica
 * para garantizar que el catálogo, los precios y las prohibiciones de marca
 * sean idénticos en todos los módulos de Respondo.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ContextoMarca = {
  nombre: string;
  rubro: string;
  /** Qué vende, en una línea, cuando se pudo inferir. */
  descripcion: string;
  /** Servicios/productos nombrados en el conocimiento, con precio si lo hay. */
  ofertas: { titulo: string; detalle: string }[];
  /** Cómo se llaman las cosas en boca de los clientes. */
  saber: HechoSabido[];
  /** El mismo saber, listo para pegar en un prompt. */
  saberTexto: string;
  /** Número de WhatsApp del negocio (destino de los anuncios). */
  whatsapp: string | null;
  /** Ciudad/zona si aparece en el conocimiento. */
  zona: string | null;
  demo: boolean;
};

export async function contextoDeMarca(clienteId: string, demo = false): Promise<ContextoMarca> {
  exigirId(clienteId);
  const perfil = await obtenerPerfilMarketing(clienteId, { demo });
  return proyeccionContextoMarca(perfil, demo);
}

/** El contexto en texto plano, para los prompts. Omite lo vacío. */
export function contextoEnTexto(c: ContextoMarca): string {
  const partes = [`NEGOCIO: ${c.nombre}${c.rubro ? ` (${c.rubro})` : ""}${c.zona ? ` · ${c.zona}` : ""}`];
  if (c.descripcion) partes.push(`QUÉ HACE: ${c.descripcion}`);
  if (c.ofertas.length) {
    partes.push("LO QUE VENDE:");
    for (const o of c.ofertas) partes.push(`  · ${o.titulo}: ${o.detalle}`);
  }
  const saber = c.saberTexto || (c.saber ? saberEnTexto(c.saber) : "");
  if (saber) partes.push(saber);
  return partes.join("\n");
}
