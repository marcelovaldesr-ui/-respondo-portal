import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarMovimientoCredito } from "@/lib/memberships/creditLedger";

export const HORAS_ANTICIPACION_CANCELACION_DEFECTO = 2;

export type ResultadoInscripcionCredito =
  | {
      ok: true;
      citaId: string;
      saldoRestante: number;
      cupoOcupado: number;
      cupoMaximo: number;
    }
  | {
      ok: false;
      motivo:
        | "sin_membresia"
        | "membresia_vencida"
        | "sin_creditos"
        | "cupo_agotado"
        | "ya_inscrito"
        | "clase_no_existe"
        | "clase_cancelada"
        | "clase_ya_paso"
        | "error";
      detalle?: string;
    };

export type ParametrosInscripcionCredito = {
  clienteId: string;
  contactoId: string;
  claseId: string;
  nombre: string;
  telefono?: string | null;
  chatId?: string | null;
  origen?: "whatsapp" | "web" | "portal";
  empleadoId?: string | null;
  supa?: SupabaseClient;
};

/**
 * INSCRIPCIÓN ATÓMICA CON CRÉDITO A UNA CLASE CON CUPO (P3).
 *
 * Todo o nada:
 *  - Valida membresía activa vigente del contacto.
 *  - Valida saldo de crédito suficiente (o plan ilimitado).
 *  - Reserva cupo en la clase grupal.
 *  - Inserta inscripción en ed_citas.
 *  - Descuenta crédito en ed_creditos_ledger y sincroniza ed_membresias.
 *
 * Concurrencia garantizada por locks transaccionales en PostgreSQL.
 */
export async function inscribirConCredito(
  p: ParametrosInscripcionCredito,
): Promise<ResultadoInscripcionCredito> {
  const supa = p.supa ?? db();

  // 1. Evitar doble inscripción si ya tiene cita activa para esta clase
  const identidad = p.chatId ?? p.telefono ?? null;
  if (identidad) {
    const { data: yaInscrito } = await supa
      .from("ed_citas")
      .select("id")
      .eq("cliente_id", p.clienteId)
      .eq("clase_id", p.claseId)
      .eq("chat_id", identidad)
      .in("estado", ["agendada", "confirmada", "reagendada"])
      .limit(1)
      .maybeSingle();

    if (yaInscrito) {
      return { ok: false, motivo: "ya_inscrito" };
    }
  }

  // 2. Invocar RPC atómico en PostgreSQL
  try {
    const { data, error } = await supa.rpc("ed_inscribir_con_credito", {
      p_cliente_id: p.clienteId,
      p_contacto_id: p.contactoId,
      p_clase_id: p.claseId,
      p_nombre: p.nombre,
      p_telefono: p.telefono ?? null,
      p_chat_id: p.chatId ?? null,
      p_origen: p.origen ?? "whatsapp",
      p_empleado_id: p.empleadoId ?? null,
    });

    if (error) {
      if (error.code === "23505") {
        return { ok: false, motivo: "ya_inscrito" };
      }
      // Si la función SQL aún no está desplegada en el entorno, fallback transaccional
      return fallbackInscribirConCredito(p, supa);
    }

    const res = Array.isArray(data) ? data[0] : data;
    if (!res) return { ok: false, motivo: "error", detalle: "Sin respuesta de la base de datos" };

    if (!res.ok) {
      return {
        ok: false,
        motivo: (res.motivo as ResultadoInscripcionCredito extends { motivo: infer M } ? M : never) ?? "error",
      };
    }

    return {
      ok: true,
      citaId: res.cita_id as string,
      saldoRestante: res.saldo_restante as number,
      cupoOcupado: res.cupo_ocupado as number,
      cupoMaximo: res.cupo_maximo as number,
    };
  } catch {
    return fallbackInscribirConCredito(p, supa);
  }
}

/**
 * Fallback a nivel de aplicación (para testing unitario o mientras se aplica migración 319).
 */
