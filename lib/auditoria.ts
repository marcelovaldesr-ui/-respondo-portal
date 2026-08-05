import { createHash } from "crypto";
import type { UsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";

/** Registro best-effort: nunca bloquea la acción que intenta observar. */
export async function auditarAccion(
  usuario: Pick<UsuarioPortal, "clienteId" | "email" | "rol">,
  accion: string,
  opciones: { recursoId?: string; requestId?: string; metadata?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  const actorHash = createHash("sha256").update(usuario.email.toLowerCase()).digest("hex");
  try {
    const { error } = await db().from("ed_auditoria_portal").insert({
      cliente_id: usuario.clienteId,
      actor_hash: actorHash,
      actor_rol: usuario.rol,
      accion: accion.slice(0, 100),
      recurso_id: opciones.recursoId?.slice(0, 200) ?? null,
      request_id: opciones.requestId?.slice(0, 100) ?? null,
      metadata: opciones.metadata ?? {},
    });
    if (error) throw error;
  } catch (error) {
    console.error("[auditoria] no se pudo registrar:", (error as Error).message);
  }
}

export async function auditarSistema(
  clienteId: string,
  accion: string,
  recursoId?: string,
): Promise<void> {
  try {
    const { error } = await db().from("ed_auditoria_portal").insert({
      cliente_id: clienteId,
      actor_hash: null,
      actor_rol: "sistema",
      accion: accion.slice(0, 100),
      recurso_id: recursoId?.slice(0, 200) ?? null,
    });
    if (error) throw error;
  } catch (error) {
    console.error("[auditoria] no se pudo registrar:", (error as Error).message);
  }
}
