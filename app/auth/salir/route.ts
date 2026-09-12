import { NextResponse, type NextRequest } from "next/server";
import { supabaseServidor } from "@/lib/supabaseAuth";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { COOKIE_PUSH, borrarSuscripcionPorHuella } from "@/lib/push";
import { peticionDelPortal } from "@/lib/origenes";

/**
 * CERRAR SESIÓN (Fase 1).
 *
 *  · Solo desde el propio portal: un sitio ajeno ya no puede cerrarle la sesión
 *    a nadie con un formulario escondido.
 *  · Antes de cerrar, se borra la suscripción de avisos de ESTE navegador (por
 *    la huella de la cookie). El navegador ya intentó darse de baja por su
 *    cuenta (components/pwa/desvincularPush.ts); esto cubre el caso en que el
 *    JavaScript no alcanzó. En un equipo compartido, salir es dejar de recibir
 *    los mensajes de los clientes del negocio.
 */
export async function POST(request: NextRequest) {
  if (!peticionDelPortal(request)) {
    return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  }

  const huella = request.cookies.get(COOKIE_PUSH)?.value;
  if (huella) {
    try {
      const usuario = await obtenerUsuarioPortal();
      if (usuario) await borrarSuscripcionPorHuella(db(), usuario, huella);
    } catch (e) {
      // Best-effort: nunca impedir que alguien cierre su sesión.
      console.warn("[salir] no se pudo borrar la suscripción de avisos:", (e as Error).message);
    }
  }

  const supa = await supabaseServidor();
  await supa.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  res.cookies.delete(COOKIE_PUSH);
  return res;
}
