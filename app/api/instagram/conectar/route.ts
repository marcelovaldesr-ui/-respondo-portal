import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { instagramConfigurado, urlAutorizacionIg } from "@/lib/instagramOAuth";

export const dynamic = "force-dynamic";

/**
 * PASO 1 del botón "Conectar Instagram": manda al dueño al login de Instagram
 * para que autorice SU cuenta profesional.
 *
 * GET /api/instagram/conectar
 *
 * Exige sesión del portal. El cliente sale del `usuario`, NUNCA de la URL: si
 * viniera por parámetro, cualquiera podría colgar su Instagram de la cuenta de
 * otro negocio cambiando un uuid.
 */
export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return NextResponse.redirect(new URL("/login", req.url));

  if (!instagramConfigurado()) {
    return NextResponse.redirect(new URL("/whatsapp?ig=sin_configurar", req.url));
  }

  return NextResponse.redirect(urlAutorizacionIg(usuario.clienteId));
}
