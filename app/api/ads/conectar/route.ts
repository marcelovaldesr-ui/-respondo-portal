import { NextResponse } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { firmarEstado } from "@/lib/cifrado";
import { metaAdsConfigurado, urlAutorizacionAds } from "@/lib/ads/meta";
import { huellaEstado, nombreCookieVinculo, opcionesCookieVinculo } from "@/lib/oauthVinculo";

/**
 * ⚠️ `new URL(ruta, base)` LANZA si `base` es undefined. Por eso el respaldo va
 * acá también y no solo en meta.ts: una variable sin definir tumbaría el
 * endpoint con un 500 en vez de mandar a la pantalla de login.
 */
const PORTAL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://respondo-portal.vercel.app"
).replace(/\/+$/, "");

export const dynamic = "force-dynamic";

/**
 * Arranca la autorización de Meta para leer la cuenta publicitaria.
 *
 * ⭐ EL `state` VA FIRMADO. Sin firma, cualquiera podría armar un enlace de
 * callback con el `cliente_id` de otro negocio y dejarle guardada una conexión
 * ajena — un CSRF con consecuencias de datos. La firma la verifica el callback
 * y caduca a los 15 minutos (lib/cifrado.ts), que es el mismo mecanismo que ya
 * usa el OAuth de Instagram.
 *
 * El permiso exigido es `gestionar_integraciones`: conectar una cuenta
 * publicitaria no es algo que deba poder hacer quien atiende el mesón.
 */
export async function GET() {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) {
    return NextResponse.redirect(new URL("/login", PORTAL));
  }

  if (!metaAdsConfigurado()) {
    // Estado honesto: la app de Meta todavía no está creada en esta
    // instalación. No se manda a nadie a una pantalla de Meta que va a fallar.
    return NextResponse.redirect(
      new URL("/marketing/integraciones?e=no_configurado", PORTAL),
    );
  }

  const estado = firmarEstado({ clienteId: usuario.clienteId }, "ads-estado");
  // Ata el `state` a ESTE navegador (Fase 0): ver lib/oauthVinculo.ts.
  const res = NextResponse.redirect(urlAutorizacionAds(estado));
  res.cookies.set(nombreCookieVinculo("ads"), huellaEstado(estado), opcionesCookieVinculo());
  return res;
}
