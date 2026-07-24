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
 *
 * FLUJO IMPLICIT (24-jul-2026): usamos flowType "implicit" en vez de PKCE. El
 * PKCE guarda una "llave" en el navegador que PIDE el enlace, así que abrir el
 * enlace en otro navegador/celular (o en el navegador interno del correo) fallaba
 * con "PKCE code verifier not found". Con implicit, el enlace trae la sesión en
 * el fragmento de la URL y funciona desde CUALQUIER dispositivo. La sesión se
 * procesa en /auth/entrar (página cliente) y se guarda en cookies para el SSR.
 */
export function supabaseNavegador() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
