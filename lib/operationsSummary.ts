import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaChileDe, horaChileAUtc } from "@/lib/agendaCore";

export type MetricasOperacionHoy = {
  clasesHoy: number;
  citasHoy: number;
  cuposLibresHoy: number;
  holdsPendientes: number;
  membresiasPorVencer7d: number;
};

/**
 * Obtiene las métricas operacionales del día para centros deportivos,
 * estudios de Pilates, clínicas y centros con Commerce & Booking V1.
 *
 * Si el cliente no tiene activo commerce_booking_v1_activo, retorna null.
 */
export async function obtenerOperacionHoy(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<MetricasOperacionHoy | null> {
  // 1. Verificar si el feature flag está activo
  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("commerce_booking_v1_activo")
    .eq("id", clienteId)
    .maybeSingle();

  if (!cliente?.commerce_booking_v1_activo) {
    return null;
  }

  // 2. Rango de hoy en hora de Chile
  const hoyChile = fechaChileDe(new Date());
  const inicioHoyUtc = horaChileAUtc(hoyChile.anio, hoyChile.mes, hoyChile.dia, 0, 0).toISOString();
  const finHoyUtc = new Date(horaChileAUtc(hoyChile.anio, hoyChile.mes, hoyChile.dia, 23, 59).getTime() + 59_000).toISOString();
  const ahoraIso = new Date().toISOString();
  const en7DiasIso = new Date(Date.now() + 7 * 86_400_000).toISOString();

  // 3. Consultas en paralelo
  const [clasesRes, citasRes, holdsRes, membresiasRes] = await Promise.all([
    supa
      .from("ed_clases")
      .select("id, capacidad_maxima, cupos_reservados")
      .eq("cliente_id", clienteId)
      .gte("horario_inicio", inicioHoyUtc)
      .lte("horario_inicio", finHoyUtc)
      .neq("estado", "cancelada"),
    supa
      .from("ed_citas")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .is("clase_id", null)
      .gte("inicio", inicioHoyUtc)
      .lte("inicio", finHoyUtc)
      .in("estado", ["agendada", "confirmada", "reagendada", "pendiente_pago"]),
    supa
      .from("ed_citas")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "pendiente_pago")
      .gt("hold_expira_en", ahoraIso),
    supa
      .from("ed_membresias")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "activa")
      .gte("fin", ahoraIso)
      .lte("fin", en7DiasIso),
  ]);

  const clases = clasesRes.data ?? [];
  const clasesHoy = clases.length;
  const cuposLibresHoy = clases.reduce(
    (acc, c) => acc + Math.max(0, (c.capacidad_maxima ?? 0) - (c.cupos_reservados ?? 0)),
    0,
  );
  const citasHoy = citasRes.count ?? 0;
  const holdsPendientes = holdsRes.count ?? 0;
  const membresiasPorVencer7d = membresiasRes.count ?? 0;

  return {
    clasesHoy,
    citasHoy,
    cuposLibresHoy,
    holdsPendientes,
    membresiasPorVencer7d,
  };
}
