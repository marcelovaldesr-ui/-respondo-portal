import { db } from "@/lib/db";
import { panoramaDemo } from "@/lib/marketing/demo";
import { resolverRango } from "@/lib/ads/periodos";
import type { AudienciaCampana, BorradorCampana, EstadoCampana } from "@/lib/marketing/tipos";
import { traducirFalla } from "@/lib/marketing/fallas";

/**
 * BORRADORES DE CAMPAÑA — lo que el asistente arma y lo que el dueño edita.
 *
 * Un borrador es todo lo que Meta te va a pedir, ya pensado: objetivo, oferta,
 * audiencia, presupuesto, creatividad, copy y destino. Hoy no se PUBLICA por
 * API (exige `ads_management` y una revisión de app que decidimos no pedir),
 * pero se puede llevar a Meta en dos minutos con «Copiar configuración» y
 * «Continuar en Meta». La arquitectura queda lista para el día en que el
 * botón exista: el estado `publicada` ya está reservado y NUNCA se escribe a
 * mano.
 */

function desdeFila(f: Record<string, unknown>): BorradorCampana {
  const aud = (f.audiencia ?? {}) as Partial<AudienciaCampana>;
  return {
    id: String(f.id),
    nombre: String(f.nombre ?? ""),
    objetivo: String(f.objetivo ?? "conversaciones"),
    oferta: String(f.oferta ?? ""),
    audiencia: {
      ubicacion: String(aud.ubicacion ?? ""),
      edadDesde: typeof aud.edadDesde === "number" ? aud.edadDesde : null,
      edadHasta: typeof aud.edadHasta === "number" ? aud.edadHasta : null,
      intereses: Array.isArray(aud.intereses) ? aud.intereses.map(String) : [],
      nota: String(aud.nota ?? ""),
    },
    presupuestoDiario: f.presupuesto_diario === null ? null : Number(f.presupuesto_diario),
    presupuestoTotal: f.presupuesto_total === null ? null : Number(f.presupuesto_total),
    moneda: String(f.moneda ?? "CLP"),
    destino: "whatsapp",
    creatividadIds: Array.isArray(f.creatividad_ids) ? (f.creatividad_ids as string[]) : [],
    copies: Array.isArray(f.copies)
      ? (f.copies as { titular?: string; texto?: string; cta?: string }[]).map((c) => ({
          titular: String(c.titular ?? ""),
          texto: String(c.texto ?? ""),
          cta: String(c.cta ?? ""),
        }))
      : [],
    estado: (f.estado as EstadoCampana) ?? "borrador",
    notas: String(f.notas ?? ""),
    creadoEn: String(f.creado_en ?? ""),
    actualizadoEn: String(f.actualizado_en ?? ""),
  };
}

export async function listarBorradores(
  clienteId: string,
  demo = false,
): Promise<{ disponible: boolean; items: BorradorCampana[] }> {
  if (demo) return { disponible: true, items: panoramaDemo(resolverRango("30d")).borradores };
  const { data, error } = await db()
    .from("ed_mk_campanas")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("actualizado_en", { ascending: false })
    .limit(100);
  if (error) return { disponible: false, items: [] };
  return { disponible: true, items: (data ?? []).map((f) => desdeFila(f as Record<string, unknown>)) };
}

export async function obtenerBorrador(
  clienteId: string,
  id: string,
  demo = false,
): Promise<BorradorCampana | null> {
  if (demo) return panoramaDemo(resolverRango("30d")).borradores.find((b) => b.id === id) ?? null;
  const { data, error } = await db()
    .from("ed_mk_campanas")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return desdeFila(data as Record<string, unknown>);
}

export type EntradaBorrador = Omit<BorradorCampana, "id" | "creadoEn" | "actualizadoEn" | "estado"> & {
  estado?: EstadoCampana;
};

/**
 * Qué estado le corresponde a un borrador según lo que tiene y lo que la
 * instalación puede hacer. Es una función y no un campo editable: el estado
 * describe la realidad, no una intención.
 *
 *   borrador         → le falta algo esencial (oferta, copy o creatividad).
 *   lista            → tiene todo; se puede llevar a Meta a mano.
 *   requiere_meta    → tiene todo pero el negocio no conectó la cuenta.
 *   requiere_permiso → tiene todo y Meta está, pero no hay permiso para publicar por API.
 */
export function estadoDeBorrador(
  b: Pick<EntradaBorrador, "oferta" | "copies" | "creatividadIds" | "presupuestoDiario">,
  capacidades: { metaConectada: boolean; puedePublicar: boolean },
): EstadoCampana {
  const completo =
    Boolean(b.oferta.trim()) &&
    b.copies.some((c) => c.titular && c.texto) &&
    b.creatividadIds.length > 0 &&
    (b.presupuestoDiario ?? 0) > 0;
  if (!completo) return "borrador";
  if (!capacidades.metaConectada) return "requiere_meta";
  if (!capacidades.puedePublicar) return "requiere_permiso";
  return "lista";
}

export async function guardarBorrador(
  clienteId: string,
  entrada: EntradaBorrador,
  capacidades: { metaConectada: boolean; puedePublicar: boolean },
  id?: string,
): Promise<{ ok: true; id: string; estado: EstadoCampana } | { ok: false; motivo: string }> {
  // `publicada` no se guarda desde acá bajo ninguna circunstancia.
  const estado = estadoDeBorrador(entrada, capacidades);
  const fila = {
    cliente_id: clienteId,
    nombre: entrada.nombre.slice(0, 100) || "Campaña sin nombre",
    objetivo: entrada.objetivo,
    oferta: entrada.oferta.slice(0, 500),
    audiencia: entrada.audiencia,
    presupuesto_diario: entrada.presupuestoDiario,
    presupuesto_total: entrada.presupuestoTotal,
    moneda: entrada.moneda || "CLP",
    destino: "whatsapp",
    creatividad_ids: entrada.creatividadIds,
    copies: entrada.copies.slice(0, 6),
    estado,
    notas: entrada.notas.slice(0, 1000),
    actualizado_en: new Date().toISOString(),
  };
  const supa = db();
  if (id) {
    // `.select("id")`: sin esto, actualizar un borrador que ya no existe
    // respondía «Guardado» y no escribía nada. Ver `creatividades.ts`.
    const { data, error } = await supa
      .from("ed_mk_campanas")
      .update(fila)
      .eq("id", id)
      .eq("cliente_id", clienteId)
      .select("id")
      .maybeSingle();
    if (error)
      return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "guardarBorrador", clienteId, crudo: error.message }) };
    if (!data) return { ok: false, motivo: "Ese borrador ya no existe. Puede que se haya eliminado desde otra pestaña." };
    return { ok: true, id, estado };
  }
  const { data, error } = await supa.from("ed_mk_campanas").insert(fila).select("id").maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      motivo: traducirFalla({ proveedor: "almacen", operacion: "crearBorrador", clienteId, crudo: error?.message ?? "sin fila" }),
    };
  }
  return { ok: true, id: String(data.id), estado };
}

export async function eliminarBorrador(clienteId: string, id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("ed_mk_campanas")
    .delete()
    .eq("id", id)
    .eq("cliente_id", clienteId)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

export { borradorEnTexto } from "@/lib/marketing/campanasCore";
