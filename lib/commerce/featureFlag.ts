import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Fail closed: Commerce solo opera cuando el tenant lo tiene habilitado. */
export async function commerceActivoParaCliente(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<boolean> {
  const { data, error } = await supa
    .from("ed_clientes")
    .select("commerce_booking_v1_activo")
    .eq("id", clienteId)
    .maybeSingle();

  return !error && data?.commerce_booking_v1_activo === true;
}
