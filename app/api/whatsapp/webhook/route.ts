import { NextResponse, type NextRequest } from "next/server";
import { manejarEntranteMeta } from "@/lib/inboundMeta";
import { firmaMetaValida, secretoValido } from "@/lib/seguridad";
import { idSolicitud } from "@/lib/observabilidad";
import { idEventoWebhook, procesarConInbox } from "@/lib/webhookInbox";

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

  // Comparación en tiempo constante (evita adivinar el token por timing).
  if (modo === "subscribe" && secretoValido(token, process.env.WHATSAPP_VERIFY_TOKEN)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// --- POST: eventos entrantes ---
export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  // ── SEGURIDAD: verificar que el payload viene REALMENTE de Meta ────────────
  // Sin esto, cualquiera con la URL puede inyectar mensajes falsos y hacer que
  // el asistente responda a números arbitrarios (con costo) o envenenar la base.
  // La firma se calcula sobre el cuerpo CRUDO, así que se lee como texto.
  const crudo = await request.text();
  if (Buffer.byteLength(crudo, "utf8") > 1024 * 1024) {
    return new NextResponse("Payload demasiado grande", { status: 413 });
  }
  const firma = request.headers.get("x-hub-signature-256");
  if (!firmaMetaValida(crudo, firma)) {
    console.warn("[meta webhook] firma inválida — payload descartado");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 });
  }

  try {
    const r = await procesarConInbox({
      proveedor: "meta_whatsapp",
      eventoId: idEventoWebhook("meta_whatsapp", crudo),
      payload,
      requestId,
      manejar: manejarEntranteMeta,
    });
    return NextResponse.json({ ok: true, duplicado: r.duplicado, resultados: r.resultado });
  } catch (e) {
    const inbox = (e as Error).message.includes("inbox webhook");
    return NextResponse.json(
      { ok: false, requestId },
      { status: inbox ? 503 : 500, headers: { "Retry-After": "60" } },
    );
  }
}