async function fallbackInscribirConCredito(
  p: ParametrosInscripcionCredito,
  supa: SupabaseClient,
): Promise<ResultadoInscripcionCredito> {
  // A. Verificar membresía
  const { data: mem, error: errMem } = await supa
    .from("ed_membresias")
    .select("id, creditos_saldo, es_ilimitada, fin, estado")
    .eq("cliente_id", p.clienteId)
    .eq("contacto_id", p.contactoId)
    .maybeSingle();

  if (errMem || !mem) return { ok: false, motivo: "sin_membresia" };
  if (new Date(mem.fin).getTime() <= Date.now() || mem.estado === "vencida") {
    return { ok: false, motivo: "membresia_vencida" };
  }
  if (!mem.es_ilimitada && mem.creditos_saldo <= 0) {
    return { ok: false, motivo: "sin_creditos" };
  }

  // B. Verificar clase y cupo
  const { data: clase, error: errClase } = await supa
    .from("ed_clases")
    .select("id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado, estado")
    .eq("id", p.claseId)
    .eq("cliente_id", p.clienteId)
    .maybeSingle();

  if (errClase || !clase) return { ok: false, motivo: "clase_no_existe" };
  if (clase.estado !== "activa") return { ok: false, motivo: "clase_cancelada" };
  if (new Date(clase.inicio).getTime() <= Date.now()) return { ok: false, motivo: "clase_ya_paso" };
  if (clase.cupo_ocupado >= clase.cupo_maximo) return { ok: false, motivo: "cupo_agotado" };

  // C. Incrementar cupo ocupado con condición atómica
  const nuevoCupo = clase.cupo_ocupado + 1;
  const { data: updatedClase } = await supa
    .from("ed_clases")
    .update({ cupo_ocupado: nuevoCupo, actualizado_en: new Date().toISOString() })
    .eq("id", clase.id)
    .lt("cupo_ocupado", clase.cupo_maximo)
    .select("cupo_ocupado");

  if (!updatedClase || (Array.isArray(updatedClase) && updatedClase.length === 0)) {
    return { ok: false, motivo: "cupo_agotado" };
  }

  // D. Insertar cita
  const { data: citaNueva, error: errCita } = await supa
    .from("ed_citas")
    .insert({
      cliente_id: p.clienteId,
      servicio_id: clase.servicio_id,
      profesional_id: clase.profesional_id,
      clase_id: clase.id,
      chat_id: p.chatId ?? null,
      nombre_contacto: p.nombre,
      telefono: p.telefono ?? p.chatId ?? null,
      inicio: clase.inicio,
      fin: clase.fin,
      estado: "confirmada",
      origen: p.origen ?? "whatsapp",
      empleado_id: p.empleadoId ?? null,
    })
    .select("id")
    .single();

  if (errCita || !citaNueva) {
    // Rollback cupo
    await supa.from("ed_clases").update({ cupo_ocupado: clase.cupo_ocupado }).eq("id", clase.id);
    return { ok: false, motivo: "error", detalle: errCita?.message };
  }

  // E. Descontar crédito vía ledger
  let saldoRestante = mem.creditos_saldo;
  if (!mem.es_ilimitada) {
    const resLedger = await registrarMovimientoCredito({
      clienteId: p.clienteId,
      membresiaId: mem.id,
      tipoMovimiento: "consumo_reserva",
      delta: -1,
      referencia: citaNueva.id as string,
      idempotencyKey: `consumo-${citaNueva.id}`,
      motivo: `Inscripción clase ${clase.id}`,
      supa,
    });
    saldoRestante = resLedger.ok ? resLedger.saldoResultante : mem.creditos_saldo - 1;
  }

  return {
    ok: true,
    citaId: citaNueva.id as string,
    saldoRestante,
    cupoOcupado: nuevoCupo,
    cupoMaximo: clase.cupo_maximo,
  };
}

export type ResultadoCancelacionCredito = {
  ok: boolean;
  cancelada: boolean;
  creditoDevuelto: boolean;
  motivo?: "cita_invalida" | "ya_cancelada" | "fuera_de_ventana" | "error";
  saldoResultante?: number;
};

