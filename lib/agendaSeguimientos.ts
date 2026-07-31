import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatearSlot, fechaChileDe, ZONA_AGENDA } from "@/lib/agendaCore";
import type { Cita } from "@/lib/agenda";

/**
 * SEGUIMIENTOS DE CITA (F3) — confirmación, recordatorio y encuesta postventa.
 *
 * Se monta ENTERO sobre el motor existente de ed_seguimientos + el cron
 * (app/api/cron/seguimientos): aquí solo se INSERTAN filas programadas con el
 * texto listo en variables.texto (el mismo contrato que ya envía el cron) y
 * un extra: variables.cita_id, para poder anularlas si la cita se cancela o
 * se reagenda.
 *
 * REQUISITO: migración 214 aplicada (agrega los tipos 'recordatorio_cita',
 * 'confirmacion_cita', 'encuesta_postventa' al CHECK de ed_seguimientos).
 * DEFENSIVO: si la 214 no está aplicada, el insert falla el CHECK y esta capa
 * lo absorbe sin romper el flujo de la cita (la cita queda creada igual; solo
 * no habrá recordatorios). Nada de esto toca el flujo actual de Tino.
 */

/** "14:30" en hora de Chile para un ISO. */
function horaChile(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function empleadoPorRol(
  clienteId: string,
  rol: string,
  supa: SupabaseClient,
): Promise<string | null> {
  const { data } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("rol", rol)
    .eq("activo", true)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function insertarSeguimiento(
  supa: SupabaseClient,
  fila: {
    empleadoId: string;
    chatId: string;
    tipo: string;
    texto: string;
    citaId: string;
    programadoPara: Date;
  },
): Promise<boolean> {
  const { error } = await supa.from("ed_seguimientos").insert({
    empleado_id: fila.empleadoId,
    chat_id: fila.chatId,
    tipo: fila.tipo,
    plantilla_meta: "texto_libre",
    variables: { texto: fila.texto, cita_id: fila.citaId },
    programado_para: fila.programadoPara.toISOString(),
    max_intentos: 1,
    intento: 0,
  });
  if (error) {
    // Típico: CHECK de tipo (migración 214 pendiente). No romper la cita.
    console.error(`[agendaSeguimientos] no se pudo programar ${fila.tipo}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Programa los mensajes automáticos de una cita recién creada (o reagendada):
 *  - confirmación T−24h (solo si la cita está a más de 26h)
 *  - recordatorio T−3h (solo si la cita está a más de 4h)
 *  - encuesta postventa T+2h del término (Vera; solo si el cliente la tiene)
 *
 * El cron existente los envía respetando horario hábil, tope diario y
 * no_contactar. Devuelve cuántos quedaron programados.
 */
export async function programarSeguimientosCita(params: {
  cita: Cita;
  servicioNombre: string;
  clienteId: string;
  nombreNegocio?: string;
  supa?: SupabaseClient;
}): Promise<number> {
  const supa = params.supa ?? db();
  const { cita } = params;
  if (!cita.chat_id) return 0; // reserva web sin WhatsApp: no hay a quién escribirle

  const ahora = Date.now();
  const inicioMs = Date.parse(cita.inicio);
  const finMs = Date.parse(cita.fin);
  const nombre = cita.nombre_contacto?.split(" ")[0] ?? "";
  const saludo = nombre ? `Hola ${nombre} 👋` : "Hola 👋";
  const cuando = formatearSlot(cita.inicio);

  const tino =
    (cita.empleado_id as string | null) ??
    (await empleadoPorRol(params.clienteId, "tino", supa));
  const vera = await empleadoPorRol(params.clienteId, "vera", supa);

  let programados = 0;

  // Confirmación T−24h
  if (tino && inicioMs - ahora > 26 * 3600_000) {
    const ok = await insertarSeguimiento(supa, {
      empleadoId: tino,
      chatId: cita.chat_id,
      tipo: "confirmacion_cita",
      citaId: cita.id,
      programadoPara: new Date(inicioMs - 24 * 3600_000),
      texto: `${saludo} Te esperamos mañana para tu ${params.servicioNombre} (${cuando}). ¿Me confirmas que vienes? Responde SÍ para confirmar, o CAMBIAR si necesitas otro horario 🙌`,
    });
    if (ok) programados++;
  }

  // Recordatorio T−3h
  if (tino && inicioMs - ahora > 4 * 3600_000) {
    const ok = await insertarSeguimiento(supa, {
      empleadoId: tino,
      chatId: cita.chat_id,
      tipo: "recordatorio_cita",
      citaId: cita.id,
      programadoPara: new Date(inicioMs - 3 * 3600_000),
      texto: `${saludo} Te esperamos hoy a las ${horaChile(cita.inicio)} para tu ${params.servicioNombre} 🙌 ¡Nos vemos!`,
    });
    if (ok) programados++;
  }

  // Encuesta postventa T+2h (Vera)
  if (vera) {
    const ok = await insertarSeguimiento(supa, {
      empleadoId: vera,
      chatId: cita.chat_id,
      tipo: "encuesta_postventa",
      citaId: cita.id,
      programadoPara: new Date(finMs + 2 * 3600_000),
      texto: `${saludo} ¿Qué tal resultó tu ${params.servicioNombre} de hoy? De 1 a 5, ¿cómo lo evaluarías? 🌟`,
    });
    if (ok) programados++;
  }

  return programados;
}

/**
 * Anula los seguimientos PENDIENTES (no enviados) de una cita — se usa al
 * cancelar o reagendar. Defensivo: errores se absorben.
 */
export async function anularSeguimientosDeCita(
  citaId: string,
  supa: SupabaseClient = db(),
): Promise<void> {
  try {
    await supa
      .from("ed_seguimientos")
      .delete()
      .is("enviado_en", null)
      .contains("variables", { cita_id: citaId });
  } catch (e) {
    console.error("[agendaSeguimientos] anular falló:", (e as Error).message);
  }
}

/**
 * ¿Hay una confirmación de cita esperando respuesta en este chat?
 * Devuelve la cita asociada más próxima (activa) o null.
 * Ventana: confirmación enviada hace menos de 36h.
 */
export async function confirmacionPendiente(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<{ citaId: string; inicio: string } | null> {
  try {
    const desde = new Date(Date.now() - 36 * 3600_000).toISOString();
    const { data: segs } = await supa
      .from("ed_seguimientos")
      .select("variables, enviado_en, ed_empleados!inner(cliente_id)")
      .eq("chat_id", chatId)
      .eq("tipo", "confirmacion_cita")
      .eq("ed_empleados.cliente_id", clienteId)
      .not("enviado_en", "is", null)
      .gte("enviado_en", desde)
      .order("enviado_en", { ascending: false })
      .limit(3);
    for (const s of segs ?? []) {
      const citaId = (s.variables as { cita_id?: string } | null)?.cita_id;
      if (!citaId) continue;
      const { data: cita } = await supa
        .from("ed_citas")
        .select("id, inicio, estado")
        .eq("id", citaId)
        .eq("cliente_id", clienteId)
        .in("estado", ["agendada", "reagendada"])
        .gte("inicio", new Date().toISOString())
        .maybeSingle();
      if (cita) return { citaId: cita.id as string, inicio: cita.inicio as string };
    }
    return null;
  } catch {
    return null;
  }
}

/** Día chileno (YYYY-M-D) de un ISO — útil para agrupar citas por día. */
export function claveDiaChile(iso: string): string {
  const f = fechaChileDe(new Date(iso));
  return `${f.anio}-${f.mes}-${f.dia}`;
}
