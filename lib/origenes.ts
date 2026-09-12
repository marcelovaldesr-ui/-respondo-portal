/**
 * ORÍGENES CONFIABLES DEL PORTAL (Fase 1). Puro: sirve en servidor, en
 * componentes de cliente y en tests.
 *
 * LA REGLA
 * --------
 *  · Producción tiene UN origen canónico: `NEXT_PUBLIC_SITE_URL` (con el
 *    respaldo de siempre). Es la dirección que se registra en Google, Meta y
 *    Supabase.
 *  · Desarrollo o staging se agregan EXPLÍCITOS en
 *    `NEXT_PUBLIC_ORIGENES_PERMITIDOS` (coma, origen exacto, sin rutas).
 *  · Nada de comodines: `*.vercel.app` NO es un origen confiable. Un preview es
 *    otro sitio y no puede recibir un enlace de login ni ser destino de OAuth.
 *  · En `next dev` (NODE_ENV ≠ production) se acepta `http://localhost:<puerto>`
 *    para poder entrar en local. Un build de producción —incluidos los
 *    previews— nunca lo acepta.
 *
 * Es público a propósito (NEXT_PUBLIC_): un origen no es un secreto, y el
 * formulario de login necesita la misma lista que el servidor.
 */

export const ORIGEN_POR_DEFECTO = "https://respondo-portal.vercel.app";

export type EntornoOrigenes = {
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_ORIGENES_PERMITIDOS?: string;
  NODE_ENV?: string;
};

/** Lectura LITERAL de las variables: así Next las incrusta también en el navegador. */
export function entornoActual(): EntornoOrigenes {
  return {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_ORIGENES_PERMITIDOS: process.env.NEXT_PUBLIC_ORIGENES_PERMITIDOS,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function esLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Devuelve el origen (`https://host[:puerto]`) si el texto es EXACTAMENTE un
 * origen: https (o http solo en localhost), sin ruta, sin query, sin usuario
 * y sin comodines. Cualquier otra cosa → null.
 */
export function normalizarOrigen(valor: string | null | undefined): string | null {
  const t = (valor ?? "").trim().replace(/\/+$/, "");
  if (!t || t.includes("*")) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname && u.pathname !== "/") return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && esLocal(u.hostname)) return u.origin;
  return null;
}

/** El origen canónico. Un localhost en producción no lo es: cae al de siempre. */
export function origenCanonico(env: EntornoOrigenes = entornoActual()): string {
  const o = normalizarOrigen(env.NEXT_PUBLIC_SITE_URL);
  if (!o) return ORIGEN_POR_DEFECTO;
  if (env.NODE_ENV === "production" && esLocal(new URL(o).hostname)) return ORIGEN_POR_DEFECTO;
  return o;
}

export function origenesConfiables(env: EntornoOrigenes = entornoActual()): string[] {
  const extra = (env.NEXT_PUBLIC_ORIGENES_PERMITIDOS ?? "")
    .split(",")
    .map((x) => normalizarOrigen(x))
    .filter((x): x is string => Boolean(x))
    .filter((x) => env.NODE_ENV !== "production" || !esLocal(new URL(x).hostname));
  return [...new Set([origenCanonico(env), ...extra])];
}

export function esOrigenConfiable(origen: string | null | undefined, env: EntornoOrigenes = entornoActual()): boolean {
  const o = normalizarOrigen(origen);
  if (!o) return false;
  if (origenesConfiables(env).includes(o)) return true;
  return env.NODE_ENV !== "production" && esLocal(new URL(o).hostname);
}

/** URL absoluta del portal para enlaces que salen del portal (correo, iCal, reservas). */
export function urlPortal(ruta: string, env: EntornoOrigenes = entornoActual()): string {
  const r = ruta.startsWith("/") ? ruta : `/${ruta}`;
  return `${origenCanonico(env)}${r}`;
}

/**
 * Para el enlace mágico de login: se vuelve al origen desde el que se pidió
 * SOLO si es confiable; si no, al canónico. Así un preview o una copia del
 * portal no puede recibir los tokens de sesión de nadie.
 */
export function origenParaEnlace(actual: string | null | undefined, env: EntornoOrigenes = entornoActual()): string {
  const o = normalizarOrigen(actual);
  return o && esOrigenConfiable(o, env) ? o : origenCanonico(env);
}

/**
 * ¿La petición viene del propio portal? Defensa CSRF para rutas que cambian
 * estado con cookies de sesión (cerrar sesión, avisos). Acepta el origen desde
 * el que se sirvió la petición o uno confiable. Sin cabecera Origin se mira
 * `Sec-Fetch-Site`; sin ninguna de las dos (clientes viejos, herramientas) se
 * acepta: las cookies SameSite=Lax ya frenan el caso cruzado de un navegador.
 */
export function peticionDelPortal(
  req: { url: string; headers: { get(nombre: string): string | null } },
  env: EntornoOrigenes = entornoActual(),
): boolean {
  const origen = req.headers.get("origin");
  if (origen) {
    if (origen === "null") return false;
    let propio: string | null = null;
    try {
      propio = new URL(req.url).origin;
    } catch {
      propio = null;
    }
    return origen === propio || esOrigenConfiable(origen, env);
  }
  const sitio = req.headers.get("sec-fetch-site");
  return !sitio || sitio === "same-origin" || sitio === "none";
}

/** El mensaje de Facebook (alta de WhatsApp) solo vale desde un dominio de Facebook EXACTO. */
export function esOrigenFacebook(origen: string): boolean {
  try {
    const u = new URL(origen);
    return u.protocol === "https:" && (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}