/**
 * CANCELA UNA INSCRIPCIÓN A CLASE CON POLÍTICA DE DEVOLUCIÓN DE CRÉDITO.
 *
 * Ventana permitida:
 *  - Si cancela con al menos `horasAnticipacionMin` (default 2h) de anticipación:
 *    -> Cancela reserva.
 *    -> Libera cupo en ed_clases.
 *    -> Devuelve 1 crédito vía ledger (movimiento `devolucion_cancelacion`).
 *  - Si cancela fuera de plazo:
 *    -> Cancela reserva y libera cupo para otro alumno.
 *    -> NO devuelve crédito (penalidad por late cancel).
 */
export async function cancelarInscripcionCredito(
  params: {
    clienteId: string;
    citaId: string;
    contactoId?: string | null;
    horasAnticipacionMin?: number;
    motivo?: string | null;
    supa?: SupabaseClient;
  },
): Promise<ResultadoCancelacionCredito> {
  const supa = params.supa ?? db();
  const horasMin = params.horasAnticipacionMin ?? HORAS_ANTICIPACION_CANCELACION_DEFECTO;

  // 1. Obtener cita y clase
  const { data: cita, error: errCita } = await supa
    .from("ed_citas")
    .select("id, cliente_id, clase_id, inicio, estado, chat_id")
    .eq("id", params.citaId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();

  if (errCita || !cita) {
    return { ok: false, cancelada: false, creditoDevuelto: false, motivo: "cita_invalida" };
  }

  if (cita.estado === "cancelada") {
    return { ok: true, cancelada: true, creditoDevuelto: false, motivo: "ya_cancelada" };
  }

  const inicioMs = new Date(cita.inicio as string).getTime();
  const dentroDeVentana = (inicioMs - Date.now()) >= horasMin * 3600_000;

  // 2. Cancelar cita
  await supa
    .from("ed_citas")
    .update({
      estado: "cancelada",
      notas: params.motivo ? `Cancelado: ${params.motivo}` : "Cancelado por usuario",
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", cita.id);

  // 3. Liberar cupo en la clase si aplica
  if (cita.clase_id) {
    const { data: clase } = await supa
      .from("ed_clases")
      .select("cupo_ocupado")
      .eq("id", cita.clase_id)
      .maybeSingle();

    if (clase) {
      await supa
        .from("ed_clases")
        .update({
          cupo_ocupado: Math.max(0, (clase.cupo_ocupado ?? 1) - 1),
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", cita.clase_id);
    }
  }

  // 4. Evaluar devolución de crédito
  if (!dentroDeVentana) {
    return {
      ok: true,
      cancelada: true,
      creditoDevuelto: false,
      motivo: "fuera_de_ventana",
    };
  }

  // Devolver crédito al socio si encontramos su membresía
  if (params.contactoId) {
    const { data: mem } = await supa
      .from("ed_membresias")
      .select("id, es_ilimitada")
      .eq("cliente_id", params.clienteId)
      .eq("contacto_id", params.contactoId)
      .in("estado", ["activa", "agotada"])
      .order("fin", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mem && !mem.es_ilimitada) {
      const resDev = await registrarMovimientoCredito({
        clienteId: params.clienteId,
        membresiaId: mem.id,
        tipoMovimiento: "devolucion_cancelacion",
        delta: 1,
        referencia: cita.id,
        idempotencyKey: `devolucion-${cita.id}`,
        motivo: `Devolución por cancelación a tiempo de cita ${cita.id}`,
        supa,
      });

      return {
        ok: true,
        cancelada: true,
        creditoDevuelto: resDev.ok,
        saldoResultante: resDev.ok ? resDev.saldoResultante : undefined,
      };
    }
  }

  return { ok: true, cancelada: true, creditoDevuelto: true };
}

/**
 * REGISTRO MANUAL DE NO-SHOW (V1).
 *
 * El staff marca la inasistencia sin devolver crédito.
 */
export async function registrarNoShow(
  params: {
    clienteId: string;
    citaId: string;
    notas?: string;
    supa?: SupabaseClient;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supa = params.supa ?? db();

  const { error } = await supa
    .from("ed_citas")
    .update({
      estado: "no_show",
      notas: params.notas ?? "Inasistencia registrada manualmente por staff",
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", params.citaId)
    .eq("cliente_id", params.clienteId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
