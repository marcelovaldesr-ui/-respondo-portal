import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteEvolution } from "@/lib/inboundEvolution";

export const dynamic = "force-dynamic";

/**
 * Webhook de Evolution API (WhatsApp NO oficial / Opción A).
 *
 * Ruta delgada: toda la lógica (idempotencia, toma de control humana, respuesta)
 * vive en lib/inboundEvolution.ts para poder probarla sin HTTP.
 *
 * Seguridad ligera: si EVOLUTION_WEBHOOK_SECRET está definido, se exige ?k=<secret>.
 * SIEMPRE responde 200 rápido: Evolution reintenta si no recibe 200 y eso
 * duplicaría eventos (la idempotencia por id ya cubre los reenvíos, pero igual
 * respondemos 200 para no acumular reintentos).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (secret) {
    const k = new URL(request.url).searchParams.get("k");
    if (k !== secret) return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    const r = await manejarEntranteEvolution(payload);
    // Log útil para observabilidad (aparece en los logs de Vercel).
    console.log("[evolution webhook]", r.accion, r.detalle ?? "");
  } catch (e) {
    console.error("[evolution webhook] error:", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
