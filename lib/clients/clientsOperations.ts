import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoMembresia } from "@/lib/memberships/membershipsCore";

export type ClienteOperacionalFila = {
  contactoId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  chatId: string | null;
  membresia?: {
    id: string;
    planNombre: string;
    creditosSaldo: number;
    creditosTotales: number | null;
    esIlimitada: boolean;
    estado: EstadoMembresia;
    fin: string;
  } | null;
  proximaReserva?: {
    citaId: string;
    inicio: string;
    servicioNombre: string;
  } | null;
};

export type FichaClienteOperacional = {
  contactoId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  chatId: string | null;
  membresia?: {
    id: string;
    planId: string;
    planNombre: string;
    creditosSaldo: number;
    creditosTotales: number | null;
    esIlimitada: boolean;
    estado: EstadoMembresia;
    inicio: string;
    fin: string;
  } | null;
  proximasReservas: {
    citaId: string;
    inicio: string;
    fin: string;
    servicioNombre: string;
    estado: string;
    esClase: boolean;
  }[];
  historialReciente: {
    citaId: string;
    inicio: string;
    servicioNombre: string;
    estado: string;
  }[];
  pagos: {
    pagoId: string;
    monto: number;
    concepto: string;
    estado: string;
    proveedor: string;
    creadoEn: string;
  }[];
};

/**
 * BUSCA CONTACTOS OPERACIONALMENTE POR NOMBRE, TELÉFONO O EMAIL.
 */
export async function buscarClientesOperacionales(
  clienteId: string,
  busqueda?: string,
  supa: SupabaseClient = db(),
): Promise<ClienteOperacionalFila[]> {
  let consulta = supa
    .from("ed_contactos")
    .select("id, nombre, telefono, email, chat_id")
    .eq("cliente_id", clienteId)
    .order("actualizado_en", { ascending: false })
    .limit(50);

  if (busqueda?.trim()) {
    const termino = busqueda.replace(/[,()%_]/g, " ").trim().slice(0, 80);
    if (termino) {
      consulta = consulta.or(
        `nombre.ilike.%${termino}%,telefono.ilike.%${termino}%,email.ilike.%${termino}%,chat_id.ilike.%${termino}%`,
      );
    }
  }

  const { data: contactos, error } = await consulta;
  if (error || !contactos) return [];

  const contactoIds = contactos.map((c) => c.id);

  // Obtener membresías activas de estos contactos en una sola query
  const mapaMembresias = new Map<string, ClienteOperacionalFila["membresia"]>();
  if (contactoIds.length > 0) {
    const { data: mems } = await supa
      .from("ed_membresias")
      .select(`
        id, contacto_id, creditos_saldo, es_ilimitada, estado, fin,
        ed_planes!plan_id (nombre, creditos_totales)
      `)
      .eq("cliente_id", clienteId)
      .in("contacto_id", contactoIds)
      .in("estado", ["activa", "agotada"])
      .order("fin", { ascending: false });

    if (mems) {
      for (const m of mems) {
        if (m.contacto_id && !mapaMembresias.has(m.contacto_id)) {
          const pl = Array.isArray(m.ed_planes) ? m.ed_planes[0] : m.ed_planes;
          const finMs = new Date(m.fin as string).getTime();
          const estado = finMs <= Date.now() ? "vencida" : (m.estado as EstadoMembresia);

          mapaMembresias.set(m.contacto_id, {
            id: m.id as string,
            planNombre: (pl?.nombre as string) || "Plan",
            creditosSaldo: m.creditos_saldo as number,
            creditosTotales: pl?.creditos_totales ?? null,
            esIlimitada: Boolean(m.es_ilimitada),
            estado,
            fin: m.fin as string,
          });
        }
      }
    }
  }

  return contactos.map((c) => ({
    contactoId: c.id as string,
    nombre: (c.nombre as string) || "Sin nombre",
    telefono: (c.telefono as string) || null,
    email: (c.email as string) || null,
    chatId: (c.chat_id as string) || null,
    membresia: mapaMembresias.get(c.id) ?? null,
  }));
}

/**
 * OBTIENE LA FICHA OPERACIONAL COMPLETA DE UN CLIENTE USANDO SU CONTACTO_ID.
 */
