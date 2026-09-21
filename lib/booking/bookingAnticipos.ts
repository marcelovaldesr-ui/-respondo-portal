import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { iniciarPagoFlow, type ResultadoIniciarPagoFlow } from "@/lib/flow/flowPagos";
import type { EventoPagoConfirmado } from "@/lib/eventosComerciales";
import { registrarDominioListener } from "@/lib/eventosComerciales";

export const TTL_HOLD_ANTICIPO_MINUTOS = 15;
const EXCLUSION_VIOLATION = "23P01";
const BLOQUEO_VIOLATION = "ED001";

export type CrearHoldParams = {
  clienteId: string;
  servicioId: string;
  profesionalId: string;
  inicioIso: string;
  nombreContacto: string;
  chatId?: string | null;
  telefono?: string | null;
  email?: string | null;
  origen?: "whatsapp" | "web" | "portal";
  empleadoId?: string | null;
  notas?: string | null;
  supa?: SupabaseClient;
};

export type ResultadoCrearHold =
  | {
      ok: true;
      citaId: string;
      pagoId: string;
      checkoutUrl: string;
      flowOrder: number;
      montoAnticipo: number;
      holdExpiraEn: string;
    }
  | {
      ok: false;
      motivo:
        | "feature_flag_desactivado"
        | "servicio_invalido"
        | "no_requiere_anticipo"
        | "profesional_invalido"
        | "cupo_tomado"
        | "error_flow"
        | "error";
      detalle?: string;
    };

/**
 * INICIA UNA RESERVA CON HOLD DE 15 MINUTOS Y PAGO DE ANTICIPO.
 *
 * Flujo:
 *  1. Verifica feature flag `commerce_booking_v1_activo` en el tenant.
 *  2. Verifica servicio y requerimiento de anticipo fijo.
 *  3. Limpia holds expirados en el slot para evitar falsos positivos.
 *  4. Inserta cita en `ed_citas` con estado 'pendiente_pago' y TTL 15 min.
 *  5. Crea orden de cobro en Flow (monto anticipo fijo).
 *  6. Asocia `pago_id` a la cita y devuelve checkout URL.
 */
