/**
 * ¿Este correo es del equipo de Respondo (no de un negocio cliente)?
 *
 * Existe para /estado: el diagnóstico muestra conteos de TODOS los negocios y el
 * estado de los procesos internos. Antes bastaba cualquier sesión del portal,
 * así que el staff de un negocio veía cuántos clientes tiene Respondo.
 *
 * Lista en la variable RESPONDO_ADMIN_EMAILS, separada por comas. Sin la
 * variable no hay administradores: falla cerrado.
 */
export function esAdminRespondo(email: string | null | undefined, lista = process.env.RESPONDO_ADMIN_EMAILS): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !lista) return false;
  return lista
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}
