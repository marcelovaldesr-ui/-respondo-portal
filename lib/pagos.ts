import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generarReferencia,
  puedeCambiar,
  type EstadoPago,
} from "@/lib/pagosCore";
import { etiquetasTrasPagoConfirmado } from "@/lib/etiquetasCiclo";

/**
 * DATOS DE LOS COBROS EN CONVERSACIÓN.
 *
 * Las reglas (validación, mensaje, estados) viven en `lib/pagosCore.ts`, que es
 * puro y está testeado. Acá solo se habla con la base.
 */

export type Pago = {
  id: string;
  chatId: string;
  referencia: string;
  monto: number;
  concepto: string;
  estado: EstadoPago;
  creadoEn: string;
  pagadoEn: string | null;
  /** Folio del negocio (presupuesto/OT/pedido). Null si no se indicó. */
  referenciaExterna: string | null;
};

/** El enlace de pago del negocio, o null si no lo ha configurado. */
export async function linkDePago(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<{ link: string | null; nombre: string; etiquetaRef: string | null }> {
  /**
   * ⚠️ `pago_ref_etiqueta` llega con la 295 y el deploy va antes que la
   * migración: si se pide la columna y no existe, PostgREST falla la consulta
   * ENTERA y el negocio se queda sin enlace de pago — o sea, sin poder cobrar.
   * Por eso se reintenta sin ella.
   */
  const pedir = (cols: string) =>
    supa.from("ed_clientes").select(cols).eq("id", clienteId).maybeSingle();

  let r = await pedir("nombre, pago_link_base, pago_ref_etiqueta");
  if (r.error) r = await pedir("nombre, pago_link_base");

  const data = r.data as Record<string, unknown> | null;
  return {
    link: (data?.pago_link_base as string | null)?.trim() || null,
    nombre: (data?.nombre as string) ?? "el negocio",
    etiquetaRef: (data?.pago_ref_etiqueta as string | null)?.trim() || null,
  };
}

/**
 * Crea el registro del cobro con una referencia única.
 *
 * La unicidad la garantiza la base (`unique (cliente_id, referencia)`), no
 * nosotros: si por mala suerte se repite la referencia, se reintenta con otra.
 * Tres intentos sobre un espacio de 31^6 (~900 millones) es de sobra.
 */
export async function crearPago(p: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  monto: number;
  concepto: string;
  creadoPor: string;
  /** Folio del negocio. Opcional: si falta, manda la referencia P-XXXXXX. */
  referenciaExterna?: string | null;
  supa?: SupabaseClient;
}): Promise<{ ok: true; id: string; referencia: string } | { ok: false; error: string }> {
  const supa = p.supa ?? db();

  /**
   * ⚠️ Si la 294 todavía no está aplicada, insertar `referencia_externa`
   * revienta y el cobro NO SALE. Un cobro que falla por una columna que falta
   * es el peor final posible: la persona ya le dijo al cliente que se lo
   * manda. Por eso se reintenta sin el folio — se pierde el número en el
   * mensaje, no la venta.
   */
  let conFolio = Boolean(p.referenciaExterna);

  for (let intento = 0; intento < 3; intento++) {
    const referencia = generarReferencia();
    const { data, error } = await supa
      .from("ed_pagos")
      .insert({
        cliente_id: p.clienteId,
        empleado_id: p.empleadoId,
        chat_id: p.chatId,
        referencia,
        monto: p.monto,
        concepto: p.concepto,
        creado_por: p.creadoPor,
        ...(conFolio ? { referencia_externa: p.referenciaExterna } : {}),
      })
      .select("id")
      .maybeSingle();

    if (!error && data) return { ok: true, id: data.id as string, referencia };

    // 42703 = columna inexistente (migración 294 pendiente): se reintenta sin
    // el folio en vez de dejar al cliente sin su cobro.
    if (conFolio && (error as { code?: string } | null)?.code === "42703") {
      conFolio = false;
      continue;
    }
    // 23505 = unique violation → referencia repetida, se prueba otra.
    if ((error as { code?: string } | null)?.code !== "23505") {
      return { ok: false, error: error?.message ?? "No se pudo registrar el cobro" };
    }
  }
  return { ok: false, error: "No se pudo generar una referencia única. Intenta de nuevo." };
}

