import { NextResponse, type NextRequest } from "next/server";
import { firmaValidaCon, secretoValido } from "@/lib/seguridad";
import { manejarEntranteInstagram } from "@/lib/inboundInstagram";
import { idSolicitud } from "@/lib/observabilidad";
import { idEventoWebhook, procesarConInbox } from "@/lib/webhookInbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WEBHOOK DE INSTAGRAM DIRECT.
 *
 * GET  → verificación inicial de Meta (responde el hub.challenge).
 * POST → mensajes entrantes.
 *
 * RUTA APARTE DE LA DE WHATSAPP, A PROPÓSITO
 * Meta permite un callback distinto por producto. Separarlas significa que
 * activar Instagram no toca ni una línea de la configuración de WhatsApp —que
 * está en revisión— y que si algo falla acá, el canal que hoy da los ingresos
 * sigue funcionando exactamente igual.
 *
 * EL WEBHOOK NO ES OPCIONAL PARA LA REVISIÓN
 * Meta prueba la entrega de DMs en vivo durante el App Review y el endpoint
 * tiene que responder. Las apps que solo consultan la API por sondeo no pasan
 * esa revisión. Por eso esto existe antes de pedirla, no después.
 *
 * Variables necesarias:
 *   IG_VERIFY_TOKEN   el que se escribe en el panel de Meta al suscribir
 *   IG_APP_SECRET     secreto de la app de Instagram: valida la firma
 *   IG_TOKEN          solo para la cuenta de pruebas; en producción el token de
 *                     cada negocio vive en ed_clientes.ig_token
 */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const modo = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Comparación en tiempo constante: un token de verificación filtrado permite
  // que un tercero suscriba su propio webhook.
  if (modo === "subscribe" && secretoValido(token, process.env.IG_VERIFY_TOKEN)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  /**
   * SEGURIDAD: verificar que el payload viene REALMENTE de Meta.
   *
   * Sin esto, cualquiera con la URL puede inyectar mensajes falsos y hacer que
   * el asistente le responda a cuentas arbitrarias desde el Instagram del
   * cliente. La firma se calcula sobre el cuerpo CRUDO, así que se lee como
   * texto antes de parsear.
   */
  const crudo = await request.text();
  if (Buffer.byteLength(crudo, "utf8") > 1024 * 1024) {
    return new NextResponse("Payload demasiado grande", { status: 413 });
  }
  const firma = request.headers.get("x-hub-signature-256");
  // IG_APP_SECRET es el de la app de Instagram. Si la app fuera compartida con
  // WhatsApp se cae al secreto de WhatsApp, pero se prefiere el propio: es lo
  // que permite tener Instagram en una app aparte sin tocar la de WhatsApp.
  const secreto = process.env.IG_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
  if (!firmaValidaCon(secreto, crudo, firma)) {
    console.warn("[instagram webhook] firma inválida — payload descartado");
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
      proveedor: "instagram",
      eventoId: idEventoWebhook("instagram", crudo),
      payload,
      requestId,
      manejar: manejarEntranteInstagram,
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
