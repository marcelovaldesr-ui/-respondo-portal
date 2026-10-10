import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const RUTAS_PROTEGIDAS = [
  "/inicio",
  "/conversaciones",
  "/clientes",
  "/embudo",
  "/analitica",
  "/insights",
  "/agenda",
  "/probar",
  "/informacion",
  "/whatsapp",
  "/cobros",
];

/** Refresca la sesión y hace únicamente el control optimista de autenticación. */
export async function proxy(request: NextRequest) {
  // La ruta viaja como cabecera de la petición para que el layout del portal
  // pueda decidir (cuentas de «solo mensajería», migración 322) sin leer la URL.
  const cabeceras = new Headers(request.headers);
  cabeceras.set("x-ruta", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: cabeceras } });
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
  if (RUTAS_PROTEGIDAS.some((r) => ruta.startsWith(r)) && !user) {
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
