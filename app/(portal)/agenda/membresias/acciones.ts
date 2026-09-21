"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { commerceActivoParaCliente } from "@/lib/commerce/featureFlag";
import {
  obtenerDetalleMembresiaOperacional,
  ajusteManualCreditos,
  renovarMembresiaManual,
} from "@/lib/memberships/membershipsOperations";

/**
 * Acciones de servidor para la gestión operacional de membresías.
 */

export async function obtenerDetalleMembresiaAccion(membresiaId: string) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario || !(await commerceActivoParaCliente(usuario.clienteId))) return null;
  return obtenerDetalleMembresiaOperacional(usuario.clienteId, membresiaId);
}

export async function ajusteManualCreditosAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario || !(await commerceActivoParaCliente(usuario.clienteId))) {
    return { ok: false, error: "Commerce no está habilitado para este negocio." };
  }

  const membresiaId = String(formData.get("membresiaId") ?? "");
  const delta = Number(formData.get("delta") ?? 0);
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!membresiaId || isNaN(delta) || delta === 0) {
    return { ok: false, error: "Datos de ajuste inválidos." };
  }

  if (!motivo) {
    return { ok: false, error: "El motivo del ajuste manual es obligatorio." };
  }

  const res = await ajusteManualCreditos({
    clienteId: usuario.clienteId,
    membresiaId,
    delta,
    motivo,
  });

  revalidatePath("/agenda/membresias");
  revalidatePath("/agenda");
  const detalle = res.ok
    ? await obtenerDetalleMembresiaOperacional(usuario.clienteId, membresiaId)
    : null;
  return { ...res, detalle };
}

export async function renovarMembresiaAccion(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_agenda");
  if (!usuario || !(await commerceActivoParaCliente(usuario.clienteId))) {
    return { ok: false, error: "Commerce no está habilitado para este negocio." };
  }

  const membresiaId = String(formData.get("membresiaId") ?? "");
  if (!membresiaId) return { ok: false, error: "Membresía no especificada." };

  const res = await renovarMembresiaManual({
    clienteId: usuario.clienteId,
    membresiaId,
  });

  revalidatePath("/agenda/membresias");
  revalidatePath("/agenda");
  return res;
}
