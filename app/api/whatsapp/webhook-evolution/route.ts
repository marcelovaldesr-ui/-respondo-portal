import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteEvolution } from "@/lib/inboundEvolution";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook de Evolution API (WhatsApp NO oficial / Opción A).
 *
 * Ruta delgada: la lógica (idempotencia, toma de control humana, respuesta) vive
 * en lib/inboundEvolution.ts. Responde 200 siempre (Evolution reintenta si no).
 *
 * Seguridad ligera: si EVOLUTION_WEBHOOK_SECRET está definido, se exige ?k=<secret>.
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
    console.log("[evolution webhook]", r.accion, r.detalle ?? "");
  } catch (e) {
    console.error("[evolution webhook] error:", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
