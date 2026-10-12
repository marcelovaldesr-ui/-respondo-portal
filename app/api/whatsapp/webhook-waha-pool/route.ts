import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteWahaPool } from "@/lib/inboundWahaPool";
import { secretoValido } from "@/lib/seguridad";
import { idSolicitud } from "@/lib/observabilidad";
import { idEventoWebhook, procesarConInbox } from "@/lib/webhookInbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook de WAHA para el grupo de números de Kambak (Marketing).
 *
 * Recibe eventos de entrega (message.ack), mensajes entrantes (message) y
 * estado de sesiones (session.status) desde el servicio WAHA de Railway.
 *
 * Utiliza WAHA_POOL_WEBHOOK_SECRET en el parámetro ?k=.
 * Procesa con idempotencia usando procesarConInbox.
 */
export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  const secret = process.env.WAHA_POOL_WEBHOOK_SECRET;
  const k = new URL(request.url).searchParams.get("k");

  if (!secret) return new NextResponse("Webhook no configurado", { status: 503 });
  if (!secretoValido(k, secret)) return new NextResponse("Forbidden", { status: 403 });

  const crudo = await request.text();
  if (Buffer.byteLength(crudo, "utf8") > 1024 * 1024) {
    return new NextResponse("Payload demasiado grande", { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 });
  }

  try {
    const r = await procesarConInbox({
      proveedor: "waha",
      eventoId: idEventoWebhook("waha", crudo),
      payload,
      requestId,
      manejar: (p) => manejarEntranteWahaPool(p),
    });
    return NextResponse.json({ ok: true, duplicado: r.duplicado, resultado: r.resultado });
  } catch (e) {
    const inbox = (e as Error).message.includes("inbox webhook");
    return NextResponse.json(
      { ok: false, requestId },
      { status: inbox ? 503 : 500, headers: { "Retry-After": "60" } },
    );
  }
}
