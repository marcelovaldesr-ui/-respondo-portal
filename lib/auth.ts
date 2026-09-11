import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { supabaseServidor } from "@/lib/supabaseAuth";
import { esRolValido, tienePermiso, type PermisoPortal, type RolPortal } from "@/lib/permisos";

export type UsuarioPortal = {
  email: string;
  clienteId: string;
  clienteNombre: string;
  clienteRubro: string;
  rol: RolPortal;
};

/**
 * NÚCLEO DE SEGURIDAD DEL PORTAL.
 *
 * Traduce "quién inició sesión" (email verificado por Supabase Auth) a "qué
 * cliente puede ver" (cliente_id en portal_usuarios). TODA consulta de datos
 * del portal debe filtrarse por el clienteId que devuelve esta función.
 *
 * Un email con sesión válida pero sin fila en portal_usuarios NO tiene acceso:
 * autenticado != autorizado.
 */
export async function obtenerUsuarioPortal(): Promise<UsuarioPortal | null> {
  const auth = await supabaseServidor();
  const {
    data: { user },
  } = await auth.auth.getUser();

  const email = user?.email?.toLowerCase().trim();
  if (!email) return null;

  const { data, error } = await db()
    .from("portal_usuarios")
    .select("cliente_id, rol, activo, ed_clientes ( nombre, rubro )")
    .eq("email", email)
    .eq("activo", true)
    .maybeSingle();

  if (error || !data) return null;

  // FAIL CLOSED. Antes esta línea decía `(data.rol as "dueno" | "staff") ?? "dueno"`:
  // un `as` no valida nada en tiempo de ejecución —solo silencia al compilador— y
  // el `??` convertía la ausencia de dato en el rol MÁS privilegiado del portal.
  // Hoy la columna es `not null check (rol in ('dueno','staff'))`, así que ninguna
  // de las dos ramas llega a ejecutarse; el problema era que la seguridad
  // dependiera de eso sin decirlo. Un rol que no reconocemos no es un rol con
  // menos permisos: es un dato de autorización roto, y no abre sesión.
  if (!esRolValido(data.rol)) {
    console.error(
      JSON.stringify({
        evento: "auth.rol_invalido",
        email,
        cliente: data.cliente_id,
        rol: typeof data.rol === "string" ? data.rol.slice(0, 40) : String(data.rol),
      }),
    );
    return null;
  }

  const cliente = data.ed_clientes as unknown as {
    nombre: string;
    rubro: string;
  } | null;

  return {
    email,
    clienteId: data.cliente_id as string,
    clienteNombre: cliente?.nombre ?? "Tu negocio",
    clienteRubro: cliente?.rubro ?? "",
    rol: data.rol,
  };
}

/** Igual que la anterior, pero corta el paso: usar en toda página del portal. */
export async function exigirUsuarioPortal(): Promise<UsuarioPortal> {
  const auth = await supabaseServidor();
  const {
    data: { user },
  } = await auth.auth.getUser();

  // Sin sesión -> al login.
  if (!user?.email) redirect("/login");

  const usuario = await obtenerUsuarioPortal();
  // Con sesión pero sin autorización -> pantalla explicativa (no al login, o
  // quedaría en un loop: la sesión existe pero el email no está habilitado).
  if (!usuario) redirect("/sin-acceso");

  return usuario;
}

/** Igual que exigirUsuarioPortal, pero exige además una capacidad del rol. */
export async function exigirPermisoPortal(permiso: PermisoPortal): Promise<UsuarioPortal> {
  const usuario = await exigirUsuarioPortal();
  if (!tienePermiso(usuario, permiso)) redirect("/sin-permiso");
  return usuario;
}

/** Para Route Handlers/Server Actions que deben responder sin redirigir. */
export async function obtenerUsuarioConPermiso(
  permiso: PermisoPortal,
): Promise<UsuarioPortal | null> {
  const usuario = await obtenerUsuarioPortal();
  return usuario && tienePermiso(usuario, permiso) ? usuario : null;
}
