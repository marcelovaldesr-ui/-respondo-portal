import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase Auth para el NAVEGADOR (componentes "use client").
 *
 * Vive en un archivo aparte de supabaseAuth.ts a propósito: ese importa
 * `next/headers`, que solo existe en el servidor. Si ambos clientes conviven en
 * el mismo módulo, importar el del navegador arrastra `next/headers` al bundle
 * del cliente y Next falla al compilar. No volver a juntarlos.
 *
 * Usa la llave publicable (anon), que es pública por diseño.
 */
export function supabaseNavegador() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, key);
}
