import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Valida un enlace de acceso por `token_hash` (flujo del lado del SERVIDOR, sin
 * PKCE). Es el flujo recomendado para SSR: funciona desde CUALQUIER dispositivo
 * o app de correo, porque no depende de una "llave" guardada en el navegador que
 * pidió el enlace (eso es lo que rompía el login desde el celular).
 *
 * Robustez: el `type` del enlace puede venir como "magiclink", "email" o
 * "recovery" según cómo se generó. Probamos el que llega y, si falla, hacemos
 * fallback entre magiclink/email — así un desajuste de plantilla no bloquea el
 * acceso.
 *
 * IMPORTANTE — patrón de cookies: la cookie de sesión se escribe SOBRE el objeto
 * `respuesta` que se devuelve, no con cookies() de next/headers.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const typeUrl = (searchParams.get("type") ?? "magiclink") as EmailOtpType;
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

  // Orden de intento: el tipo del enlace primero, luego los alternativos.
  const tipos: EmailOtpType[] = Array.from(
    new Set<EmailOtpType>([typeUrl, "magiclink", "email"]),
  );

  let ultimoError = "";
  for (const type of tipos) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) return respuesta; // sesión creada
    ultimoError = error.message;
    // Si el token ya se consumió o expiró, no tiene sentido probar otros tipos.
    if (/expired|invalid|not found|consumed|already/i.test(error.message)) break;
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(ultimoError || "enlace-invalido")}`,
  );
}