/**
 * Cambia el estado respetando las transiciones de `pagosCore`.
 *
 * ⚠️ La condición de estado va EN el update (`eq("estado", desde)`), no en una
 * lectura previa: dos personas marcando pagado el mismo cobro a la vez no deben
 * poder pisarse. El que llega segundo simplemente no matchea ninguna fila.
 */
export async function cambiarEstadoPago(p: {
  clienteId: string;
  pagoId: string;
  desde: EstadoPago;
  hacia: EstadoPago;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string }> {
  if (!puedeCambiar(p.desde, p.hacia)) {
    return { ok: false, error: `No se puede pasar de ${p.desde} a ${p.hacia}.` };
  }
  const supa = p.supa ?? db();
  const marca =
    p.hacia === "pagado"
      ? { pagado_en: new Date().toISOString() }
      : p.hacia === "anulado"
        ? { anulado_en: new Date().toISOString() }
        : {};

  const { data, error } = await supa
    .from("ed_pagos")
    .update({ estado: p.hacia, ...marca })
    .eq("id", p.pagoId)
    .eq("cliente_id", p.clienteId) // aislamiento: nunca el pago de otro negocio
    .eq("estado", p.desde)
    .select("id, chat_id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return { ok: false, error: "El cobro ya cambió de estado (¿alguien más lo marcó?)." };
  }
  if (p.hacia === "pagado") {
    await aplicarPagoConfirmado({ clienteId: p.clienteId, chatId: data[0].chat_id as string, supa });
  }
  return { ok: true };
}

/**
 * EL COBRO SE CONFIRMÓ → LA CONVERSACIÓN LO REFLEJA (Fase 0, 11-sep-2026).
 *
 * Antes, marcar un cobro como pagado no tocaba el contacto: «Falta pago» seguía
 * en la bandeja y la etapa podía quedar en "cotizado" con la plata ya en la
 * cuenta. Ahora se retiran «Falta pago» y «Pago por confirmar», y la etapa pasa
 * a ganado — salvo que una persona la haya movido a mano (etapa_manual).
 *
 * No escribe ed_resultados: el monto confirmado ya vive en ed_pagos, y sumar
 * una venta acá la contaría dos veces con la del detector de cierres.
 * Best-effort: el cobro ya quedó pagado; esto no puede deshacerlo ni fallarlo.
 */
export async function aplicarPagoConfirmado(p: {
  clienteId: string;
  chatId: string;
  supa?: SupabaseClient;
}): Promise<void> {
  const supa = p.supa ?? db();
  try {
    const { data: c } = await supa
      .from("ed_contactos")
      .select("etiquetas, etapa, etapa_manual")
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", p.chatId)
      .maybeSingle();
    if (!c) return;
    const actuales = (c.etiquetas as string[] | null) ?? [];
    const manual = Boolean(c.etapa_manual);
    const etiquetas = manual
      ? actuales.filter((e) => e !== "pago_pendiente" && e !== "pago_por_confirmar")
      : etiquetasTrasPagoConfirmado(actuales);
    const cambios: Record<string, unknown> = {};
    if (etiquetas.length !== actuales.length || etiquetas.some((e, i) => e !== actuales[i])) cambios.etiquetas = etiquetas;
    if (!manual && c.etapa !== "ganado") {
      Object.assign(cambios, { etapa: "ganado", etapa_motivo: "pago_confirmado", etapa_en: new Date().toISOString() });
    }
    if (!Object.keys(cambios).length) return;
    await supa.from("ed_contactos").update(cambios).eq("cliente_id", p.clienteId).eq("chat_id", p.chatId);
  } catch (e) {
    console.error("[pagos] no se pudo reflejar el pago en la conversación:", (e as Error).message);
  }
}

/** Los cobros de una conversación, más recientes primero. */
export async function pagosDeChat(p: {
  clienteId: string;
  chatId: string;
  supa?: SupabaseClient;
}): Promise<Pago[]> {
  const supa = p.supa ?? db();

  /**
   * ⚠️ `referencia_externa` llega con la migración 294, y el deploy va ANTES
   * que la migración (regla de la casa). Sin este reintento, entre el deploy y
   * el SQL PostgREST devuelve error por columna desconocida y el panel de
   * cobros del chat se ve VACÍO — no roto, vacío, que es peor porque parece
   * que no hay cobros. Mismo patrón que `datos_extra` en la agenda.
   */
  const columnas = "id, chat_id, referencia, monto, concepto, estado, creado_en, pagado_en";
  const pedir = (cols: string) =>
    supa
      .from("ed_pagos")
      .select(cols)
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", p.chatId)
      .order("creado_en", { ascending: false })
      .limit(20);

  let r = await pedir(`${columnas}, referencia_externa`);
  if (r.error) r = await pedir(columnas);

  const data = r.data as Record<string, unknown>[] | null;
  return (data ?? []).map((f) => ({
    id: f.id as string,
    chatId: f.chat_id as string,
    referencia: f.referencia as string,
    monto: f.monto as number,
    concepto: f.concepto as string,
    estado: f.estado as EstadoPago,
    creadoEn: f.creado_en as string,
    pagadoEn: (f.pagado_en as string | null) ?? null,
    referenciaExterna: (f.referencia_externa as string | null) ?? null,
  }));
}

/** Fila del listado global de /cobros: el pago más quién es la persona. */
export type PagoListado = Pago & { empleadoId: string; contacto: string };

/**
 * Listado global de cobros del negocio, con el nombre del contacto resuelto.
 *
 * Dos consultas y una unión en memoria — nunca un join implícito de PostgREST
 * (el join ambiguo de la agenda costó 11 días de pantalla vacía) ni una consulta
 * por fila (el N+1 de seguimientos). `limit` explícito: PostgREST corta en 1.000
 * sin avisar.
 */
export async function listarPagos(p: {
  clienteId: string;
  estado?: EstadoPago | "todos";
  supa?: SupabaseClient;
}): Promise<PagoListado[]> {
  const supa = p.supa ?? db();

  // Mismo reintento que en `pagosDeChat`: la 294 puede no estar aplicada aún.
  const columnas =
    "id, empleado_id, chat_id, referencia, monto, concepto, estado, creado_en, pagado_en";
  const pedir = (cols: string) => {
    let q = supa
      .from("ed_pagos")
      .select(cols)
      .eq("cliente_id", p.clienteId)
      .order("creado_en", { ascending: false })
      .limit(200);
    if (p.estado && p.estado !== "todos") q = q.eq("estado", p.estado);
    return q;
  };

  let r = await pedir(`${columnas}, referencia_externa`);
  if (r.error) r = await pedir(columnas);

  const filas = (r.data as Record<string, unknown>[] | null) ?? [];
  if (!filas.length) return [];

  const chatIds = [...new Set(filas.map((f) => f.chat_id as string))];
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre")
    .eq("cliente_id", p.clienteId)
    .in("chat_id", chatIds)
    .limit(500);
  const nombreDe = new Map((contactos ?? []).map((c) => [c.chat_id as string, (c.nombre as string | null) ?? ""]));

  return filas.map((f) => ({
    id: f.id as string,
    empleadoId: f.empleado_id as string,
    chatId: f.chat_id as string,
    referencia: f.referencia as string,
    monto: f.monto as number,
    concepto: f.concepto as string,
    estado: f.estado as EstadoPago,
    creadoEn: f.creado_en as string,
    pagadoEn: (f.pagado_en as string | null) ?? null,
    referenciaExterna: (f.referencia_externa as string | null) ?? null,
    // Un chat de Instagram no es un teléfono: «+ig:1436…» confundiría.
    contacto:
      nombreDe.get(f.chat_id as string) ||
      ((f.chat_id as string).startsWith("ig:") ? "Instagram" : `+${f.chat_id}`),
  }));
}

/**
 * Resumen para el panel de inicio: cuánto se cobró este mes y cuánto espera.
 * Con `count/head` y sumas acotadas — nunca el patrón de las 1.000 filas.
 */
export async function resumenPagos(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<{ pendientes: number; pagadosMes: number; montoMes: number }> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const [pend, pagados] = await Promise.all([
    supa
      .from("ed_pagos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "pendiente"),
    supa
      .from("ed_pagos")
      .select("monto")
      .eq("cliente_id", clienteId)
      .eq("estado", "pagado")
      .gte("pagado_en", inicioMes.toISOString())
      .limit(1000),
  ]);

  const filas = pagados.data ?? [];
  return {
    pendientes: pend.count ?? 0,
    pagadosMes: filas.length,
    montoMes: filas.reduce((s, f) => s + ((f.monto as number) ?? 0), 0),
  };
}
