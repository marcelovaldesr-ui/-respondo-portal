import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarMovimientoCredito, obtenerMovimientosLedger, type MovimientoLedgerItem } from "@/lib/memberships/creditLedger";
import type { EstadoMembresia } from "@/lib/memberships/membershipsCore";

export type MembresiaFilaOperacional = {
  id: string;
  clienteId: string;
  contactoId: string;
  contactoNombre: string;
  contactoTelefono: string | null;
  contactoChatId: string | null;
  planId: string;
  planNombre: string;
  creditosTotales: number | null;
  creditosSaldo: number;
  esIlimitada: boolean;
  inicio: string;
  fin: string;
  estado: EstadoMembresia;
  proximaReserva?: {
    citaId: string;
    inicio: string;
    servicioNombre: string;
  } | null;
};

export type MembresiasKpis = {
  activas: number;
  vencenEstaSemana: number;
  sinCreditos: number;
  renovacionesPendientes: number;
};

export type DetalleMembresiaOperacional = MembresiaFilaOperacional & {
  movimientosLedger: MovimientoLedgerItem[];
  proximasReservas: {
    citaId: string;
    inicio: string;
    fin: string;
    servicioNombre: string;
    estado: string;
  }[];
  pagosRecientes: {
    id: string;
    monto: number;
    concepto: string;
    estado: string;
    creadoEn: string;
  }[];
};

/**
 * LISTA LAS MEMBRESÍAS OPERACIONALES Y SUS KPIS.
 *
 * Filtro estricto por clienteId (Tenant Isolation).
 */
