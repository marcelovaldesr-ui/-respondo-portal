import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase Auth para el SERVIDOR (Server Components y Route
 * Handlers). Importa `next/headers`, así que este módulo NUNCA debe importarse
 * desde un componente "use client" — para el navegador está
 * lib/supabaseNavegador.ts.
 *
 * OJO — dos llaves distintas y no se mezclan:
 *  - Acá se usa la llave PUBLICABLE (anon): solo sirve para saber QUIÉN está
 *    logueado.
 *  - `lib/db.ts` usa la llave SECRETA (service role): es la que lee los datos
 *    del negocio, siempre filtrando por cliente_id.
 */
export function supabaseServidor() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  const store = cookies();
  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        // En Server Components no se puede escribir cookie: lo hace el middleware.
        try {
          store.set({ name, value, ...options });
        } catch {
          /* no-op */
        }
      },
      remove(name: string, options: Record<string, unknown>) {
        try {
          store.set({ name, value: "", ...options });
        } catch {
          /* no-op */
        }
      },
    },
  });
}
