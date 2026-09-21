"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { horaChileAUtc } from "@/lib/agendaCore";
import { crearClase, generarSerie, cancelarClase } from "@/lib/clases";
import {
  obtenerDetalleClaseOperacional,
  marcarAsistenciaCita,
} from "@/lib/classes/classesOperations";
import {
  inscribirConCredito,
  cancelarInscripcionCredito,
  registrarNoShow,
} from "@/lib/classes/atomicBooking";
import { db } from "@/lib/db";

/**
 * Acciones del portal para las clases grupales.
 */

/** Crea una sesión suelta. */
export async function crearClaseAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return;

  const servicioId = String(formData.get("servicioId") ?? "");
  const profesionalId = String(formData.get("profesionalId") ?? "");
  const fecha = String(formData.get("fecha") ?? "");
  const hora = String(formData.get("hora") ?? "");
  const duracion = Number(formData.get("duracion") ?? 60);
  const cupo = Number(formData.get("cupo") ?? 10);

  if (!servicioId || !profesionalId || !fecha || !hora) return;

  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  if (!anio || !mes || !dia) return;
  const inicio = horaChileAUtc(anio, mes, dia, hh ?? 0, mm ?? 0);
  const fin = new Date(inicio.getTime() + duracion * 60_000);

  await crearClase({
    clienteId: usuario.clienteId,
    servicioId,
    profesionalId,
    inicio,
    fin,
    cupoMaximo: cupo,
  });
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
}

/** Genera la parrilla de varias semanas. */
export async function generarSerieAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return;

  const dias = (formData.getAll("dias") as string[]).map(Number).filter((n) => !isNaN(n));
  if (!dias.length) return;

  await generarSerie({
    clienteId: usuario.clienteId,
    servicioId: String(formData.get("servicioId") ?? ""),
    profesionalId: String(formData.get("profesionalId") ?? ""),
    diasSemana: dias,
    hora: String(formData.get("hora") ?? "19:00"),
    duracionMin: Number(formData.get("duracion") ?? 60),
    cupoMaximo: Number(formData.get("cupo") ?? 10),
    semanas: Math.min(12, Number(formData.get("semanas") ?? 4)),
  });
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
}

/** Cancela una sesión completa. */
export async function cancelarClaseAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return;
  const claseId = String(formData.get("claseId") ?? "");
  if (!claseId) return;
  await cancelarClase(usuario.clienteId, claseId);
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
}

/** Obtiene el detalle de inscritos de una clase. */
export async function obtenerDetalleClaseAccion(claseId: string) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return null;
  return obtenerDetalleClaseOperacional(usuario.clienteId, claseId);
}

/** Inscribe manualmente a un alumno. */
export async function inscribirAlumnoManualAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const claseId = String(formData.get("claseId") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  const telefono = String(formData.get("telefono") ?? "").trim();

  if (!claseId || !nombre) {
    return { ok: false, error: "Faltan datos obligatorios." };
  }

  const supa = db();

  // Buscar o crear contacto en ed_contactos para mantener contacto_id canónico
  let contactoId: string | null = null;
  if (telefono) {
    const { data: contactoExistente } = await supa
      .from("ed_contactos")
      .select("id")
      .eq("cliente_id", usuario.clienteId)
      .eq("telefono", telefono)
      .maybeSingle();

    if (contactoExistente) {
      contactoId = contactoExistente.id;
    } else {
      const { data: nuevoContacto } = await supa
        .from("ed_contactos")
        .insert({
          cliente_id: usuario.clienteId,
          nombre,
          telefono,
          origen: "manual",
        })
        .select("id")
        .single();
      if (nuevoContacto) contactoId = nuevoContacto.id;
    }
  }

  if (contactoId) {
    const resCredito = await inscribirConCredito({
      clienteId: usuario.clienteId,
      contactoId,
      claseId,
      nombre,
      telefono,
      origen: "portal",
      supa,
    });

    if (resCredito.ok) {
      revalidatePath("/agenda/clases");
      revalidatePath("/agenda");
      return { ok: true };
    }

    if (resCredito.motivo === "cupo_agotado") {
      return { ok: false, error: "La clase ya no tiene cupos disponibles." };
    }
  }

  // Fallback de inscripción directa en ed_citas si no tiene membresía
  const { data: clase } = await supa
    .from("ed_clases")
    .select("id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado")
    .eq("id", claseId)
    .eq("cliente_id", usuario.clienteId)
    .single();

  if (!clase || (clase.cupo_ocupado >= clase.cupo_maximo)) {
    return { ok: false, error: "Clase sin cupo disponible." };
  }

  const { error: errCita } = await supa.from("ed_citas").insert({
    cliente_id: usuario.clienteId,
    servicio_id: clase.servicio_id,
    profesional_id: clase.profesional_id,
    clase_id: clase.id,
    contacto_id: contactoId,
    nombre_contacto: nombre,
    telefono: telefono || null,
    inicio: clase.inicio,
    fin: clase.fin,
    estado: "confirmada",
    origen: "portal",
  });

  if (errCita) return { ok: false, error: errCita.message };

  await supa
    .from("ed_clases")
    .update({ cupo_ocupado: clase.cupo_ocupado + 1, actualizado_en: new Date().toISOString() })
    .eq("id", claseId);

  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return { ok: true };
}

/** Cancela la inscripción de un alumno. */
export async function cancelarInscripcionAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const citaId = String(formData.get("citaId") ?? "");
  const contactoId = formData.get("contactoId") ? String(formData.get("contactoId")) : undefined;

  if (!citaId) return { ok: false, error: "ID de cita requerido" };

  const res = await cancelarInscripcionCredito({
    clienteId: usuario.clienteId,
    citaId,
    contactoId,
    motivo: "Cancelado desde el portal de operaciones",
  });

  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return { ok: res.ok };
}

/** Marca asistencia de un alumno (vino). */
export async function marcarAsistenciaAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const citaId = String(formData.get("citaId") ?? "");
  if (!citaId) return { ok: false, error: "ID de cita requerido" };

  const res = await marcarAsistenciaCita(usuario.clienteId, citaId);
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return res;
}

/** Registra no-show de un alumno (no llegó). */
export async function marcarNoShowAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const citaId = String(formData.get("citaId") ?? "");
  if (!citaId) return { ok: false, error: "ID de cita requerido" };

  const res = await registrarNoShow({
    clienteId: usuario.clienteId,
    citaId,
    notas: "Inasistencia registrada por staff",
  });
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return res;
}
