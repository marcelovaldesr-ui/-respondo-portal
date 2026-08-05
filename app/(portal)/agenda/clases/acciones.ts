"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { horaChileAUtc } from "@/lib/agendaCore";
import { crearClase, generarSerie, cancelarClase } from "@/lib/clases";

/**
 * Acciones del portal para las clases grupales.
 *
 * Todas resuelven el cliente desde la sesión, nunca desde el formulario: si el
 * cliente_id viajara en un campo oculto, cualquiera podría crearle clases al
 * negocio de al lado cambiando el HTML.
 */

/** Crea una sesión suelta ("este jueves hay una clase extra a las 20:00"). */
export async function crearClaseAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return;

  const servicioId = String(formData.get("servicioId") ?? "");
  const profesionalId = String(formData.get("profesionalId") ?? "");
  const fecha = String(formData.get("fecha") ?? ""); // yyyy-mm-dd
  const hora = String(formData.get("hora") ?? ""); // HH:mm
  const duracion = Number(formData.get("duracion") ?? 60);
  const cupo = Number(formData.get("cupo") ?? 10);

  if (!servicioId || !profesionalId || !fecha || !hora) return;

  // La hora la escribe una persona en Chile; la base guarda UTC. Convertir acá
  // y no en el navegador evita que el resultado dependa del reloj del equipo
  // desde el que se cargó.
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

/**
 * Genera la parrilla de varias semanas de un tirón.
 *
 * Es la acción que decide si la función se usa o no: un gimnasio con seis
 * clases al día tendría que crear 180 sesiones a mano cada mes, y no lo haría.
 */
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

/** Cancela una sesión. El trigger de la 260 devuelve los cupos solo. */
export async function cancelarClaseAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return;
  const claseId = String(formData.get("claseId") ?? "");
  if (!claseId) return;
  await cancelarClase(usuario.clienteId, claseId);
  revalidatePath("/agenda/clases");
  revalidatePath("/agenda");
}
