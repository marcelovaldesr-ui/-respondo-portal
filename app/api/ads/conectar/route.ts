import { NextResponse } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { firmarEstado } from "@/lib/cifrado";
import { metaAdsConfigurado, urlAutorizacionAds } from "@/lib/ads/meta";

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
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_URL_PORTAL));
  }

  if (!metaAdsConfigurado()) {
    // Estado honesto: la app de Meta todavía no está creada en esta
    // instalación. No se manda a nadie a una pantalla de Meta que va a fallar.
    return NextResponse.redirect(
      new URL("/pauta/conexion?e=no_configurado", process.env.NEXT_PUBLIC_URL_PORTAL),
    );
  }

  const estado = firmarEstado({ clienteId: usuario.clienteId }, "ads-estado");
  return NextResponse.redirect(urlAutorizacionAds(estado));
}
