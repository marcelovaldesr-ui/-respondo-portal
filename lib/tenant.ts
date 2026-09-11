import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AISLAMIENTO ENTRE NEGOCIOS PARA ACCIONES DE CONVERSACIÓN (auditoría 11-sep-2026).
 *
 * El portal usa la llave de servicio: RLS no protege estas consultas. Toda
 * acción que recibe `empleadoId` y `chatId` desde el navegador tiene que
 * comprobar que AMBOS pertenecen al negocio de la sesión antes de hacer nada.
 *
 * Por qué importa el empleado y no solo el contacto: los procesos que envían
 * (cron de seguimientos, cobros) resuelven el número de WhatsApp DESDE EL
 * EMPLEADO. Un `empleadoId` ajeno con un contacto propio mandaba el mensaje
 * por el WhatsApp de otro negocio (caso real de `avisarPedidoListo`).
 *
 * Una sola función para que las acciones no copien —y olviden— la regla.
 */
export async function empleadoYContactoDelCliente<T extends Record<string, unknown>>(
  supa: SupabaseClient,
  params: {
    clienteId: string;
    empleadoId: string;
    chatId: string;
    /** Columnas del contacto que la acción necesita (por defecto solo chat_id). */
    columnasContacto?: string;
  },
): Promise<{ ok: true; contacto: T } | { ok: false }> {
  const { clienteId, empleadoId, chatId } = params;
  if (!clienteId || !empleadoId || !chatId) return { ok: false };
  const [{ data: empleado, error: e1 }, { data: contacto, error: e2 }] = await Promise.all([
    supa
      .from("ed_empleados")
      .select("id")
      .eq("id", empleadoId)
      .eq("cliente_id", clienteId)
      .maybeSingle(),
    supa
      .from("ed_contactos")
      .select(params.columnasContacto ?? "chat_id")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);
  // PostgREST no lanza: un error se trata igual que "no es tuyo" (falla cerrado).
  if (e1 || e2 || !empleado || !contacto) return { ok: false };
  return { ok: true, contacto: contacto as unknown as T };
}
