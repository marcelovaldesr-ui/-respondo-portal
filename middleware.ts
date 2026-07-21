import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const RUTAS_PROTEGIDAS = ["/inicio", "/conversaciones", "/probar", "/informacion"];

/**
 * Refresca la sesión de Supabase en cada request (las cookies de auth solo se
 * pueden escribir acá, no en Server Components) y bloquea las rutas del portal
 * a quien no tenga sesión.
 *
 * La AUTORIZACIÓN por cliente no se hace acá sino en lib/auth.ts, que es la que
 * consulta portal_usuarios. El middleware solo verifica que haya sesión.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: Record<string, unknown>) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esProtegida = RUTAS_PROTEGIDAS.some((r) => ruta.startsWith(r));

  if (esProtegida && !user) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.searchParams.set("volver", ruta);
    return NextResponse.redirect(destino);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
