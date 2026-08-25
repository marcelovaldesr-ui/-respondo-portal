import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { obtenerConversacion } from "@/lib/conversaciones";

export const dynamic = "force-dynamic";

/**
 * El detalle de UNA conversación, en JSON.
 *
 * POR QUÉ EXISTE (24-ago-2026)
 * ----------------------------
 * Cambiar de conversación era lento y se sentía peor de lo que era. Cada clic
 * en la lista navegaba a `/conversaciones?emp=…&chat=…`, y como esa página es
 * `force-dynamic`, el servidor **volvía a construirla entera**: la lista de 50
 * conversaciones, el resumen con los conteos de las 499, y recién después el
 * chat que la persona pidió.
 *
 * Y lo que más se notaba no era el tiempo sino el `loading.tsx` del segmento:
 * al ser de toda la ruta, **la pantalla completa se convertía en esqueleto**,
 * incluida la lista que la persona estaba mirando. Clic → todo desaparece →
 * todo vuelve. Se percibe como varios segundos aunque el servidor tarde menos
 * de uno.
 *
 * Con este endpoint, cambiar de chat pide SOLO el chat. La lista no se toca, no
 * parpadea nada, y el navegador puede guardar en memoria los que ya abrió — así
 * volver a uno anterior es instantáneo, como en WhatsApp.
 *
 * Reusa `obtenerConversacion`, la misma función que usa la página en su primera
 * carga: una sola definición de qué es "el detalle de una conversación".
 */
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const emp = searchParams.get("emp") ?? "";
  const chat = searchParams.get("chat") ?? "";
  if (!emp || !chat) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  // `obtenerConversacion` valida por dentro que el empleado sea del cliente
  // logueado y devuelve null si no lo es: la barrera de aislamiento es la misma
  // que en la página, no una copia nueva que pueda quedar desalineada.
  const detalle = await obtenerConversacion(usuario.clienteId, emp, chat);
  if (!detalle) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  return NextResponse.json(detalle, { headers: { "Cache-Control": "no-store" } });
}