export async function obtenerFichaClienteOperacional(
  clienteId: string,
  contactoId: string,
  supa: SupabaseClient = db(),
): Promise<FichaClienteOperacional | null> {
  const { data: contacto, error: errContacto } = await supa
    .from("ed_contactos")
    .select("id, nombre, telefono, email, chat_id")
    .eq("cliente_id", clienteId)
    .eq("id", contactoId)
    .maybeSingle();

  if (errContacto || !contacto) return null;

  // 1. Membresía activa
  const { data: mem } = await supa
    .from("ed_membresias")
    .select(`
      id, plan_id, creditos_saldo, es_ilimitada, estado, inicio, fin,
      ed_planes!plan_id (nombre, creditos_totales)
    `)
    .eq("cliente_id", clienteId)
    .eq("contacto_id", contactoId)
    .in("estado", ["activa", "agotada"])
    .order("fin", { ascending: false })
    .limit(1)
    .maybeSingle();

  let membresia: FichaClienteOperacional["membresia"] = null;
  if (mem) {
    const pl = Array.isArray(mem.ed_planes) ? mem.ed_planes[0] : mem.ed_planes;
    const finMs = new Date(mem.fin as string).getTime();
    const estado = finMs <= Date.now() ? "vencida" : (mem.estado as EstadoMembresia);

    membresia = {
      id: mem.id as string,
      planId: mem.plan_id as string,
      planNombre: (pl?.nombre as string) || "Plan",
      creditosSaldo: mem.creditos_saldo as number,
      creditosTotales: pl?.creditos_totales ?? null,
      esIlimitada: Boolean(mem.es_ilimitada),
      estado,
      inicio: mem.inicio as string,
      fin: mem.fin as string,
    };
  }

  // 2. Próximas reservas
  const ahoraIso = new Date().toISOString();
  const { data: citasFuturas } = await supa
    .from("ed_citas")
    .select("id, inicio, fin, estado, clase_id, ed_servicios!servicio_id(nombre)")
    .eq("cliente_id", clienteId)
    .or(`contacto_id.eq.${contactoId}${contacto.chat_id ? `,chat_id.eq.${contacto.chat_id}` : ""}`)
    .gte("inicio", ahoraIso)
    .order("inicio", { ascending: true })
    .limit(5);

  const proximasReservas = (citasFuturas ?? []).map((c) => {
    const s = Array.isArray(c.ed_servicios) ? c.ed_servicios[0] : c.ed_servicios;
    return {
      citaId: c.id as string,
      inicio: c.inicio as string,
      fin: c.fin as string,
      servicioNombre: (s?.nombre as string) || "Sesión",
      estado: c.estado as string,
      esClase: Boolean(c.clase_id),
    };
  });

  // 3. Historial reciente de reservas
  const { data: citasPasadas } = await supa
    .from("ed_citas")
    .select("id, inicio, estado, ed_servicios!servicio_id(nombre)")
    .eq("cliente_id", clienteId)
    .or(`contacto_id.eq.${contactoId}${contacto.chat_id ? `,chat_id.eq.${contacto.chat_id}` : ""}`)
    .lt("inicio", ahoraIso)
    .order("inicio", { ascending: false })
    .limit(8);

  const historialReciente = (citasPasadas ?? []).map((c) => {
    const s = Array.isArray(c.ed_servicios) ? c.ed_servicios[0] : c.ed_servicios;
    return {
      citaId: c.id as string,
      inicio: c.inicio as string,
      servicioNombre: (s?.nombre as string) || "Sesión",
      estado: c.estado as string,
    };
  });

  // 4. Pagos
  const { data: pagosData } = await supa
    .from("ed_pagos")
    .select("id, monto, concepto, estado, proveedor, creado_en")
    .eq("cliente_id", clienteId)
    .or(`contacto_id.eq.${contactoId}${contacto.chat_id ? `,chat_id.eq.${contacto.chat_id}` : ""}`)
    .order("creado_en", { ascending: false })
    .limit(10);

  const pagos = (pagosData ?? []).map((p) => ({
    pagoId: p.id as string,
    monto: p.monto as number,
    concepto: (p.concepto as string) || "Cobro",
    estado: p.estado as string,
    proveedor: (p.proveedor as string) || "manual",
    creadoEn: p.creado_en as string,
  }));

  return {
    contactoId: contacto.id as string,
    nombre: (contacto.nombre as string) || "Sin nombre",
    telefono: (contacto.telefono as string) || null,
    email: (contacto.email as string) || null,
    chatId: (contacto.chat_id as string) || null,
    membresia,
    proximasReservas,
    historialReciente,
    pagos,
  };
}
