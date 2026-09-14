import { NextResponse } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { firmarEstado } from "@/lib/cifrado";
import { googleAdsConfigurado, urlAutorizacionGoogleAds } from "@/lib/ads/google";
import { huellaEstado, nombreCookieVinculo, opcionesCookieVinculo } from "@/lib/oauthVinculo";
import { origenCanonico } from "@/lib/origenes";

export const dynamic = "force-dynamic";

/**
 * Arranca la autorización de Google Ads (solo lectura).
 *
 * Mismo esqueleto que `/api/ads/conectar` para Meta, y a propósito: el `state`
 * firmado + la cookie de vínculo son la única barrera del callback, que no
 * recibe la sesión del portal. Duplicar la forma acá es preferible a
 * abstraerla: son treinta líneas y cualquier «refactor» que las una obligaría
 * a leer dos archivos para auditar una de las dos.
 *
 * El permiso es `gestionar_integraciones` (dueño): conectar la cuenta
 * publicitaria del negocio no es algo que deba poder hacer quien atiende.
 */
export async function GET() {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return NextResponse.redirect(new URL("/login", origenCanonico()));

  if (!googleAdsConfigurado()) {
    // Estado honesto: esta instalación no tiene credenciales de Google Ads.
    // Nunca se manda a nadie a una pantalla de Google que va a fallar.
    return NextResponse.redirect(new URL("/marketing/integraciones?e=no_configurado", origenCanonico()));
  }

  const estado = firmarEstado({ clienteId: usuario.clienteId }, "ads-google-estado");
  const res = NextResponse.redirect(urlAutorizacionGoogleAds(estado));
  res.cookies.set(nombreCookieVinculo("ads-google"), huellaEstado(estado), opcionesCookieVinculo());
  return res;
}
