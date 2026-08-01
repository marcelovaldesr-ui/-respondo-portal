import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { oauthConfigurado, urlAutorizacion, firmarEstado } from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

/**
 * PASO 1 del botón "Conectar Google Calendar": redirige al dueño a la
 * pantalla de consentimiento de Google para SU cuenta y SU profesional.
 *
 * GET /api/google/conectar?profesional=<uuid>
 *
 * Exige sesión de portal (no es un webhook público) y confirma que el
 * profesional pedido pertenece al cliente logueado — sin esto, alguien
 * podría intentar conectar su Google Calendar al profesional de OTRO
 * negocio con solo cambiar el uuid de la URL.
 */
export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.redirect(new URL("/login", req.url));

  if (!oauthConfigurado()) {
    return NextResponse.redirect(new URL("/agenda/configuracion?gcal_oauth=sin_configurar", req.url));
  }

  const profesionalId = req.nextUrl.searchParams.get("profesional");
  if (!profesionalId) return NextResponse.redirect(new URL("/agenda/configuracion", req.url));

  const { data } = await db()
    .from("ed_profesionales")
    .select("id")
    .eq("id", profesionalId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!data) return NextResponse.redirect(new URL("/agenda/configuracion", req.url));

  const estado = firmarEstado({ profesionalId, clienteId: usuario.clienteId });
  return NextResponse.redirect(urlAutorizacion(estado));
}
