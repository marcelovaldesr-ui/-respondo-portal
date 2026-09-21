"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import {
  buscarClientesOperacionales,
  obtenerFichaClienteOperacional,
} from "@/lib/clients/clientsOperations";
import {
  ajusteManualCreditos,
  renovarMembresiaManual,
} from "@/lib/memberships/membershipsOperations";

export async function buscarClientesAccion(busqueda: string) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return [];
  return buscarClientesOperacionales(usuario.clienteId, busqueda);
}

export async function obtenerFichaClienteAccion(contactoId: string) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return null;
  return obtenerFichaClienteOperacional(usuario.clienteId, contactoId);
}

export async function ajusteManualCreditosClienteAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const membresiaId = String(formData.get("membresiaId") ?? "");
  const delta = Number(formData.get("delta") ?? 0);
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!membresiaId || isNaN(delta) || delta === 0) {
    return { ok: false, error: "Datos de ajuste inválidos." };
  }

  if (!motivo) {
    return { ok: false, error: "El motivo del ajuste es obligatorio." };
  }

  const res = await ajusteManualCreditos({
    clienteId: usuario.clienteId,
    membresiaId,
    delta,
    motivo,
  });

  revalidatePath("/agenda/clientes");
  revalidatePath("/agenda/membresias");
  revalidatePath("/agenda");
  return res;
}

export async function renovarMembresiaClienteAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario) return { ok: false, error: "No autorizado" };

  const membresiaId = String(formData.get("membresiaId") ?? "");
  if (!membresiaId) return { ok: false, error: "Membresía no especificada." };

  const res = await renovarMembresiaManual({
    clienteId: usuario.clienteId,
    membresiaId,
  });

  revalidatePath("/agenda/clientes");
  revalidatePath("/agenda/membresias");
  revalidatePath("/agenda");
  return res;
}
