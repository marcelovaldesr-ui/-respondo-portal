import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteMeta } from "@/lib/inboundMeta";

export const dynamic = "force-dynamic";
// Debounce (6s) + Gemini (~5-10s) + envío: holgura para no cortar a mitad.
export const maxDuration = 60;

/**
 * Webhook de la WhatsApp Cloud API OFICIAL (Opción B).
 *
 * GET  → verificación inicial de Meta (responde el hub.challenge).
 * POST → eventos: messages (cliente), statuses (ACKs) y message_echoes
 *        (Coexistencia: mensajes salientes desde la app del negocio).
 *
 * La ruta es DELGADA (igual que webhook-waha): toda la orquestación —
 * idempotencia ante reintentos de Meta, toma de control humana, tracking de
 * entregas, debounce y respuesta del cerebro — vive en lib/inboundMeta.ts.
 *
 * NOTA sobre el 200: Meta reintenta si el 200 tarda. Los reintentos son
 * INOFENSIVOS porque el entrante queda guardado con su wamid apenas llega
 * (idempotencia por índice único). Con más volumen, mover a una cola.
 */

// --- GET: verificación del webhook ---
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modo = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// --- POST: eventos entrantes ---
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true }); // 200 igual, para que Meta no reintente
  }

  try {
    const resultados = await manejarEntranteMeta(payload);
    return NextResponse.json({ ok: true, resultados });
  } catch (e) {
    // Nunca romper el 200: si algo falla, se loguea y Meta no reintenta en loop.
    console.error("[meta webhook] error:", (e as Error).message);
    return NextResponse.json({ ok: true });
  }
}
