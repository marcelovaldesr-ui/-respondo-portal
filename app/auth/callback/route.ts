import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Destino del enlace mágico enviado por correo (flujo PKCE): canjea el código
 * por una sesión y manda al portal.
 *
 * Mismo patrón de cookies que /auth/verificar: se escriben sobre el objeto de
 * respuesta que se devuelve, no con cookies() de next/headers.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const destino = searchParams.get("volver") ?? "/inicio";

  if (!code) {
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return respuesta;
}
