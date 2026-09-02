import type { SupabaseClient } from "@supabase/supabase-js";
import { etiquetasTrasAtencion } from "@/lib/etiquetasCiclo";

/**
 * CERRAR LA DERIVACIÓN CUANDO UNA PERSONA ATIENDE — desde cualquier canal.
 *
 * EL AGUJERO (2-sep-2026)
 * -----------------------
 * "Te espera" (el contador coral del menú, el estado «espera» de la bandeja)
 * se cerraba solo si la persona respondía DESDE EL PORTAL (responderChat) o
 * mandaba una plantilla. Cecilia responde desde el WhatsApp del teléfono: ese
 * camino (`toma_humana` en inboundMeta/inboundWaha/inboundInstagram) pasaba el
 * chat a modo humano pero dejaba la escalación abierta. Resultado medido en
 * Impresora Color: 234 de 246 derivaciones "sin atender", casi todas ya
 * atendidas hace días. El contador decía "te esperan 234" y era mentira.
 *
 * Esta función es el ÚNICO lugar que cierra escalaciones. Todos los caminos
 * por los que una persona le escribe al cliente la llaman:
 *   - responderChat (texto desde el portal, y devolver a Tino)
 *   - adjuntoChat (foto/PDF desde el portal)
 *   - api/whatsapp/plantilla (plantilla fuera de la ventana)
 *   - inbound*: eco de un mensaje escrito desde el teléfono (toma humana)
 *   - reconciliarEstados (barrido en el cron, para el arrastre histórico)
 *
 * Además retira la etiqueta "necesita_atencion" del contacto: es literalmente
 * la etiqueta de la escalación pendiente, y sin esto quedaba puesta para
 * siempre (ver etiquetasCiclo.ts).
 *
 * Best-effort e idempotente: llamarla dos veces no hace nada la segunda.
 */
export async function cerrarEscalacionesPendientes(
  supa: SupabaseClient,
  p: {
    /** Todos los empleados del cliente, o solo uno: da igual, es por chat. */
    empleadoIds: string[];
    chatId: string;
    /** Si se conoce, se limpia la etiqueta del contacto. */
    clienteId?: string | null;
    /** Cuándo se atendió. Por defecto ahora; el barrido pasa la fecha real. */
    atendidaEn?: string;
  },
): Promise<{ cerradas: number }> {
  if (!p.empleadoIds.length) return { cerradas: 0 };

  const { data, error } = await supa
    .from("ed_escalaciones")
    .update({ atendida_en: p.atendidaEn ?? new Date().toISOString() })
    .in("empleado_id", p.empleadoIds)
    .eq("chat_id", p.chatId)
    .is("atendida_en", null)
    .select("id");
  if (error) {
    console.warn("[escalaciones] no se pudo cerrar:", error.message);
    return { cerradas: 0 };
  }
  const cerradas = data?.length ?? 0;
  if (!cerradas || !p.clienteId) return { cerradas };

  // La etiqueta se limpia solo si de verdad se cerró algo: si no había
  // escalación abierta, no hay nada que "atender" y no se toca el contacto.
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("etiquetas")
    .eq("cliente_id", p.clienteId)
    .eq("chat_id", p.chatId)
    .maybeSingle();
  const actuales = (contacto?.etiquetas as string[] | null) ?? [];
  const limpias = etiquetasTrasAtencion(actuales);
  if (limpias !== actuales) {
    await supa
      .from("ed_contactos")
      .update({ etiquetas: limpias })
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", p.chatId);
  }
  return { cerradas };
}
