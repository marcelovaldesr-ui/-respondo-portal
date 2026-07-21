import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase de servidor (service_role). SOLO usar en Server Components
 * o API routes — nunca se importa desde un componente "use client".
 *
 * El acceso multi-cliente se enforcea EN CÓDIGO: toda query del portal se filtra
 * por el cliente_id del usuario logueado (resuelto vía portal_usuarios en el
 * Paso 2). La service role no llega jamás al navegador.
 *
 * fetch con cache "no-store" (mismo patrón que respondo-hq): sin esto, las
 * páginas server-side quedan congeladas con los datos del deploy.
 */
export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
