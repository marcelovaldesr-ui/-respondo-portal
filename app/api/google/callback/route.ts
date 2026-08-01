import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verificarEstado, intercambiarCodigo, cifrarRefreshToken } from "@/lib/googleOAuth";

export const dynamic = "force-dynamic";

/**
 * PASO 2 del botón "Conectar Google Calendar": acá vuelve Google después de
 * que el dueño apretó "Permitir" (o "Cancelar").
 *
 * GET /api/google/callback?code=...&state=...   (éxito)
 * GET /api/google/callback?error=access_denied  (el dueño canceló)
 *
 * Esta ruta NO tiene sesión de portal disponible (Google no la reenvía) — la
 * única barrera contra que alguien fabrique una llamada falsa es el `state`
 * firmado que se generó en /api/google/conectar. Por eso todo el resultado
 * (éxito o error) se comunica de vuelta como un query param legible en
 * /agenda/configuracion, nunca como un error crudo en esta URL.
 */
export async function GET(req: NextRequest) {
  const destino = new URL("/agenda/configuracion", req.url);

  const errorGoogle = req.nextUrl.searchParams.get("error");
  if (errorGoogle) {
    destino.searchParams.set("gcal_oauth", "cancelado");
    return NextResponse.redirect(destino);
  }

  const code = req.nextUrl.searchParams.get("code");
  const estadoRaw = req.nextUrl.searchParams.get("state");
  const estado = estadoRaw ? verificarEstado(estadoRaw) : null;
  if (!code || !estado) {
    destino.searchParams.set("gcal_oauth", "error");
    return NextResponse.redirect(destino);
  }

  const r = await intercambiarCodigo(code);
  if (!r.ok) {
    console.error("[google/callback] intercambio falló:", r.motivo);
    destino.searchParams.set("gcal_oauth", "error");
    return NextResponse.redirect(destino);
  }

  const { error } = await db()
    .from("ed_profesionales")
    .update({
      gcal_modo: "oauth",
      gcal_oauth_refresh_cifrado: cifrarRefreshToken(r.datos.refreshToken),
      gcal_oauth_email: r.datos.email,
      gcal_sync: true,
      gcal_ultimo_error: null,
      gcal_ultima_sync: new Date().toISOString(),
    })
    // doble filtro: además del id, el cliente_id que viaja en el `state`
    // firmado — así ni un state válido de OTRO cliente podría reasignar un
    // profesional que no es suyo.
    .eq("id", estado.profesionalId)
    .eq("cliente_id", estado.clienteId);

  if (error) {
    console.error("[google/callback] no se pudo guardar:", error.message);
    destino.searchParams.set("gcal_oauth", "error");
    return NextResponse.redirect(destino);
  }

  destino.searchParams.set("gcal_oauth", "ok");
  return NextResponse.redirect(destino);
}
