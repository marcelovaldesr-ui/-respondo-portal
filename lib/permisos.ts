import type { UsuarioPortal } from "@/lib/auth";

export type PermisoPortal =
  | "operar_conversaciones"
  | "editar_clientes"
  | "gestionar_embudo"
  | "operar_agenda"
  | "configurar_agenda"
  | "editar_conocimiento"
  | "generar_insights"
  | "gestionar_integraciones";

const STAFF: ReadonlySet<PermisoPortal> = new Set([
  "operar_conversaciones",
  "editar_clientes",
  "gestionar_embudo",
  "operar_agenda",
]);

/** Matriz pequeña y cerrada: dueño administra; staff opera el día a día. */
export function tienePermiso(
  usuario: Pick<UsuarioPortal, "rol">,
  permiso: PermisoPortal,
): boolean {
  return usuario.rol === "dueno" || STAFF.has(permiso);
}
