import { createHash, timingSafeEqual } from "node:crypto";

/**
 * VÍNCULO ENTRE EL `state` DE OAUTH Y EL NAVEGADOR QUE LO PIDIÓ (Fase 0).
 *
 * El `state` de Google, Instagram y Meta Ads va firmado y vence, así que nadie
 * puede FABRICAR uno. Pero no estaba atado a quien lo pidió: alguien podía
 * iniciar la conexión en SU portal, copiar la URL de autorización (con SU
 * `state`) y hacérsela abrir a otra persona. Al aceptar, la cuenta de Google o
 * Instagram de la víctima quedaba conectada al negocio del atacante (CSRF de
 * OAuth).
 *
 * Ahora `/conectar` deja una cookie HttpOnly con la huella del `state`, y el
 * callback exige que coincida. La cookie solo existe en el navegador que
 * inició la conexión. SameSite=Lax: viaja en la redirección de vuelta desde el
 * proveedor (navegación de nivel superior), no en peticiones de terceros.
 */

export const VIGENCIA_VINCULO_SEG = 15 * 60;

export function huellaEstado(state: string): string {
  return createHash("sha256").update(`oauth-vinculo:${state}`).digest("hex");
}

export function nombreCookieVinculo(proveedor: "google" | "instagram" | "ads"): string {
  return `rp_oauth_${proveedor}`;
}

export function opcionesCookieVinculo() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax" as const,
    path: "/",
    maxAge: VIGENCIA_VINCULO_SEG,
  };
}

/** Extrae el `state` de una URL de autorización ya armada. */
export function estadoDeUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("state");
  } catch {
    return null;
  }
}

/** ¿La cookie de este navegador corresponde a este `state`? */
export function vinculoValido(state: string | null | undefined, cookie: string | null | undefined): boolean {
  if (!state || !cookie) return false;
  const a = Buffer.from(huellaEstado(state));
  const b = Buffer.from(cookie);
  return a.length === b.length && timingSafeEqual(a, b);
}
