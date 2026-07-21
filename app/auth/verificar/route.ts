import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Valida un enlace de acceso por `token_hash` (flujo del lado del servidor).
 * Sirve para enlaces generados desde el admin de Supabase, sin pasar por correo
 * — útil cuando el envío de mails está bloqueado por límite de tasa.
 *
 * IMPORTANTE — patrón de cookies: la cookie de sesión se escribe SOBRE el objeto
 * `respuesta` que se va a devolver, no con cookies() de next/headers. Al redirigir
 * se crea una respuesta nueva y las cookies escritas por fuera pueden perderse,
 * dejando al usuario "autenticado" pero sin sesión: vuelve al login sin explicación.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "magiclink") as EmailOtpType;
  const destino = searchParams.get("volver") ?? "/inicio";

  if (!token_hash) {
    return NextResponse.redirect(`${origin}/login?error=enlace-invalido`);
  }

  const respuesta = NextResponse.redirect(`${origin}${destino}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => request.cookies.get(name)?.value,
        set: (name: string, value: string, options: Record<string, unknown>) =>
          respuesta.cookies.set({ name, value, ...options }),
        remove: (name: string, options: Record<string, unknown>) =>
          respuesta.cookies.set({ name, value: "", ...options }),
      },
    },
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });

  if (error) {
    // Se propaga el motivo real: sin esto, un enlace vencido se veía como
    // "no pasó nada" y era imposible diagnosticar.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return respuesta;
}
