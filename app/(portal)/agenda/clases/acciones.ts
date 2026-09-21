"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { commerceActivoParaCliente } from "@/lib/commerce/featureFlag";
import { horaChileAUtc } from "@/lib/agendaCore";
import { crearClase, generarSerie, cancelarClase, inscribirEnClase } from "@/lib/clases";
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

async function obtenerUsuarioCommerce() {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario || !(await commerceActivoParaCliente(usuario.clienteId))) return null;
  return usuario;
}

/**
 * Acciones del portal para las clases grupales.
 */

/** Crea una sesión suelta. */
export async function crearClaseAccion(formData: FormData) {
  const usuario = await obtenerUsuarioCommerce();
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
  const usuario = await obtenerUsuarioCommerce();
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
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return;
  const claseId = String(formData.get("claseId") ?? "");
  if (!claseId) return;
  await cancelarClase(usuario.clienteId, claseId);
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
}

/** Obtiene el detalle de inscritos de una clase. */
export async function obtenerDetalleClaseAccion(claseId: string) {
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return null;
  return obtenerDetalleClaseOperacional(usuario.clienteId, claseId);
}

/** Inscribe manualmente a un alumno. */
export async function inscribirAlumnoManualAccion(formData: FormData) {
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return { ok: false, error: "Commerce no está habilitado para este negocio." };

  const claseId = String(formData.get("claseId") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  const telefono = String(formData.get("telefono") ?? "").trim();

  if (!claseId || !nombre || !telefono) {
    return { ok: false, error: "Faltan datos obligatorios." };
  }

  const supa = db();
  const chatId = telefono.replace(/\D/g, "");
  if (!chatId) return { ok: false, error: "Ingresa un teléfono válido." };

  // Buscar o crear contacto en ed_contactos para mantener contacto_id canónico
  let contactoId: string | null = null;
  let contactoChatId: string | null = null;
  const { data: contactoPorTelefono } = await supa
      .from("ed_contactos")
      .select("id, chat_id")
      .eq("cliente_id", usuario.clienteId)
      .eq("telefono", telefono)
      .maybeSingle();

  const contactoExistente = contactoPorTelefono ?? (
    await supa
      .from("ed_contactos")
      .select("id, chat_id")
      .eq("cliente_id", usuario.clienteId)
      .eq("chat_id", chatId)
      .maybeSingle()
  ).data;

  if (contactoExistente) {
    contactoId = contactoExistente.id;
    contactoChatId = contactoExistente.chat_id;
  } else {
    const { data: nuevoContacto, error: errorContacto } = await supa
        .from("ed_contactos")
        .insert({
          cliente_id: usuario.clienteId,
          nombre,
          telefono,
          chat_id: chatId,
          origen: "manual",
        })
        .select("id, chat_id")
        .single();
    if (errorContacto || !nuevoContacto) {
      return { ok: false, error: "No se pudo crear la ficha del cliente. Intenta nuevamente." };
    }
    contactoId = nuevoContacto.id;
    contactoChatId = nuevoContacto.chat_id;
  }

  if (contactoId) {
    const resCredito = await inscribirConCredito({
      clienteId: usuario.clienteId,
      contactoId,
      claseId,
      nombre,
      telefono,
      chatId: contactoChatId ?? chatId,
      origen: "portal",
      supa,
    });

    if (resCredito.ok) {
      // La migración 320 agrega la identidad canónica a la cita. El update es
      // compatible con el breve período de despliegue en que aún no exista.
      await supa
        .from("ed_citas")
        .update({ contacto_id: contactoId })
        .eq("cliente_id", usuario.clienteId)
        .eq("id", resCredito.citaId);
      revalidatePath("/agenda/clases");
      revalidatePath("/agenda");
      return { ok: true };
    }

    if (resCredito.motivo !== "sin_membresia") {
      const mensajes = {
        membresia_vencida: "La membresía está vencida. Renueva el plan antes de inscribir.",
        sin_creditos: "La membresía no tiene créditos disponibles.",
        cupo_agotado: "La clase ya no tiene cupos disponibles.",
        ya_inscrito: "Este cliente ya está inscrito en la clase.",
        clase_no_existe: "La clase ya no existe o no pertenece a este negocio.",
        clase_cancelada: "La clase está cancelada.",
        clase_ya_paso: "No puedes inscribir en una clase que ya comenzó.",
        error: "No se pudo completar la inscripción. Intenta nuevamente.",
      } as const;
      return { ok: false, error: mensajes[resCredito.motivo] };
    }
  }

  // Los clientes sin membresía pueden inscribirse manualmente, pero el cupo
  // siempre se toma mediante el RPC atómico de clases.
  const resDirecto = await inscribirEnClase({
    clienteId: usuario.clienteId,
    claseId,
    nombre,
    telefono,
    chatId: contactoChatId ?? chatId,
    origen: "portal",
    supa,
  });

  if (!resDirecto.ok) {
    const mensajes = {
      no_existe: "La clase ya no existe o no pertenece a este negocio.",
      cancelada: "La clase está cancelada.",
      ya_paso: "No puedes inscribir en una clase que ya comenzó.",
      cupo_tomado: "La clase ya no tiene cupos disponibles.",
      ya_inscrito: "Este cliente ya está inscrito en la clase.",
      error: "No se pudo completar la inscripción. Intenta nuevamente.",
    } as const;
    return { ok: false, error: mensajes[resDirecto.motivo] };
  }

  await supa
    .from("ed_citas")
    .update({ contacto_id: contactoId })
    .eq("cliente_id", usuario.clienteId)
    .eq("id", resDirecto.citaId);

  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return { ok: true };
}

/** Cancela la inscripción de un alumno. */
export async function cancelarInscripcionAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return { ok: false, error: "Commerce no está habilitado para este negocio." };

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
  if (!res.ok) return { ok: false, error: "No se pudo cancelar la inscripción." };
  return { ok: true };
}

/** Marca asistencia de un alumno (vino). */
export async function marcarAsistenciaAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return { ok: false, error: "Commerce no está habilitado para este negocio." };

  const citaId = String(formData.get("citaId") ?? "");
  if (!citaId) return { ok: false, error: "ID de cita requerido" };

  const res = await marcarAsistenciaCita(usuario.clienteId, citaId);
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
  return res;
}

/** Registra no-show de un alumno (no llegó). */
export async function marcarNoShowAlumnoAccion(formData: FormData) {
  const usuario = await obtenerUsuarioCommerce();
  if (!usuario) return { ok: false, error: "Commerce no está habilitado para este negocio." };

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
