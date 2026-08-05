import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteWaha } from "@/lib/inboundWaha";
import { secretoValido } from "@/lib/seguridad";
import { idSolicitud } from "@/lib/observabilidad";
import { idEventoWebhook, procesarConInbox } from "@/lib/webhookInbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook de WAHA (WhatsApp NO oficial / Opción A — motor GOWS).
 *
 * Ruta delgada: la lógica vive en lib/inboundWaha.ts. Confirma solo después de
 * persistir/procesar; ante error retorna 5xx para habilitar reintentos. WAHA no
 * firma payloads, por eso WAHA_WEBHOOK_SECRET es obligatorio en ?k=.
 * (Antes se llamaba EVOLUTION_WEBHOOK_SECRET, resabio del proveedor viejo ya
 * eliminado — renombrado 5-ago-2026 al rotar el secreto, sin cambiar el uso.)
 */
export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  // Secreto comparado en tiempo constante (anti timing attack).
  const secret = process.env.WAHA_WEBHOOK_SECRET;
  const k = new URL(request.url).searchParams.get("k");
  // WAHA no firma los payloads. Sin el secreto compartido no hay forma de
  // distinguir un mensaje real de uno fabricado por internet.
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
      manejar: manejarEntranteWaha,
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
