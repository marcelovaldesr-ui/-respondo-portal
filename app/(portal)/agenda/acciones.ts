"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { horaChileAUtc } from "@/lib/agendaCore";
import { crearCita, cambiarEstado } from "@/lib/agenda";
import {
  programarSeguimientosCita,
  anularSeguimientosDeCita,
} from "@/lib/agendaSeguimientos";

/**
 * ACCIONES DE LA AGENDA (F4). Mismas reglas de seguridad que
 * informacion/acciones.ts: el cliente_id JAMÁS viene del formulario — sale de
 * la sesión — y toda escritura filtra por cliente_id.
 *
 * Fechas: los <input type="datetime-local"> entregan hora de PARED de Chile
 * ("2026-08-03T15:00"); se convierten a instante real con horaChileAUtc para
 * que el cambio de hora de septiembre no corra la agenda.
 */

async function clienteActual(): Promise<string> {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) throw new Error("Sesión no válida");
  return usuario.clienteId;
}

function texto(f: FormData, campo: string): string {
  return String(f.get(campo) ?? "").trim();
}

function numero(f: FormData, campo: string, porDefecto: number): number {
  const n = Number(texto(f, campo));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : porDefecto;
}

/** "2026-08-03T15:00" (hora Chile) → Date UTC. Null si no parsea. */
function parsearLocalChile(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (!m) return null;
  return horaChileAUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

export async function crearServicio(formData: FormData) {
  const clienteId = await clienteActual();
  const nombre = texto(formData, "nombre");
  if (!nombre) return;
  const precio = texto(formData, "precio");
  await db().from("ed_servicios").insert({
    cliente_id: clienteId,
    nombre,
    duracion_min: Math.min(480, Math.max(5, numero(formData, "duracion", 30))),
    precio_clp: precio ? Number(precio.replace(/\D/g, "")) || null : null,
  });
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

/**
 * Elimina un servicio DEFINITIVAMENTE. La página solo ofrece este botón cuando
 * el servicio no tiene ninguna cita (si la tuviera, la llave foránea lo
 * impediría y además se perdería el historial: en ese caso se usa "Apagar").
 */
export async function eliminarServicio(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;
  const supa = db();

  // Barrera doble: pertenencia al cliente + que de verdad no tenga citas.
  const { count } = await supa
    .from("ed_citas")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .eq("servicio_id", id);
  if ((count ?? 0) > 0) return; // hay historial: no se borra

  const { error } = await supa.from("ed_servicios").delete().eq("id", id).eq("cliente_id", clienteId);
  if (error) console.error("[agenda] eliminarServicio:", error.message);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

/** Igual que el anterior, para profesionales. Sus horarios caen por cascada. */
export async function eliminarProfesional(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;
  const supa = db();

  const { count } = await supa
    .from("ed_citas")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .eq("profesional_id", id);
  if ((count ?? 0) > 0) return;

  const { error } = await supa.from("ed_profesionales").delete().eq("id", id).eq("cliente_id", clienteId);
  if (error) console.error("[agenda] eliminarProfesional:", error.message);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function alternarServicio(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  const activo = texto(formData, "activo") === "true";
  if (!id) return;
  await db()
    .from("ed_servicios")
    .update({ activo: !activo })
    .eq("id", id)
    .eq("cliente_id", clienteId);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

// ---------------------------------------------------------------------------
// Profesionales y horarios
// ---------------------------------------------------------------------------

export async function crearProfesional(formData: FormData) {
  const clienteId = await clienteActual();
  const nombre = texto(formData, "nombre");
  if (!nombre) return;
  await db().from("ed_profesionales").insert({ cliente_id: clienteId, nombre });
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function alternarProfesional(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  const activo = texto(formData, "activo") === "true";
  if (!id) return;
  await db()
    .from("ed_profesionales")
    .update({ activo: !activo })
    .eq("id", id)
    .eq("cliente_id", clienteId);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function agregarHorario(formData: FormData) {
  const clienteId = await clienteActual();
  const profesionalId = texto(formData, "profesional");
  const desde = texto(formData, "desde");
  const hasta = texto(formData, "hasta");
  if (!profesionalId || !/^\d{2}:\d{2}$/.test(desde) || !/^\d{2}:\d{2}$/.test(hasta)) return;
  if (desde >= hasta) return;

  // Barrera: el profesional debe ser de este cliente.
  const { data: prof } = await db()
    .from("ed_profesionales")
    .select("id")
    .eq("id", profesionalId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!prof) return;

  const dias = formData
    .getAll("dias")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (dias.length === 0) return;

  await db()
    .from("ed_horarios")
    .insert(dias.map((dia) => ({ profesional_id: profesionalId, dia_semana: dia, desde, hasta })));
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function eliminarHorario(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;
  // Borrado seguro vía join manual: verificar dueño del horario.
  const supa = db();
  const { data: h } = await supa
    .from("ed_horarios")
    .select("id, ed_profesionales!inner(cliente_id)")
    .eq("id", id)
    .eq("ed_profesionales.cliente_id", clienteId)
    .maybeSingle();
  if (!h) return;
  await supa.from("ed_horarios").delete().eq("id", id);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

// ---------------------------------------------------------------------------
// Google Calendar por profesional (F5, vía cuenta de servicio)
// ---------------------------------------------------------------------------

export async function configurarGoogleProfesional(formData: FormData) {
  const clienteId = await clienteActual();
  const profesionalId = texto(formData, "profesional");
  if (!profesionalId) return;

  // Barrera: el profesional debe ser de este cliente.
  const supa = db();
  const { data: prof } = await supa
    .from("ed_profesionales")
    .select("id")
    .eq("id", profesionalId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!prof) return;

  const gcalId = texto(formData, "gcal_id").slice(0, 200);
  const sync = texto(formData, "gcal_sync") === "on" && gcalId !== "";

  const { error } = await supa
    .from("ed_profesionales")
    .update({ gcal_id: gcalId || null, gcal_sync: sync, gcal_ultimo_error: null })
    .eq("id", profesionalId);
  if (error) console.error("[agenda] configurarGoogleProfesional:", error.message);

  // Prueba de acceso inmediata: si la cuenta de servicio no ve el calendario,
  // se guarda el motivo para mostrárselo al dueño en la misma pantalla.
  if (sync && gcalId) {
    const { probarCalendario, googleCalendarConfigurado } = await import("@/lib/googleCalendar");
    if (!googleCalendarConfigurado()) {
      await supa
        .from("ed_profesionales")
        .update({ gcal_ultimo_error: "Falta configurar la cuenta de servicio de Google en el servidor." })
        .eq("id", profesionalId);
    } else {
      const r = await probarCalendario(gcalId);
      await supa
        .from("ed_profesionales")
        .update({
          gcal_ultimo_error: r.ok ? null : (r.detalle ?? r.motivo),
          gcal_ultima_sync: new Date().toISOString(),
        })
        .eq("id", profesionalId);
    }
  }
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

// ---------------------------------------------------------------------------
// Bloqueos
// ---------------------------------------------------------------------------

export async function crearBloqueo(formData: FormData) {
  const clienteId = await clienteActual();
  const desde = parsearLocalChile(texto(formData, "desde"));
  const hasta = parsearLocalChile(texto(formData, "hasta"));
  if (!desde || !hasta || desde >= hasta) return;
  const profesional = texto(formData, "profesional");
  await db().from("ed_bloqueos").insert({
    cliente_id: clienteId,
    profesional_id: profesional || null,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    motivo: texto(formData, "motivo") || null,
  });
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function eliminarBloqueo(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;
  await db().from("ed_bloqueos").delete().eq("id", id).eq("cliente_id", clienteId);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

// ---------------------------------------------------------------------------
// Reservas online (config)
// ---------------------------------------------------------------------------

export async function configurarReservas(formData: FormData) {
  const clienteId = await clienteActual();
  const slugCrudo = texto(formData, "slug").toLowerCase();
  const slug = slugCrudo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const activar = texto(formData, "reservas_online") === "on";

  const { error } = await db()
    .from("ed_clientes")
    .update({
      slug: slug || null,
      reservas_online: activar && !!slug,
      confirmacion_automatica: texto(formData, "confirmacion_automatica") === "on",
      anticipacion_min_horas: Math.min(72, numero(formData, "anticipacion", 2)),
      horizonte_dias: Math.min(90, numero(formData, "horizonte", 30)),
    })
    .eq("id", clienteId);
  if (error) console.error("[agenda] configurarReservas:", error.message);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

export async function crearCitaManual(formData: FormData) {
  const clienteId = await clienteActual();
  const inicio = parsearLocalChile(texto(formData, "inicio"));
  const servicioId = texto(formData, "servicio");
  const profesionalId = texto(formData, "profesional");
  const nombre = texto(formData, "nombre");
  if (!inicio || !servicioId || !profesionalId || !nombre) return;

  const telefono = texto(formData, "telefono").replace(/\D/g, "");
  const chatId = telefono
    ? telefono.startsWith("56")
      ? telefono
      : telefono.length === 9
        ? `56${telefono}`
        : telefono
    : undefined;

  const r = await crearCita({
    clienteId,
    servicioId,
    profesionalId,
    inicioIso: inicio.toISOString(),
    nombreContacto: nombre,
    telefono: telefono || undefined,
    chatId,
    origen: "portal",
  });

  if (r.ok) {
    const { data: svc } = await db()
      .from("ed_servicios")
      .select("nombre")
      .eq("id", servicioId)
      .maybeSingle();
    await programarSeguimientosCita({
      cita: r.cita,
      servicioNombre: (svc?.nombre as string) ?? "tu hora",
      clienteId,
    }).catch(() => 0);
  }
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

/**
 * Devuelve una cita a "agendada" — el deshacer de Cancelar / No llegó /
 * Completada. Sin esto, un clic equivocado dejaba la cita en un callejón sin
 * salida (todos los botones desaparecían).
 *
 * Puede fallar si en el intertanto otra persona tomó ese cupo: en ese caso el
 * constraint de la base lo impide y la cita se queda como está.
 */
export async function reabrirCita(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  if (!id) return;

  const { error } = await db()
    .from("ed_citas")
    .update({ estado: "agendada", actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .eq("cliente_id", clienteId);
  if (error) console.error("[agenda] reabrirCita:", error.message);
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}

export async function cambiarEstadoCita(formData: FormData) {
  const clienteId = await clienteActual();
  const id = texto(formData, "id");
  const estado = texto(formData, "estado");
  if (!id || !["confirmada", "cancelada", "no_show", "completada"].includes(estado)) return;

  await cambiarEstado(clienteId, id, estado as "confirmada" | "cancelada" | "no_show" | "completada");
  if (estado === "cancelada" || estado === "no_show") {
    await anularSeguimientosDeCita(id);
  }
  revalidatePath("/agenda", "layout"); // "layout" = también /agenda/configuracion
}
