import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * EVENTOS COMERCIALES DE DOMINIO (Guardrail 3).
 *
 * Desacoplado de la publicidad y de Meta/Google Ads.
 * Un pago confirmado existe independientemente de si proviene de un anuncio.
 * Marketing/Ads o Revenue OS pueden consumir posteriormente esta tabla.
 */

export type EventoPagoConfirmado = {
  clienteId: string;
  pagoId: string;
  contactoId?: string | null;
  monto: number;
  moneda?: string; // Por defecto 'CLP'
  proveedor?: string; // 'flow', 'manual'
  proveedorOrden?: string | null;
  chatId?: string | null;
  payload?: {
    concepto?: string;
    email?: string | null;
    reservaId?: string | null;
    membresiaId?: string | null;
    tipoTransaccion?: string;
    fbclid?: string | null;
    gclid?: string | null;
    campanaId?: string | null;
    [key: string]: unknown;
  };
};

export type DominioListener = (evento: EventoPagoConfirmado, supa: SupabaseClient) => Promise<unknown>;

const listeners: DominioListener[] = [];

export function registrarDominioListener(listener: DominioListener) {
  if (!listeners.includes(listener)) {
    listeners.push(listener);
  }
}

export async function despacharEventoDominio(evento: EventoPagoConfirmado, supa: SupabaseClient) {
  for (const listener of listeners) {
    try {
      await listener(evento, supa);
    } catch (err) {
      console.error("[eventosComerciales] Error en listener de dominio:", err);
    }
  }
}

/**
 * Emite el evento de dominio PAYMENT_CONFIRMED de forma estrictamente idempotente.
 *
 * La base de datos garantiza mediante `unique (cliente_id, pago_id, tipo)` que un mismo
 * pago jamás emite dos veces el evento de confirmación.
 */
export async function emitirPagoConfirmado(
  evento: EventoPagoConfirmado,
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; emitido: boolean; error?: string }> {
  try {
    const { error } = await supa.from("ed_eventos_comerciales").insert({
      cliente_id: evento.clienteId,
      tipo: "PAYMENT_CONFIRMED",
      pago_id: evento.pagoId,
      contacto_id: evento.contactoId ?? null,
      monto: evento.monto,
      moneda: evento.moneda ?? "CLP",
      proveedor: evento.proveedor ?? "flow",
      proveedor_orden: evento.proveedorOrden ?? null,
      chat_id: evento.chatId ?? null,
      payload: evento.payload ?? {},
    });

    if (error) {
      // 23505 = unique_violation → evento ya emitido previamente (idempotencia pura)
      if (error.code === "23505") {
        // Ejecutar listeners idempotentes para garantizar consistencia
        await despacharEventoDominio(evento, supa);
        return { ok: true, emitido: false };
      }
      // 42P01 = tabla aún no migrada en BD (migración 317 pendiente)
      if (error.code === "42P01") {
        console.warn("[eventosComerciales] ed_eventos_comerciales no existe aún (migración 317 pendiente).");
        await despacharEventoDominio(evento, supa);
        return { ok: true, emitido: false };
      }
      console.error("[eventosComerciales] Error al registrar PAYMENT_CONFIRMED:", error.message);
      return { ok: false, emitido: false, error: error.message };
    }

    // Despachar a los handlers de dominio registrados (Booking, Membresías, etc.)
    await despacharEventoDominio(evento, supa);

    return { ok: true, emitido: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado";
    console.error("[eventosComerciales] Fallo inesperado al emitir evento:", msg);
    return { ok: false, emitido: false, error: msg };
  }
}