export async function listarMembresiasOperacionales(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<{ membresias: MembresiaFilaOperacional[]; kpis: MembresiasKpis }> {
  // 1. Consultar membresías con planes y contactos
  const { data: filas, error } = await supa
    .from("ed_membresias")
    .select(`
      id, cliente_id, contacto_id, plan_id, inicio, fin, estado, creditos_saldo, es_ilimitada,
      ed_contactos!contacto_id (id, nombre, telefono, chat_id),
      ed_planes!plan_id (id, nombre, creditos_totales)
    `)
    .eq("cliente_id", clienteId)
    .order("actualizado_en", { ascending: false });

  if (error || !filas) {
    return {
      membresias: [],
      kpis: { activas: 0, vencenEstaSemana: 0, sinCreditos: 0, renovacionesPendientes: 0 },
    };
  }

  const ahora = Date.now();
  const en7Dias = ahora + 7 * 86_400_000;

  const membresias: MembresiaFilaOperacional[] = [];
  let activas = 0;
  let vencenEstaSemana = 0;
  let sinCreditos = 0;
  let renovacionesPendientes = 0;

  for (const f of filas) {
    const contacto = Array.isArray(f.ed_contactos) ? f.ed_contactos[0] : f.ed_contactos;
    const plan = Array.isArray(f.ed_planes) ? f.ed_planes[0] : f.ed_planes;
    const finMs = new Date(f.fin as string).getTime();

    let estado = f.estado as EstadoMembresia;
    if (finMs <= ahora && estado === "activa") {
      estado = "vencida";
    }

    if (estado === "activa") activas++;
    if (estado === "vencida") renovacionesPendientes++;
    if (estado === "activa" && finMs > ahora && finMs <= en7Dias) vencenEstaSemana++;
    if (!f.es_ilimitada && (f.creditos_saldo ?? 0) === 0) sinCreditos++;

    membresias.push({
      id: f.id as string,
      clienteId: f.cliente_id as string,
      contactoId: f.contacto_id as string,
      contactoNombre: (contacto?.nombre as string) || "Sin nombre",
      contactoTelefono: (contacto?.telefono as string) || null,
      contactoChatId: (contacto?.chat_id as string) || null,
      planId: f.plan_id as string,
      planNombre: (plan?.nombre as string) || "Plan",
      creditosTotales: plan?.creditos_totales ?? null,
      creditosSaldo: f.creditos_saldo as number,
      esIlimitada: Boolean(f.es_ilimitada),
      inicio: f.inicio as string,
      fin: f.fin as string,
      estado,
    });
  }

  // 2. Resolver próxima reserva para cada contacto si tiene citas activas
  if (membresias.length > 0) {
    const contactoIds = membresias.map((m) => m.contactoId);
    const { data: citasFuturas } = await supa
      .from("ed_citas")
      .select("id, contacto_id, chat_id, inicio, ed_servicios!servicio_id(nombre)")
      .eq("cliente_id", clienteId)
      .in("contacto_id", contactoIds)
      .in("estado", ["agendada", "confirmada", "reagendada"])
      .gte("inicio", new Date().toISOString())
      .order("inicio", { ascending: true });

    if (citasFuturas && citasFuturas.length > 0) {
      const mapaProxima = new Map<string, { citaId: string; inicio: string; servicioNombre: string }>();
      for (const c of citasFuturas) {
        const cId = c.contacto_id;
        if (cId && !mapaProxima.has(cId)) {
          const s = Array.isArray(c.ed_servicios) ? c.ed_servicios[0] : c.ed_servicios;
          mapaProxima.set(cId, {
            citaId: c.id as string,
            inicio: c.inicio as string,
            servicioNombre: (s?.nombre as string) ?? "Sesión",
          });
        }
      }

      for (const m of membresias) {
        m.proximaReserva = mapaProxima.get(m.contactoId) ?? null;
      }
    }
  }

  return {
    membresias,
    kpis: {
      activas,
      vencenEstaSemana,
      sinCreditos,
      renovacionesPendientes,
    },
  };
}

/**
 * OBTIENE EL DETALLE OPERACIONAL COMPLETO DE UNA MEMBRESÍA.
 *
 * Incluye datos de contacto, plan, historial de reservas y ledger inmutable.
 */
export async function obtenerDetalleMembresiaOperacional(
  clienteId: string,
  membresiaId: string,
  supa: SupabaseClient = db(),
): Promise<DetalleMembresiaOperacional | null> {
  const { data: f, error } = await supa
    .from("ed_membresias")
    .select(`
      id, cliente_id, contacto_id, plan_id, inicio, fin, estado, creditos_saldo, es_ilimitada,
      ed_contactos!contacto_id (id, nombre, telefono, chat_id),
      ed_planes!plan_id (id, nombre, creditos_totales)
    `)
    .eq("cliente_id", clienteId)
    .eq("id", membresiaId)
    .maybeSingle();

  if (error || !f) return null;

  const contacto = Array.isArray(f.ed_contactos) ? f.ed_contactos[0] : f.ed_contactos;
  const plan = Array.isArray(f.ed_planes) ? f.ed_planes[0] : f.ed_planes;

  // Consultar historial del ledger (fuente de la verdad matemática)
  const movimientosLedger = await obtenerMovimientosLedger(clienteId, membresiaId, supa);

  // Consultar próximas reservas del contacto
  const { data: citas } = await supa
    .from("ed_citas")
    .select("id, inicio, fin, estado, ed_servicios!servicio_id(nombre)")
    .eq("cliente_id", clienteId)
    .in("estado", ["agendada", "confirmada", "reagendada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio", { ascending: true })
    .limit(5);

  const proximasReservas = (citas ?? []).map((c) => {
    const s = Array.isArray(c.ed_servicios) ? c.ed_servicios[0] : c.ed_servicios;
    return {
      citaId: c.id as string,
      inicio: c.inicio as string,
      fin: c.fin as string,
      servicioNombre: (s?.nombre as string) ?? "Sesión",
      estado: c.estado as string,
    };
  });

  // Consultar últimos pagos del contacto
  const { data: pagos } = await supa
    .from("ed_pagos")
    .select("id, monto, concepto, estado, creado_en")
    .eq("cliente_id", clienteId)
    .eq("contacto_id", f.contacto_id)
    .order("creado_en", { ascending: false })
    .limit(5);

  const pagosRecientes = (pagos ?? []).map((p) => ({
    id: p.id as string,
    monto: p.monto as number,
    concepto: p.concepto as string,
    estado: p.estado as string,
    creadoEn: p.creado_en as string,
  }));

  return {
    id: f.id as string,
    clienteId: f.cliente_id as string,
    contactoId: f.contacto_id as string,
    contactoNombre: (contacto?.nombre as string) || "Sin nombre",
    contactoTelefono: (contacto?.telefono as string) || null,
    contactoChatId: (contacto?.chat_id as string) || null,
    planId: f.plan_id as string,
    planNombre: (plan?.nombre as string) || "Plan",
    creditosTotales: plan?.creditos_totales ?? null,
    creditosSaldo: f.creditos_saldo as number,
    esIlimitada: Boolean(f.es_ilimitada),
    inicio: f.inicio as string,
    fin: f.fin as string,
    estado: f.estado as EstadoMembresia,
    movimientosLedger,
    proximasReservas,
    pagosRecientes,
  };
}

/**
 * ACCIÓN STAFF: AJUSTE MANUAL DE CRÉDITOS.
 *
 * Exige motivo obligatorio. Emite movimiento 'ajuste_manual' en el ledger.
 * NUNCA edita el saldo directamente sin pasar por el ledger.
 */
export async function ajusteManualCreditos(
  params: {
    clienteId: string;
    membresiaId: string;
    delta: number;
    motivo: string;
    empleadoId?: string | null;
    supa?: SupabaseClient;
  },
): Promise<{ ok: boolean; nuevoSaldo?: number; error?: string }> {
  const motivoLimpio = params.motivo?.trim();
  if (!motivoLimpio) {
    return { ok: false, error: "El ajuste manual requiere un motivo obligatorio." };
  }

  if (params.delta === 0) {
    return { ok: false, error: "El ajuste debe sumar o restar al menos 1 crédito." };
  }

  const supa = params.supa ?? db();
  const key = `ajuste-${params.membresiaId}-${Date.now()}`;

  const res = await registrarMovimientoCredito({
    clienteId: params.clienteId,
    membresiaId: params.membresiaId,
    tipoMovimiento: "ajuste_manual",
    delta: params.delta,
    idempotencyKey: key,
    motivo: `Ajuste manual: ${motivoLimpio}`,
    supa,
  });

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  return { ok: true, nuevoSaldo: res.saldoResultante };
}

/**
 * ACCIÓN STAFF: RENOVAR MEMBRESÍA MANUALMENTE.
 *
 * Extiende la vigencia en base a los días del plan y acredita los créditos del plan.
 */
export async function renovarMembresiaManual(
  params: {
    clienteId: string;
    membresiaId: string;
    supa?: SupabaseClient;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supa = params.supa ?? db();

  const { data: mem, error: errMem } = await supa
    .from("ed_membresias")
    .select(`
      id, fin, estado, plan_id,
      ed_planes!plan_id (creditos_totales, vigencia_dias, nombre)
    `)
    .eq("id", params.membresiaId)
    .eq("cliente_id", params.clienteId)
    .single();

  if (errMem || !mem) {
    return { ok: false, error: "Membresía no encontrada." };
  }

  const plan = Array.isArray(mem.ed_planes) ? mem.ed_planes[0] : mem.ed_planes;
  const dias = (plan?.vigencia_dias as number) || 30;
  const creditosPlan = plan?.creditos_totales ?? null;

  const finActual = new Date(mem.fin as string).getTime();
  const nuevaFin = new Date(Math.max(Date.now(), finActual) + dias * 86_400_000);

  await supa
    .from("ed_membresias")
    .update({
      fin: nuevaFin.toISOString(),
      estado: "activa",
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", params.membresiaId);

  if (creditosPlan !== null) {
    const key = `renov-manual-${params.membresiaId}-${Date.now()}`;
    await registrarMovimientoCredito({
      clienteId: params.clienteId,
      membresiaId: params.membresiaId,
      tipoMovimiento: "renovacion",
      delta: creditosPlan,
      idempotencyKey: key,
      motivo: `Renovación manual de plan: ${plan?.nombre ?? "Plan"}`,
      supa,
    });
  }

  return { ok: true };
}
