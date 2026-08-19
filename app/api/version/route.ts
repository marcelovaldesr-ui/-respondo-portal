import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La versión que está VIVA en el servidor ahora mismo.
 *
 * El navegador lleva horneada la suya en NEXT_PUBLIC_VERSION_DESPLIEGUE (ver
 * next.config.mjs). Comparando ambas, una pestaña abierta puede darse cuenta de
 * que quedó vieja y ofrecer actualizarse ANTES de que el usuario apriete un
 * botón que ya no existe.
 *
 * Deliberadamente no dice nada más: es un endpoint público —lo consulta el
 * navegador de cualquier cliente— y una versión de despliegue no es un secreto,
 * pero cualquier otro dato acá sí lo sería.
 */
export async function GET() {
  return new NextResponse(
    JSON.stringify({ version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local" }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Sin esto, un CDN podría servir una versión cacheada y el chequeo
        // compararía dos valores viejos entre sí, que es peor que no chequear.
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
