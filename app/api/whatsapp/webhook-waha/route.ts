import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteWaha } from "@/lib/inboundWaha";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook de WAHA (WhatsApp NO oficial / Opción A — motor GOWS).
 *
 * Ruta delgada: la lógica vive en lib/inboundWaha.ts. Responde 200 siempre
 * (WAHA reintenta si no). Seguridad ligera: si EVOLUTION_WEBHOOK_SECRET está
 * definido, se exige ?k=<secret> (se reutiliza el mismo secreto ya generado).
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
    const r = await manejarEntranteWaha(payload);
    console.log("[waha webhook]", r.accion, r.detalle ?? "");
  } catch (e) {
    console.error("[waha webhook] error:", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
