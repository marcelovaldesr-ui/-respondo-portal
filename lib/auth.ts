import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { supabaseServidor } from "@/lib/supabaseAuth";
import { tienePermiso, type PermisoPortal } from "@/lib/permisos";

export type UsuarioPortal = {
  email: string;
  clienteId: string;
  clienteNombre: string;
  clienteRubro: string;
  rol: "dueno" | "staff";
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

  const cliente = data.ed_clientes as unknown as {
    nombre: string;
    rubro: string;
  } | null;

  return {
    email,
    clienteId: data.cliente_id as string,
    clienteNombre: cliente?.nombre ?? "Tu negocio",
    clienteRubro: cliente?.rubro ?? "",
    rol: (data.rol as "dueno" | "staff") ?? "dueno",
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
