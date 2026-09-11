import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { recalcularEtapasEmbudo } from "@/lib/embudo";

/**
 * ETAPAS DEL EMBUDO DESDE EL CRON (Fase 0, 11-sep-2026).
 *
 * Lo que antes pasaba al ABRIR /embudo (ver el comentario de `cargarEmbudo`).
 * Una vez por hora —en los primeros 5 minutos, igual que los avisos de cupo—
 * y con la misma ventana por defecto que la página (14 días), para no cambiar
 * de golpe conversaciones que nadie veía.
 */
export const DIAS_EMBUDO_CRON = 14;

export async function recalcularEmbudos(opts: {
  ahora?: Date;
  fechaLimite?: number;
  supa?: SupabaseClient;
  forzar?: boolean;
} = {}): Promise<{
  sinTrabajo: boolean;
  negocios: number;
  cambios: number;
  errores: { clienteId: string; error: string }[];
}> {
  const ahora = opts.ahora ?? new Date();
  const out = { sinTrabajo: false, negocios: 0, cambios: 0, errores: [] as { clienteId: string; error: string }[] };
  if (!opts.forzar && ahora.getUTCMinutes() >= 5) return { ...out, sinTrabajo: true };

  const supa = opts.supa ?? db();
  const { data: clientes, error } = await supa
    .from("ed_clientes")
    .select("id")
    .eq("activo", true)
    .order("id", { ascending: true });
  if (error) {
    out.errores.push({ clienteId: "", error: `no se pudo leer negocios: ${error.message}` });
    return out;
  }
  // Se rota el punto de partida cada hora: si el tiempo no alcanza para todos,
  // los últimos de la lista no quedan fuera siempre.
  const lista = clientes ?? [];
  const inicio = lista.length ? ahora.getUTCHours() % lista.length : 0;
  const rotada = [...lista.slice(inicio), ...lista.slice(0, inicio)];
  for (const c of rotada) {
    if (opts.fechaLimite && opts.fechaLimite - Date.now() < 6_000) break;
    try {
      const r = await recalcularEtapasEmbudo(c.id as string, DIAS_EMBUDO_CRON, supa);
      out.negocios++;
      out.cambios += r.cambios;
    } catch (e) {
      out.errores.push({ clienteId: c.id as string, error: (e as Error).message });
    }
  }
  return out;
}
