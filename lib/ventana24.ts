import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * VENTANA DE SERVICIO DE 24 HORAS (WhatsApp Cloud API).
 *
 * Meta deja responder con texto libre solo durante las 24 horas siguientes al
 * último mensaje QUE ESCRIBIÓ EL CLIENTE. Pasado ese plazo hay que usar una
 * plantilla aprobada; un texto libre se rechaza con el error 131047.
 *
 * Dos detalles que importan y que es fácil equivocar:
 *
 *  1. La ventana es POR NÚMERO DE WHATSAPP, no por empleado digital. Si el
 *     cliente le escribió a Tino hace dos horas, Beto también puede mandarle
 *     texto libre: para Meta es la misma conversación. Por eso la consulta mira
 *     los mensajes de TODOS los empleados del cliente y no solo del que va a
 *     escribir.
 *
 *  2. Ante la duda, se responde `false`. Un falso negativo cuesta el precio de
 *     una plantilla; un falso positivo es un mensaje que no llega y un cliente
 *     que se queda esperando.
 */
export async function ventanaAbierta(params: {
  clienteId: string;
  chatId: string;
  ahora?: Date;
  supa?: SupabaseClient;
}): Promise<boolean> {
  const supa = params.supa ?? db();
  const ahora = params.ahora ?? new Date();
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();

  try {
    const { data: empleados, error: e1 } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", params.clienteId);
    if (e1) return false;
    const ids = (empleados ?? []).map((e) => e.id as string);
    if (!ids.length) return false;

    const { data, error } = await supa
      .from("ed_mensajes")
      .select("id")
      .in("empleado_id", ids)
      .eq("chat_id", params.chatId)
      .eq("rol", "cliente")
      .gte("creado_en", desde)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
