import type { UsuarioPortal } from "@/lib/auth";

export type PermisoPortal =
  | "operar_conversaciones"
  | "editar_clientes"
  | "gestionar_embudo"
  | "operar_agenda"
  | "configurar_agenda"
  | "editar_conocimiento"
  | "generar_insights"
  | "gestionar_integraciones"
  /**
   * Preguntarle a Isabel. Queda FUERA de STAFF a propósito: para responder,
   * Isabel lee el historial completo de conversaciones del negocio —reclamos,
   * precios, lo que un cliente dijo de otro— y eso es del dueño, no de quien
   * atiende el mesón. No es jerarquía, es alcance de lectura.
   */
  | "preguntar_isabel"
  /**
   * Aprobar mensajes PAGADOS de Beto (~$85 cada uno, plantilla de marketing).
   * Solo dueño (Fase 0, 11-sep-2026): es una decisión de gasto, no de operación.
   * El staff puede ver y descartar propuestas, pero no aprobarlas.
   */
  | "aprobar_mensajes_pagados";

/**
 * LOS ÚNICOS ROLES QUE EXISTEN. Espejo exacto del `check` de la columna
 * `portal_usuarios.rol` en la base. Si algún día se agrega un rol en SQL hay
 * que agregarlo acá también: hasta entonces, ese rol no entra al portal.
 *
 * Eso es deliberado. La alternativa —que un rol desconocido caiga en la rama
 * por defecto— es cómo un `'lector'` recién creado termina con permiso para
 * escribir en conversaciones sin que nadie lo haya decidido.
 */
export const ROLES = ["dueno", "staff"] as const;
export type RolPortal = (typeof ROLES)[number];

export function esRolValido(valor: unknown): valor is RolPortal {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

const TODOS: readonly PermisoPortal[] = [
  "operar_conversaciones",
  "editar_clientes",
  "gestionar_embudo",
  "operar_agenda",
  "configurar_agenda",
  "editar_conocimiento",
  "generar_insights",
  "gestionar_integraciones",
  "preguntar_isabel",
  "aprobar_mensajes_pagados",
];

/**
 * Matriz pequeña y CERRADA: dueño administra; staff opera el día a día.
 *
 * Cerrada quiere decir que cada rol enumera lo que puede, en vez de que unos
 * pocos permisos se resten de «todo». Con la forma anterior
 * —`rol === "dueno" || STAFF.has(permiso)`— cualquier valor que no fuera
 * literalmente "dueno" recibía en silencio los permisos de staff, incluidos
 * los de escritura. Hoy el `check` de la base impide que llegue un valor así;
 * esta matriz hace que tampoco importe si mañana no lo impide.
 */
const MATRIZ: Readonly<Record<RolPortal, ReadonlySet<PermisoPortal>>> = {
  dueno: new Set(TODOS),
  staff: new Set<PermisoPortal>([
    "operar_conversaciones",
    "editar_clientes",
    "gestionar_embudo",
    "operar_agenda",
  ]),
};

export function tienePermiso(
  usuario: Pick<UsuarioPortal, "rol">,
  permiso: PermisoPortal,
): boolean {
  const permisos = esRolValido(usuario.rol) ? MATRIZ[usuario.rol] : null;
  return permisos ? permisos.has(permiso) : false;
}
