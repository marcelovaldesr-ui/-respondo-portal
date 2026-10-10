import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";

/**
 * CUENTAS DE «SOLO MENSAJERÍA» (migración 322).
 *
 * Una cuenta así (hoy: Kambak) usa el portal únicamente como tubería de
 * WhatsApp. Ningún empleado IA lee ni responde, no hay seguimientos ni
 * reactivaciones automáticas y NO se gasta un token del modelo. Solo salen
 * mensajes que el sistema del negocio pide por API o que una persona manda a
 * mano desde la bandeja.
 *
 * POR QUÉ UN ARCHIVO APARTE Y UNA SOLA FUENTE
 * -------------------------------------------
 * Antes de esto no existía un interruptor por negocio: lo único que frenaba a
 * Tino era `ed_chat_estado.modo`, que vale «bot» cuando no hay fila, o sea
 * que un contacto nuevo siempre entraba a la IA. Y hay más de diez procesos
 * del cron que recorren negocios y llaman al modelo o escriben solos. La
 * regla vive acá; cada punto la consulta con la misma función, así que apagar
 * o auditar el comportamiento es mirar quién importa este archivo.
 *
 * COMPORTAMIENTO ANTE FALLAS (decidido a propósito)
 * -------------------------------------------------
 *  · Columna inexistente (migración sin aplicar, 42703/PGRST204): nadie es
 *    «solo mensajería». Es el estado de hoy y no debe romper a los demás.
 *  · Otro error de lectura: se usa la última foto buena si existe. Si el
 *    proceso arranca en frío y la base falla, devuelve «nadie» y lo deja en el
 *    log: apagar a Tino de todos los clientes por un parpadeo de la base
 *    sería peor. (Con la base caída, además, tampoco hay respuesta posible.)
 *  · La foto se renueva cada 60 s: encender o apagar el interruptor tarda como
 *    máximo ese tiempo en notarse.
 */

const TTL_MS = 60_000;

let foto: { en: number; ids: Set<string> } | null = null;

/** Solo para pruebas. */
export function reiniciarCacheSoloMensajeria(): void {
  foto = null;
}

async function leerIds(supa: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supa
    .from("ed_clientes")
    .select("id, solo_mensajeria")
    .eq("solo_mensajeria", true);
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return new Set();
    throw new Error(error.message);
  }
  // El filtro `.eq` ya lo hizo la base; se confirma también acá en la fila para
  // que un doble de pruebas que ignore filtros no marque a todos los negocios.
  return new Set(
    (data ?? [])
      .filter((f) => (f as { solo_mensajeria?: unknown }).solo_mensajeria === true)
      .map((f) => String((f as { id: unknown }).id)),
  );
}

/** Ids de todos los negocios en modo «solo mensajería». */
export async function idsSoloMensajeria(supa?: SupabaseClient): Promise<Set<string>> {
  if (foto && Date.now() - foto.en < TTL_MS) return foto.ids;
  try {
    const ids = await leerIds(supa ?? db());
    foto = { en: Date.now(), ids };
    return ids;
  } catch (e) {
    console.error("[solo-mensajeria] no se pudo leer el interruptor:", (e as Error).message);
    return foto?.ids ?? new Set<string>();
  }
}

/** ¿Este negocio es de solo mensajería? */
export async function esSoloMensajeria(clienteId: string, supa?: SupabaseClient): Promise<boolean> {
  if (!clienteId) return false;
  return (await idsSoloMensajeria(supa)).has(clienteId);
}

/** Saca de una lista de negocios los de solo mensajería (para los pasos del cron). */
export async function sinSoloMensajeria<T extends { id?: unknown }>(
  lista: T[] | null | undefined,
  supa?: SupabaseClient,
): Promise<T[]> {
  const filas = lista ?? [];
  if (!filas.length) return filas;
  const ocultos = await idsSoloMensajeria(supa);
  if (!ocultos.size) return filas;
  return filas.filter((f) => !ocultos.has(String(f.id)));
}

/** Texto único para mostrar cuando un control está bloqueado. */
export const MENSAJE_SOLO_MENSAJERIA = "Esta cuenta es de solo mensajería.";
