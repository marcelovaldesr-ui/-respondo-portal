import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarMovimientoCredito } from "@/lib/memberships/creditLedger";
import { iniciarPagoFlow, type ResultadoIniciarPagoFlow } from "@/lib/flow/flowPagos";
import type { EventoPagoConfirmado } from "@/lib/eventosComerciales";
import { registrarDominioListener } from "@/lib/eventosComerciales";

export type EstadoMembresia = "activa" | "vencida" | "cancelada" | "agotada";

export type Plan = {
  id: string;
  cliente_id: string;
  nombre: string;
  descripcion: string | null;
  precio_clp: number;
  creditos_totales: number | null; // null = ilimitado
  vigencia_dias: number;
  servicios_permitidos: string[] | null;
  activo: boolean;
};

export type Membresia = {
  id: string;
  cliente_id: string;
  contacto_id: string;
  plan_id: string;
  inicio: string;
  fin: string;
  estado: EstadoMembresia;
  creditos_saldo: number;
  es_ilimitada: boolean;
  ultimo_pago_id: string | null;
};

/**
 * CREA UN NUEVO PLAN DE MEMBRESÍA / PACK DE CRÉDITOS.
 */
export async function crearPlan(
  params: {
    clienteId: string;
    nombre: string;
    precioClp: number;
    creditosTotales?: number | null; // null para ilimitado
    vigenciaDias?: number;
    descripcion?: string | null;
    serviciosPermitidos?: string[] | null;
    supa?: SupabaseClient;
  },
): Promise<{ ok: true; planId: string } | { ok: false; error: string }> {
  const supa = params.supa ?? db();

  const { data, error } = await supa
    .from("ed_planes")
    .insert({
      cliente_id: params.clienteId,
      nombre: params.nombre.trim(),
      precio_clp: params.precioClp,
      creditos_totales: params.creditosTotales ?? null,
      vigencia_dias: params.vigenciaDias ?? 30,
      descripcion: params.descripcion ?? null,
      servicios_permitidos: params.serviciosPermitidos ?? null,
      activo: true,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Error al crear plan" };
  }

  return { ok: true, planId: data.id as string };
}

/**
 * LISTA LOS PLANES ACTIVOS DE UN TENANT.
 */
export async function obtenerPlanes(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<Plan[]> {
  const { data, error } = await supa
    .from("ed_planes")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("precio_clp", { ascending: true });

  if (error || !data) return [];
  return data as Plan[];
}

/**
 * ALTA DE MEMBRESÍA PARA UN CONTACTO CANÓNICO (Guardrail 1).
 *
 * Registra la membresía y carga los créditos iniciales en el ledger.
 */
export async function altaMembresia(
  params: {
    clienteId: string;
    contactoId: string;
    planId: string;
    pagoId?: string | null;
    inicio?: Date;
    supa?: SupabaseClient;
  },
): Promise<{ ok: true; membresiaId: string; creditosIniciales: number; fin: string } | { ok: false; error: string }> {
  const supa = params.supa ?? db();

  // 1. Obtener plan
  const { data: plan, error: errPlan } = await supa
    .from("ed_planes")
    .select("*")
    .eq("id", params.planId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();

  if (errPlan || !plan || !plan.activo) {
    return { ok: false, error: "Plan no válido o inactivo" };
  }

  const inicio = params.inicio ?? new Date();
  const fin = new Date(inicio.getTime() + (plan.vigencia_dias as number) * 86_400_000);
  const esIlimitada = plan.creditos_totales === null;
  const creditosIniciales = esIlimitada ? 0 : (plan.creditos_totales as number);

  // 2. Insertar membresía
  const { data: nuevaMem, error: errMem } = await supa
    .from("ed_membresias")
    .insert({
      cliente_id: params.clienteId,
      contacto_id: params.contactoId,
      plan_id: params.planId,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      estado: "activa",
      creditos_saldo: 0,
      es_ilimitada: esIlimitada,
      ultimo_pago_id: params.pagoId ?? null,
    })
    .select("id")
    .single();

  if (errMem || !nuevaMem) {
    return { ok: false, error: errMem?.message ?? "Error al registrar membresía" };
  }

  const membresiaId = nuevaMem.id as string;

  // 3. Registrar carga inicial en el ledger
  if (!esIlimitada) {
    const resLedger = await registrarMovimientoCredito({
      clienteId: params.clienteId,
      membresiaId,
      tipoMovimiento: "alta_plan",
      delta: creditosIniciales,
      referencia: params.pagoId ?? null,
      idempotencyKey: `alta-${membresiaId}`,
      motivo: `Alta plan: ${plan.nombre}`,
      supa,
    });

    if (!resLedger.ok) {
      return { ok: false, error: resLedger.error };
    }
  }

  return {
    ok: true,
    membresiaId,
    creditosIniciales,
    fin: fin.toISOString(),
  };
}

/**
 * OBTIENE LA MEMBRESÍA ACTIVA VIGENTE DE UN CONTACTO.
 *
 * Si la fecha de fin expiró, actualiza el estado a 'vencida' de forma transparente.
 */
export async function obtenerMembresiaActiva(
  clienteId: string,
  contactoId: string,
  supa: SupabaseClient = db(),
): Promise<Membresia | null> {
  const { data: membresia, error } = await supa
    .from("ed_membresias")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("contacto_id", contactoId)
    .in("estado", ["activa", "agotada"])
    .order("fin", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !membresia) return null;

  const finTime = new Date(membresia.fin as string).getTime();
  if (finTime <= Date.now()) {
    // Membresía vencida: actualizar estado
    await supa
      .from("ed_membresias")
      .update({ estado: "vencida", actualizado_en: new Date().toISOString() })
      .eq("id", membresia.id);
    return null;
  }

  return membresia as Membresia;
}

/**
 * INICIA UN COBRO EN FLOW PARA RENOVACIÓN O COMPRA DE PLAN.
 */
export async function iniciarRenovacionMembresiaFlow(
  params: {
    clienteId: string;
    contactoId: string;
    planId: string;
    chatId?: string | null;
    email?: string | null;
    empleadoId?: string;
    supa?: SupabaseClient;
  },
): Promise<ResultadoIniciarPagoFlow> {
  const supa = params.supa ?? db();

  const { data: plan, error } = await supa
    .from("ed_planes")
    .select("nombre, precio_clp")
    .eq("id", params.planId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();

  if (error || !plan) {
    return { ok: false, error: "Plan no encontrado" };
  }

  return iniciarPagoFlow({
    clienteId: params.clienteId,
    empleadoId: params.empleadoId ?? "sistema",
    contactoId: params.contactoId,
    chatId: params.chatId,
    monto: plan.precio_clp,
    concepto: `Renovación plan: ${plan.nombre}`,
    email: params.email,
    tipoTransaccion: "renovacion_membresia",
    metadata: {
      planId: params.planId,
      contactoId: params.contactoId,
    },
    supa,
  });
}

/**
 * DOMAIN LISTENER: RECIBE PAYMENT_CONFIRMED Y APLICA LA RENOVACIÓN.
 *
 * Si el contacto ya tiene membresía, extiende su vigencia y añade créditos vía ledger.
 * Si no tiene o está vencida, da de alta una nueva membresía.
 */
export async function procesarRenovacionMembresiaTrasPago(
  evento: EventoPagoConfirmado,
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; renovado: boolean; error?: string }> {
  const meta = evento.payload ?? {};
  const tipoTransaccion = meta.tipoTransaccion;

  if (tipoTransaccion !== "renovacion_membresia" && tipoTransaccion !== "compra_membresia") {
    return { ok: true, renovado: false };
  }

  const contactoId = (evento.contactoId ?? meta.contactoId) as string | undefined;
  const planId = meta.planId as string | undefined;

  if (!contactoId || !planId) {
    return { ok: false, renovado: false, error: "Falta contactoId o planId en payload del evento" };
  }

  const { data: plan } = await supa
    .from("ed_planes")
    .select("nombre, creditos_totales, vigencia_dias")
    .eq("id", planId)
    .eq("cliente_id", evento.clienteId)
    .maybeSingle();

  if (!plan) return { ok: false, renovado: false, error: "Plan inexistente" };

  const membresiaActual = await obtenerMembresiaActiva(evento.clienteId, contactoId, supa);

  if (membresiaActual && membresiaActual.plan_id === planId) {
    // Extender vigencia y sumar créditos
    const finActual = new Date(membresiaActual.fin).getTime();
    const nuevaFin = new Date(Math.max(Date.now(), finActual) + (plan.vigencia_dias as number) * 86_400_000);

    await supa
      .from("ed_membresias")
      .update({
        fin: nuevaFin.toISOString(),
        estado: "activa",
        ultimo_pago_id: evento.pagoId,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", membresiaActual.id);

    if (plan.creditos_totales !== null) {
      await registrarMovimientoCredito({
        clienteId: evento.clienteId,
        membresiaId: membresiaActual.id,
        tipoMovimiento: "renovacion",
        delta: plan.creditos_totales as number,
        referencia: evento.pagoId,
        idempotencyKey: `renovacion-${evento.pagoId}`,
        motivo: `Renovación por pago confirmado ${evento.pagoId}`,
        supa,
      });
    }

    return { ok: true, renovado: true };
  }

  // Alta nueva membresía
  const resAlta = await altaMembresia({
    clienteId: evento.clienteId,
    contactoId,
    planId,
    pagoId: evento.pagoId,
    supa,
  });

  return { ok: resAlta.ok, renovado: resAlta.ok };
}

// Registrar en el bus de eventos de dominio
registrarDominioListener(procesarRenovacionMembresiaTrasPago);
