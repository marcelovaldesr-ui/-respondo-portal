import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  googleCalendarConfigurado,
  ocupadosDeGoogle,
  guardarEvento,
  borrarEvento,
} from "@/lib/googleCalendar";
import { formatearSlot } from "@/lib/agendaCore";

/**
 * PUENTE AGENDA ↔ GOOGLE CALENDAR (F5).
 *
 * Todo aquí es BEST-EFFORT y DEFENSIVO por diseño:
 *  - Si no hay credenciales de cuenta de servicio → no hace nada.
 *  - Si la migración 221 no está aplicada (no existen las columnas gcal_*) →
 *    no hace nada.
 *  - Si Google falla (caído, permiso revocado) → se registra el error en la
 *    fila del profesional y la cita sigue su vida normal.
 *
 * Nunca, bajo ninguna circunstancia, un problema con Google puede impedir que
 * se cree una cita o que un empleado responda.
 */

export type CalendarioProfesional = { profesionalId: string; calendarioId: string };

/**
 * Calendarios de Google activos de estos profesionales.
 * Devuelve [] si la 221 no está aplicada o si nadie tiene sync encendido.
 */
export async function calendariosDe(
  profesionalIds: string[],
  supa: SupabaseClient = db(),
): Promise<CalendarioProfesional[]> {
  if (profesionalIds.length === 0 || !googleCalendarConfigurado()) return [];
  try {
    const { data, error } = await supa
      .from("ed_profesionales")
      .select("id, gcal_id, gcal_sync")
      .in("id", profesionalIds)
      .eq("gcal_sync", true);
    if (error) return []; // migración 221 pendiente
    return (data ?? [])
      .filter((p) => typeof p.gcal_id === "string" && (p.gcal_id as string).trim() !== "")
      .map((p) => ({ profesionalId: p.id as string, calendarioId: (p.gcal_id as string).trim() }));
  } catch {
    return [];
  }
}

/**
 * Bloques ocupados en los calendarios personales de los profesionales, ya
 * mapeados al formato que consume el núcleo de disponibilidad.
 * Así, si el dueño se pone "Dentista" a las 4 en SU Google Calendar, Respondo
 * deja de ofrecer ese cupo.
 */
export async function ocupadosDesdeGoogle(
  profesionalIds: string[],
  desdeIso: string,
  hastaIso: string,
  supa: SupabaseClient = db(),
): Promise<{ profesionalId: string; desde: string; hasta: string }[]> {
  const cals = await calendariosDe(profesionalIds, supa);
  if (cals.length === 0) return [];

  const porCalendario = new Map<string, string[]>();
  for (const c of cals) {
    porCalendario.set(c.calendarioId, [...(porCalendario.get(c.calendarioId) ?? []), c.profesionalId]);
  }

  const ocupados = await ocupadosDeGoogle([...porCalendario.keys()], desdeIso, hastaIso);
  const salida: { profesionalId: string; desde: string; hasta: string }[] = [];
  for (const o of ocupados) {
    for (const profesionalId of porCalendario.get(o.calendarioId) ?? []) {
      salida.push({ profesionalId, desde: o.desde, hasta: o.hasta });
    }
  }
  return salida;
}

async function anotarEstadoSync(
  profesionalId: string,
  error: string | null,
  supa: SupabaseClient,
): Promise<void> {
  try {
    await supa
      .from("ed_profesionales")
      .update({ gcal_ultimo_error: error, gcal_ultima_sync: new Date().toISOString() })
      .eq("id", profesionalId);
  } catch {
    /* la 221 puede no estar aplicada: no importa */
  }
}

/**
 * Escribe (o actualiza) la cita en el Google Calendar del profesional.
 * Se llama después de crear o reagendar. No bloquea ni propaga errores.
 */
export async function sincronizarCita(
  cita: {
    id: string;
    profesional_id: string;
    inicio: string;
    fin: string;
    nombre_contacto: string;
    telefono: string | null;
    chat_id: string | null;
    estado: string;
  },
  servicioNombre: string,
  supa: SupabaseClient = db(),
): Promise<void> {
  try {
    const cals = await calendariosDe([cita.profesional_id], supa);
    const cal = cals[0];
    if (!cal) return;

    // Una cita cancelada o no_show se BORRA del calendario del dueño.
    if (cita.estado === "cancelada" || cita.estado === "no_show") {
      const r = await borrarEvento(cal.calendarioId, cita.id);
      await anotarEstadoSync(cita.profesional_id, r.ok ? null : (r.detalle ?? r.motivo), supa);
      return;
    }

    const r = await guardarEvento({
      citaId: cita.id,
      calendarioId: cal.calendarioId,
      titulo: `${servicioNombre} · ${cita.nombre_contacto}`,
      descripcion: [
        `Cliente: ${cita.nombre_contacto}`,
        `Contacto: ${cita.telefono ?? cita.chat_id ?? "sin teléfono"}`,
        `Reservado en Respondo · ${formatearSlot(cita.inicio)}`,
      ].join("\n"),
      inicio: cita.inicio,
      fin: cita.fin,
    });
    await anotarEstadoSync(cita.profesional_id, r.ok ? null : (r.detalle ?? r.motivo), supa);
    if (!r.ok) console.error("[agendaGoogle] no se pudo sincronizar la cita:", r.motivo, r.detalle);
  } catch (e) {
    console.error("[agendaGoogle] excepción al sincronizar:", (e as Error).message);
  }
}

/** Quita la cita del calendario (cancelación desde el portal o WhatsApp). */
export async function quitarCitaDeGoogle(
  citaId: string,
  profesionalId: string,
  supa: SupabaseClient = db(),
): Promise<void> {
  try {
    const cals = await calendariosDe([profesionalId], supa);
    const cal = cals[0];
    if (!cal) return;
    const r = await borrarEvento(cal.calendarioId, citaId);
    await anotarEstadoSync(profesionalId, r.ok ? null : (r.detalle ?? r.motivo), supa);
  } catch (e) {
    console.error("[agendaGoogle] excepción al quitar:", (e as Error).message);
  }
}