export async function crearHoldReserva(
  params: CrearHoldParams,
): Promise<ResultadoCrearHold> {
  const supa = params.supa ?? db();

  // 1. Feature Flag por tenant
  const { data: cliente, error: errCliente } = await supa
    .from("ed_clientes")
    .select("commerce_booking_v1_activo")
    .eq("id", params.clienteId)
    .maybeSingle();

  if (errCliente || !cliente?.commerce_booking_v1_activo) {
    return {
      ok: false,
      motivo: "feature_flag_desactivado",
      detalle: "Commerce & Booking V1 no está activo para este negocio.",
    };
  }

  // 2. Verificar servicio y configuración de anticipo
  const { data: servicio, error: errSvc } = await supa
    .from("ed_servicios")
    .select("id, nombre, duracion_min, requiere_anticipo, anticipo_monto_fijo, activo")
    .eq("id", params.servicioId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();

  if (errSvc || !servicio || !servicio.activo) {
    return { ok: false, motivo: "servicio_invalido" };
  }

  if (!servicio.requiere_anticipo || !servicio.anticipo_monto_fijo || servicio.anticipo_monto_fijo <= 0) {
    return {
      ok: false,
      motivo: "no_requiere_anticipo",
      detalle: "Este servicio no tiene configurado un anticipo fijo obligatorio.",
    };
  }

  // 3. Limpiar holds vencidos en background
  await liberarHoldsExpirados(params.clienteId, supa).catch(() => {});

  const inicio = new Date(params.inicioIso);
  if (Number.isNaN(inicio.getTime())) {
    return { ok: false, motivo: "error", detalle: "Fecha de inicio inválida" };
  }
  const fin = new Date(inicio.getTime() + (servicio.duracion_min as number) * 60_000);
  const holdExpiraEn = new Date(Date.now() + TTL_HOLD_ANTICIPO_MINUTOS * 60_000).toISOString();

  // 4. Insertar cita con estado 'pendiente_pago'
  const { data: citaNueva, error: errInsert } = await supa
    .from("ed_citas")
    .insert({
      cliente_id: params.clienteId,
      servicio_id: params.servicioId,
      profesional_id: params.profesionalId,
      chat_id: params.chatId ?? null,
      nombre_contacto: params.nombreContacto,
      telefono: params.telefono ?? params.chatId ?? null,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      estado: "pendiente_pago",
      hold_expira_en: holdExpiraEn,
      anticipo_pagado: false,
      origen: params.origen ?? "whatsapp",
      empleado_id: params.empleadoId ?? null,
      notas: params.notas ?? null,
    })
    .select("id")
    .single();

  if (errInsert || !citaNueva) {
    if (errInsert?.code === EXCLUSION_VIOLATION || errInsert?.code === BLOQUEO_VIOLATION) {
      return { ok: false, motivo: "cupo_tomado" };
    }
    return { ok: false, motivo: "error", detalle: errInsert?.message };
  }

  const citaId = citaNueva.id as string;

  // 5. Iniciar orden de pago en Flow
  const resFlow: ResultadoIniciarPagoFlow = await iniciarPagoFlow({
    clienteId: params.clienteId,
    empleadoId: params.empleadoId ?? "sistema",
    chatId: params.chatId,
    monto: servicio.anticipo_monto_fijo,
    concepto: `Anticipo reserva: ${servicio.nombre}`,
    email: params.email,
    tipoTransaccion: "anticipo_cita",
    metadata: {
      reservaId: citaId,
      servicioId: params.servicioId,
    },
    timeoutSegundos: TTL_HOLD_ANTICIPO_MINUTOS * 60,
    supa,
  });

  if (!resFlow.ok) {
    // Si Flow falla, anulamos el hold para no bloquear el slot
    await supa
      .from("ed_citas")
      .update({ estado: "cancelada", notas: `Fallo creación pago Flow: ${resFlow.error}` })
      .eq("id", citaId);

    return { ok: false, motivo: "error_flow", detalle: resFlow.error };
  }

  // 6. Vincular pago_id a ed_citas
  await supa
    .from("ed_citas")
    .update({ pago_id: resFlow.pagoId })
    .eq("id", citaId);

  return {
    ok: true,
    citaId,
    pagoId: resFlow.pagoId,
    checkoutUrl: resFlow.url,
    flowOrder: resFlow.flowOrder,
    montoAnticipo: servicio.anticipo_monto_fijo,
    holdExpiraEn,
  };
}

export type ResultadoManejoPagoBooking = {
  ok: boolean;
  manejado: boolean;
  confirmado?: boolean;
  yaConfirmado?: boolean;
  requiereAtencion?: boolean;
  motivo?: string;
};

/**
 * HANDLER DE DOMINIO: RECIBE PAYMENT_CONFIRMED Y CONFIRMA LA RESERVA.
 *
 * Desacoplado de Flow: opera exclusivamente a través del evento de dominio.
 *
 * Concurrencia cubierta:
 *  - Cita activa en 'pendiente_pago' -> Pasa a 'confirmada'.
 *  - Cita ya 'confirmada' -> Idempotente sin duplicar.
 *  - Hold expirado o slot ganado por un tercero mientras pagaba:
 *    -> NO pierde el pago.
 *    -> Marca la cita con 'requiere_atencion = true' y estado 'requiere_atencion'.
 *    -> Registra `motivo_atencion` para que el staff reubique al cliente.
 */
export async function manejarPagoConfirmadoBooking(
  evento: EventoPagoConfirmado,
  supa: SupabaseClient = db(),
): Promise<ResultadoManejoPagoBooking> {
  const reservaId = evento.payload?.reservaId as string | undefined;
  if (!reservaId) {
    return { ok: true, manejado: false };
  }

  const { data: cita, error: errCita } = await supa
    .from("ed_citas")
    .select("id, cliente_id, profesional_id, inicio, fin, estado, hold_expira_en, clase_id")
    .eq("id", reservaId)
    .eq("cliente_id", evento.clienteId)
    .maybeSingle();

  if (errCita || !cita) {
    console.warn(`[bookingAnticipos] Cita ${reservaId} no encontrada para evento de pago.`);
    return { ok: false, manejado: true, motivo: "cita_no_encontrada" };
  }

  // Idempotencia: si ya estaba confirmada, no hace nada
  if (cita.estado === "confirmada") {
    return { ok: true, manejado: true, confirmado: true, yaConfirmado: true };
  }

  // Verificar si hay conflicto con otra cita activa en el mismo horario
  const { data: conflicto } = await supa
    .from("ed_citas")
    .select("id")
    .eq("cliente_id", evento.clienteId)
    .eq("profesional_id", cita.profesional_id)
    .in("estado", ["agendada", "confirmada", "reagendada"])
    .neq("id", cita.id)
    .lt("inicio", cita.fin)
    .gt("fin", cita.inicio)
    .limit(1)
    .maybeSingle();

  if (conflicto) {
    // Horario ocupado por otro tras expiración del hold: REQUIERE ATENCIÓN
    await supa
      .from("ed_citas")
      .update({
        estado: "requiere_atencion",
        requiere_atencion: true,
        motivo_atencion: "Anticipo pagado pero el cupo fue tomado tras expirar el hold.",
        anticipo_pagado: true,
        pago_id: evento.pagoId,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", cita.id);

    return {
      ok: true,
      manejado: true,
      confirmado: false,
      requiereAtencion: true,
      motivo: "cupo_ocupado_post_expiracion",
    };
  }

  // Sin conflicto: Confirmar reserva exitosamente
  const { error: errUpdate } = await supa
    .from("ed_citas")
    .update({
      estado: "confirmada",
      anticipo_pagado: true,
      pago_id: evento.pagoId,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", cita.id);

  if (errUpdate) {
    return { ok: false, manejado: true, motivo: errUpdate.message };
  }

  return { ok: true, manejado: true, confirmado: true };
}

/**
 * LIBERA HOLDS TEMPORALES EXPIRADOS (IDEMPOTENTE).
 *
 * Busca reservas en 'pendiente_pago' cuyo TTL ha expirado y las pasa a 'expirada'.
 * Puede invocarse periódicamente desde un cron o de manera perezosa antes de consultar disponibilidad.
 */
export async function liberarHoldsExpirados(
  clienteId?: string,
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; liberadas: number }> {
  try {
    const ahoraIso = new Date().toISOString();
    let query = supa
      .from("ed_citas")
      .update({
        estado: "expirada",
        actualizado_en: ahoraIso,
      })
      .eq("estado", "pendiente_pago")
      .lt("hold_expira_en", ahoraIso)
      .select("id");

    if (clienteId) {
      query = query.eq("cliente_id", clienteId);
    }

    const { data, error } = await query;
    if (error) {
      // Tolera falta de columna/migración durante transición
      return { ok: false, liberadas: 0 };
    }

    return { ok: true, liberadas: data?.length ?? 0 };
  } catch {
    return { ok: false, liberadas: 0 };
  }
}

// Registrar el handler en el bus de eventos de dominio
registrarDominioListener(manejarPagoConfirmadoBooking);
