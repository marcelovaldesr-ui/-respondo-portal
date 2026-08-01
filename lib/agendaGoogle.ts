import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  googleCalendarConfigurado,
  ocupadosDeGoogle,
  ocupadosDeUnCalendario,
  guardarEvento,
  borrarEvento,
} from "@/lib/googleCalendar";
import { oauthConfigurado, accessTokenDesdeRefresh, descifrarRefreshToken } from "@/lib/googleOAuth";
import { formatearSlot } from "@/lib/agendaCore";

/**
 * PUENTE AGENDA ↔ GOOGLE CALENDAR (F5 + F5-OAuth).
 *
 * Cada profesional sincroniza por UNO de dos mecanismos, guardado en
 * ed_profesionales.gcal_modo:
 *  - 'cuenta_servicio': el dueño compartió su calendario con el correo robot
 *    de Respondo (lib/googleCalendar.ts). Sin espera de Google, hoy mismo.
 *  - 'oauth': el dueño conectó con el botón "Conectar Google Calendar"
 *    (lib/googleOAuth.ts). Requiere que la app esté verificada por Google.
 * El calendario en modo 'oauth' es siempre "primary" (el propio, el que
 * autorizó al conectar) — no hace falta que el dueño busque ningún ID.
 *
 * Todo aquí es BEST-EFFORT y DEFENSIVO por diseño:
 *  - Si no hay credenciales de NINGUNO de los dos mecanismos → no hace nada.
 *  - Si la migración correspondiente no está aplicada → no hace nada.
 *  - Si Google falla (caído, permiso revocado) → se registra el error en la
 *    fila del profesional y la cita sigue su vida normal.
 *
 * Nunca, bajo ninguna circunstancia, un problema con Google puede impedir que
 * se cree una cita o que un empleado responda.
 */

const CALENDARIO_PROPIO = "primary";

export type AccesoProfesional = {
  profesionalId: string;
  calendarioId: string;
  /** Presente solo en modo 'oauth': el access token ya refrescado para esta llamada. */
  tokenOAuth?: string;
};

/**
 * Accesos a Google Calendar activos de estos profesionales (de cualquiera de
 * los dos mecanismos). Devuelve [] si ninguno está configurado o si nadie
 * tiene sync encendido.
 */
export async function calendariosDe(
  profesionalIds: string[],
  supa: SupabaseClient = db(),
): Promise<AccesoProfesional[]> {
  if (profesionalIds.length === 0) return [];
  if (!googleCalendarConfigurado() && !oauthConfigurado()) return [];
  try {
    const { data, error } = await supa
      .from("ed_profesionales")
      .select("id, gcal_id, gcal_sync, gcal_modo, gcal_oauth_refresh_cifrado")
      .in("id", profesionalIds)
      .eq("gcal_sync", true);
    if (error) return []; // migración 221/222 pendiente

    const salida: AccesoProfesional[] = [];
    for (const p of data ?? []) {
      const modo = (p.gcal_modo as string | null) ?? "cuenta_servicio";

      if (modo === "oauth") {
        const cifrado = p.gcal_oauth_refresh_cifrado as string | null;
        if (!cifrado || !oauthConfigurado()) continue;
        const refresh = descifrarRefreshToken(cifrado);
        if (!refresh) continue; // clave rotada o dato corrupto: se trata como sin conectar
        const tk = await accessTokenDesdeRefresh(refresh);
        if (!tk.ok) {
          await anotarEstadoSync(p.id as string, `oauth: ${tk.motivo}`, supa);
          continue;
        }
        salida.push({ profesionalId: p.id as string, calendarioId: CALENDARIO_PROPIO, tokenOAuth: tk.datos });
        continue;
      }

      // Modo cuenta de servicio (default, incluye filas de antes de la 222).
      if (!googleCalendarConfigurado()) continue;
      const gcalId = (p.gcal_id as string | null)?.trim();
      if (!gcalId) continue;
      salida.push({ profesionalId: p.id as string, calendarioId: gcalId });
    }
    return salida;
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

  const salida: { profesionalId: string; desde: string; hasta: string }[] = [];

  // Cuenta de servicio: se puede batchear en UNA llamada de freeBusy, porque
  // la cuenta de servicio ve varios calendarios ajenos a la vez.
  const porCalendarioServicio = new Map<string, string[]>();
  for (const c of cals) {
    if (c.tokenOAuth) continue;
    porCalendarioServicio.set(c.calendarioId, [
      ...(porCalendarioServicio.get(c.calendarioId) ?? []),
      c.profesionalId,
    ]);
  }
  if (porCalendarioServicio.size > 0) {
    const ocupados = await ocupadosDeGoogle([...porCalendarioServicio.keys()], desdeIso, hastaIso);
    for (const o of ocupados) {
      for (const profesionalId of porCalendarioServicio.get(o.calendarioId) ?? []) {
        salida.push({ profesionalId, desde: o.desde, hasta: o.hasta });
      }
    }
  }

  // OAuth: cada token solo ve el calendario de quien lo autorizó, así que va
  // una consulta por profesional (en paralelo).
  const conOAuth = cals.filter((c) => c.tokenOAuth);
  await Promise.all(
    conOAuth.map(async (c) => {
      const ocupados = await ocupadosDeUnCalendario(c.calendarioId, desdeIso, hastaIso, c.tokenOAuth!);
      for (const o of ocupados) salida.push({ profesionalId: c.profesionalId, desde: o.desde, hasta: o.hasta });
    }),
  );

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
    /* la 221/222 puede no estar aplicada: no importa */
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
      const r = await borrarEvento(cal.calendarioId, cita.id, cal.tokenOAuth);
      await anotarEstadoSync(cita.profesional_id, r.ok ? null : (r.detalle ?? r.motivo), supa);
      return;
    }

    const r = await guardarEvento(
      {
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
      },
      cal.tokenOAuth,
    );
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
    const r = await borrarEvento(cal.calendarioId, citaId, cal.tokenOAuth);
    await anotarEstadoSync(profesionalId, r.ok ? null : (r.detalle ?? r.motivo), supa);
  } catch (e) {
    console.error("[agendaGoogle] excepción al quitar:", (e as Error).message);
  }
}
