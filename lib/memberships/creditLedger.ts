import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoMovimientoCredito =
  | "alta_plan"
  | "renovacion"
  | "consumo_reserva"
  | "devolucion_cancelacion"
  | "ajuste_manual";

export type MovimientoLedgerParams = {
  clienteId: string;
  membresiaId: string;
  tipoMovimiento: TipoMovimientoCredito;
  delta: number;
  referencia?: string | null;
  idempotencyKey: string;
  motivo?: string | null;
  supa?: SupabaseClient;
};

export type ResultadoMovimientoLedger =
  | { ok: true; saldoResultante: number; yaRegistrado?: boolean }
  | { ok: false; error: string };

/**
 * REGISTRA UN MOVIMIENTO INMUTABLE EN EL LEDGER DE CRÉDITOS.
 *
 * Fuente única de verdad matemática.
 * Actualiza el saldo cacheado en `ed_membresias` de forma coherente.
 * Garantiza idempotencia mediante `uq_ed_creditos_ledger_idempotency`.
 */
export async function registrarMovimientoCredito(
  p: MovimientoLedgerParams,
): Promise<ResultadoMovimientoLedger> {
  const supa = p.supa ?? db();

  // 1. Obtener la membresía
  const { data: membresia, error: errMem } = await supa
    .from("ed_membresias")
    .select("id, cliente_id, creditos_saldo, es_ilimitada, estado")
    .eq("id", p.membresiaId)
    .eq("cliente_id", p.clienteId)
    .maybeSingle();

  if (errMem || !membresia) {
    return { ok: false, error: "Membresía no encontrada en este negocio" };
  }

  // Planes ilimitados no descuentan saldo
  if (membresia.es_ilimitada && p.tipoMovimiento === "consumo_reserva") {
    return { ok: true, saldoResultante: membresia.creditos_saldo };
  }

  const saldoActual = membresia.creditos_saldo ?? 0;
  const nuevoSaldo = saldoActual + p.delta;

  if (nuevoSaldo < 0) {
    return { ok: false, error: "Saldo de créditos insuficiente" };
  }

  // 2. Insertar movimiento en ledger
  const { error: errInsert } = await supa.from("ed_creditos_ledger").insert({
    cliente_id: p.clienteId,
    membresia_id: p.membresiaId,
    tipo_movimiento: p.tipoMovimiento,
    delta: p.delta,
    saldo_resultante: nuevoSaldo,
    referencia: p.referencia ?? null,
    idempotency_key: p.idempotencyKey,
    motivo: p.motivo ?? null,
  });

  if (errInsert) {
    // Si ya existe (23505), recuperamos el saldo ya registrado (idempotencia pura)
    if (errInsert.code === "23505") {
      const { data: existente } = await supa
        .from("ed_creditos_ledger")
        .select("saldo_resultante")
        .eq("cliente_id", p.clienteId)
        .eq("idempotency_key", p.idempotencyKey)
        .maybeSingle();

      return {
        ok: true,
        saldoResultante: existente?.saldo_resultante ?? saldoActual,
        yaRegistrado: true,
      };
    }

    return { ok: false, error: errInsert.message };
  }

  // 3. Sincronizar saldo cacheado y estado en ed_membresias
  const nuevoEstado = nuevoSaldo === 0 && !membresia.es_ilimitada ? "agotada" : "activa";
  await supa
    .from("ed_membresias")
    .update({
      creditos_saldo: nuevoSaldo,
      estado: nuevoEstado,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", p.membresiaId);

  return { ok: true, saldoResultante: nuevoSaldo };
}

/**
 * RECONSTRUYE Y VERIFICA EL SALDO MATEMÁTICO DIRECTO DESDE EL LEDGER.
 *
 * Suma todos los deltas históricos registrados para la membresía.
 */
export async function reconstruirSaldoDesdeLedger(
  clienteId: string,
  membresiaId: string,
  supa: SupabaseClient = db(),
): Promise<{ saldoCalculado: number; totalMovimientos: number; saldoCacheado: number; consistente: boolean }> {
  const { data: membresia } = await supa
    .from("ed_membresias")
    .select("creditos_saldo")
    .eq("id", membresiaId)
    .eq("cliente_id", clienteId)
    .single();

  const { data: movimientos } = await supa
    .from("ed_creditos_ledger")
    .select("delta")
    .eq("cliente_id", clienteId)
    .eq("membresia_id", membresiaId);

  const totalMovimientos = movimientos?.length ?? 0;
  const saldoCalculado = (movimientos ?? []).reduce((acc, m) => acc + (m.delta as number), 0);
  const saldoCacheado = membresia?.creditos_saldo ?? 0;

  return {
    saldoCalculado,
    totalMovimientos,
    saldoCacheado,
    consistente: saldoCalculado === saldoCacheado,
  };
}
