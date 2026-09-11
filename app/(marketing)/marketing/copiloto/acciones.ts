"use server";

import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { preguntarAlCopiloto } from "@/lib/marketing/copiloto";
import type { RespuestaCopiloto, TurnoCopiloto } from "@/lib/marketing/copilotoCore";
import { modoDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";

/**
 * Una pregunta al copiloto. La sesión decide el negocio; el cliente solo
 * manda la pregunta, el período y los últimos turnos (para el contexto).
 */
export async function preguntarAccion(entrada: {
  pregunta: string;
  periodo: string;
  hilo: TurnoCopiloto[];
}): Promise<{ ok: true; datos: RespuestaCopiloto } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const pregunta = entrada.pregunta.trim().slice(0, 600);
  if (!pregunta) return { ok: false, motivo: "Escribe una pregunta." };
  const topado = await cupoDisponible(usuario.clienteId, "copiloto");
  if (topado) return { ok: false, motivo: topado };
  const demo = await modoDemo();
  return preguntarAlCopiloto({
    clienteId: usuario.clienteId,
    pregunta,
    periodo: entrada.periodo,
    hilo: entrada.hilo.slice(-4),
    demo,
  });
}
