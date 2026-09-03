import { createClient } from "@supabase/supabase-js";
import { envolverSoloLectura } from "./dbSoloLectura.mjs";

/**
 * Cliente Supabase de PRODUCCIÓN, envuelto en solo lectura (ver dbSoloLectura.mjs).
 *
 * Usa las MISMAS variables que el portal en producción (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY) — normalmente las de `.env.local`, que ya están
 * fuera del repo (.gitignore: `.env*.local`). No hay una base de pruebas
 * separada: así lo pidió Marcelo, para validar contra datos reales.
 */
export function clienteDePruebaSoloLectura() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n\n" +
        "Estas pruebas corren contra la base REAL, en modo solo-lectura: nunca " +
        "escriben, pero sí necesitan las credenciales para LEER. Corré con:\n\n" +
        "  npm run test:integracion\n\n" +
        "(ese script ya carga .env.local con --env-file). Si preferís exportarlas " +
        "a mano, usá las mismas que tiene el portal en Vercel. Ver tests-integracion/README.md.",
    );
  }
  const real = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return envolverSoloLectura(real);
}
