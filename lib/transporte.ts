import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";

/**
 * QUÉ CANAL MANDA EN ESTE CLIENTE (columna ed_clientes.transporte).
 *
 * POR QUÉ EXISTE ESTE MÓDULO (hallazgo 18-ago-2026, antes de migrar Impresora
 * Color a la vía oficial):
 *
 * Al terminar el Embedded Signup, /api/whatsapp/onboarding pone
 * `transporte='cloud'` de inmediato. Pero la sesión de WAHA sigue vinculada y
 * su webhook sigue llegando, y NINGUNO de los dos manejadores de entrada
 * miraba esta columna. Con los dos canales vivos sobre el MISMO número:
 *
 *   1. El cliente escribe una vez.
 *   2. Llega el webhook de WAHA  → Tino responde por WAHA.
 *   3. Llega el webhook de Meta  → Tino responde otra vez por la Cloud API.
 *   4. Cada respuesta le llega al OTRO canal como un `fromMe` de id
 *      desconocido, o sea que cada canal cree que una PERSONA tomó el control
 *      y silencia a Tino.
 *
 * O sea: el cliente ve la respuesta duplicada (con textos distintos, porque
 * son dos llamadas al modelo) y encima la conversación queda en modo humano
 * sin que nadie la haya tomado. En el canal de ventas de un negocio real.
 *
 * La barrera `clienteDuenoDeWaha` de la auditoría de escala NO cubre esto:
 * resuelve por `waha_instancia`, que sigue apuntando a Impresora Color después
 * de migrar — justamente para que el rollback funcione.
 *
 * La regla es simple: cada manejador atiende solo si el cliente está en SU
 * transporte. El que no manda, se calla y ni siquiera guarda (si guardara,
 * duplicaría el mensaje del cliente en el historial y en las métricas).
 */
export type Transporte = "waha" | "cloud";

/**
 * Lee el transporte vigente del cliente. Default "waha" (es el default de la
 * columna). Defensivo: si la columna no existiera todavía, no rompe el flujo
 * — devuelve "waha", que es el comportamiento histórico.
 */
export async function transporteDe(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<Transporte> {
  const { data, error } = await supa
    .from("ed_clientes")
    .select("transporte")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) return "waha";
  const t = ((data?.transporte as string | null) ?? "waha").toLowerCase();
  return t === "cloud" ? "cloud" : "waha";
}
