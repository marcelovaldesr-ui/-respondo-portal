import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guarda un mensaje en ed_mensajes de forma robusta.
 *
 * - Si viene `waId` (id de WhatsApp), lo guarda en wa_message_id → habilita
 *   idempotencia (índice único (empleado_id, wa_message_id) de la migración 212)
 *   y la distinción entre el eco de Tino y un mensaje humano.
 * - Idempotencia dura: si el INSERT choca con el índice único (código 23505),
 *   NO se duplica; se devuelve { ok:true, dup:true }.
 * - Compatibilidad: si la columna wa_message_id todavía no existe (código 42703,
 *   migración 212 sin aplicar), reintenta sin el id para no romper nada.
 */
export async function guardarMensaje(
  supa: SupabaseClient,
  m: {
    empleadoId: string;
    chatId: string;
    rol: "cliente" | "empleado" | "humano";
    texto: string;
    waId?: string | null;
    canal?: string;
  },
): Promise<{ ok: boolean; dup?: boolean }> {
  const base: Record<string, unknown> = {
    empleado_id: m.empleadoId,
    chat_id: m.chatId,
    rol: m.rol,
    texto: m.texto,
  };
  if (m.canal) base.canal = m.canal;

  if (m.waId) {
    const { error } = await supa
      .from("ed_mensajes")
      .insert({ ...base, wa_message_id: m.waId });
    if (!error) return { ok: true };
    if (error.code === "23505") return { ok: true, dup: true }; // idempotencia DB
    // 42703 (Postgres) / PGRST204 (PostgREST) = columna wa_message_id inexistente
    // (migración 212 pendiente) → cae al fallback SIN ruido. Otros errores sí se loguean.
    if (error.code !== "42703" && error.code !== "PGRST204") {
      console.error("[guardarMensaje] error:", error.code, error.message);
    }
  }

  const { error } = await supa.from("ed_mensajes").insert(base);
  if (error) {
    console.error("[guardarMensaje] fallback error:", error.code, error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * ¿Ya se procesó este id de WhatsApp para este empleado? (idempotencia previa).
 * Defensivo: si la columna wa_message_id no existe aún, devuelve false.
 */
export async function yaProcesado(
  supa: SupabaseClient,
  empleadoId: string,
  waId: string,
): Promise<boolean> {
  const { data, error } = await supa
    .from("ed_mensajes")
    .select("id")
    .eq("empleado_id", empleadoId)
    .eq("wa_message_id", waId)
    .limit(1)
    .maybeSingle();
  if (error) return false; // columna inexistente u otro → no bloquear el flujo
  return Boolean(data);
}

/**
 * Red de seguridad para el eco: ¿hay un mensaje de Tino (rol=empleado) con el
 * MISMO texto en este chat en los últimos `segundos`? Cubre la carrera en que
 * el eco de Evolution llega antes de que se guarde el id del envío de Tino.
 */
export async function esEcoReciente(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
  texto: string,
  segundos = 25,
): Promise<boolean> {
  const desde = new Date(Date.now() - segundos * 1000).toISOString();
  const { data, error } = await supa
    .from("ed_mensajes")
    .select("id")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .eq("rol", "empleado")
    .eq("texto", texto)
    .gte("creado_en", desde)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

// ============================================================================
// FASE 5 — Tracking de entrega (ACKs) y ritmo humano de envío
// ============================================================================

/**
 * Actualiza el estado de entrega de un envío (evento MESSAGES_UPDATE de
 * Evolution) buscándolo por (empleado_id, wa_message_id).
 *
 * Regla anti-retroceso: los ACKs pueden llegar desordenados; nunca se pisa un
 * estado "mayor" con uno "menor" (p.ej. no volver de 'leido' a 'server_ack').
 * 'error' siempre gana porque es información crítica.
 *
 * Defensivo: si las columnas de la migración 213 no existen aún, no rompe nada.
 */
const RANGO_ESTADO: Record<string, number> = {
  pendiente: 0,
  server_ack: 1,
  entregado: 2,
  leido: 3,
  error: 9,
};

export async function actualizarEstadoEnvio(
  supa: SupabaseClient,
  empleadoId: string,
  waId: string,
  estado: "pendiente" | "server_ack" | "entregado" | "leido" | "error",
): Promise<{ ok: boolean; encontrado?: boolean }> {
  const { data, error } = await supa
    .from("ed_mensajes")
    .select("id, estado_envio")
    .eq("empleado_id", empleadoId)
    .eq("wa_message_id", waId)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Columna wa_message_id o estado_envio inexistente (migraciones pendientes).
    if (error.code !== "42703" && error.code !== "PGRST204") {
      console.error("[actualizarEstadoEnvio] error:", error.code, error.message);
    }
    return { ok: false };
  }
  if (!data) return { ok: true, encontrado: false }; // ack de un mensaje ajeno (ej. humano)

  const actual = (data.estado_envio as string | null) ?? "pendiente";
  if ((RANGO_ESTADO[estado] ?? 0) < (RANGO_ESTADO[actual] ?? 0)) {
    return { ok: true, encontrado: true }; // no retroceder
  }

  const { error: e2 } = await supa
    .from("ed_mensajes")
    .update({ estado_envio: estado, estado_envio_en: new Date().toISOString() })
    .eq("id", data.id);
  if (e2) {
    if (e2.code !== "42703" && e2.code !== "PGRST204") {
      console.error("[actualizarEstadoEnvio] update error:", e2.code, e2.message);
    }
    return { ok: false };
  }
  return { ok: true, encontrado: true };
}

/**
 * Freno de ritmo humano: cuenta los envíos del empleado en el último minuto.
 * El límite de referencia es ~8/min (perfil anti-ban de la vía no oficial).
 * Defensivo: ante error devuelve 0 (nunca bloquear una respuesta por esto).
 */
export async function enviosUltimoMinuto(
  supa: SupabaseClient,
  empleadoId: string,
): Promise<number> {
  const desde = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supa
    .from("ed_mensajes")
    .select("id", { count: "exact", head: true })
    .eq("empleado_id", empleadoId)
    .eq("rol", "empleado")
    .gte("creado_en", desde);
  if (error) return 0;
  return count ?? 0;
}
