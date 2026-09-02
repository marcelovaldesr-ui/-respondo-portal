"use server";

import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { limitarDistribuido } from "@/lib/seguridad";
import { enviarInformeFidelizacion } from "@/lib/fidelizacion";

/**
 * ENVIAR EL INFORME DE FIDELIZACIÓN AL WHATSAPP DEL DUEÑO.
 *
 * Punto 2 del "orden acordado" de la auditoría de agosto: la razón por la que
 * se construyó es que cuando la decisión de RS-Shop subió a gerencia, Gaspar
 * no tenía un solo número que reenviar. Este botón es justo eso — sale del
 * portal y llega listo para reenviar, sin que nadie tenga que copiar números
 * a mano de una pantalla.
 *
 * Permiso "generar_insights": es dueño-only, igual que el informe semanal con
 * IA — un reporte para gerencia no lo dispara cualquiera del equipo.
 */
export async function enviarInformeFidelizacionAccion(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  if (!(await limitarDistribuido(`informe-fid:${usuario.email}`, 5, 60)).ok) {
    return { ok: false, error: "Ya lo enviaste hace un momento. Espera un poco." };
  }

  return enviarInformeFidelizacion(usuario.clienteId);
}
