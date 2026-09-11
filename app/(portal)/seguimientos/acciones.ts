"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { aprobarPropuesta, rechazarPropuesta } from "@/lib/propuestasSeguimiento";

/**
 * APROBAR O RECHAZAR LO QUE BETO PROPONE ESCRIBIR.
 *
 * ⚠️ EL `clienteId` SALE DE LA SESIÓN, NUNCA DEL FORMULARIO (regla de la casa).
 * Acá importa más que en otras pantallas: aprobar dispara un mensaje pagado a
 * un número real, así que un formulario manipulado no puede poder hacer que un
 * negocio le escriba a los clientes de otro.
 */

export async function aprobar(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string; retirar?: boolean }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_embudo");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const propuestaId = String(formData.get("propuestaId") ?? "");
  if (!propuestaId) return { ok: false, error: "Faltan datos" };

  const r = await aprobarPropuesta({
    clienteId: usuario.clienteId,
    propuestaId,
    negocio: usuario.clienteNombre,
    email: usuario.email,
  });
  revalidatePath("/seguimientos");
  return r;
}

export async function rechazar(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_embudo");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const propuestaId = String(formData.get("propuestaId") ?? "");
  if (!propuestaId) return { ok: false, error: "Faltan datos" };

  const r = await rechazarPropuesta({
    clienteId: usuario.clienteId,
    propuestaId,
    email: usuario.email,
  });
  revalidatePath("/seguimientos");
  return r;
}
