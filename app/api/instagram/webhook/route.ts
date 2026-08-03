import { NextResponse, type NextRequest } from "next/server";
import { firmaMetaValida, secretoValido } from "@/lib/seguridad";
import { manejarEntranteInstagram } from "@/lib/inboundInstagram";

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
 *   META_APP_SECRET   ya existe (se comparte con WhatsApp): valida la firma
 *   IG_TOKEN          token de acceso para responder
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
  /**
   * SEGURIDAD: verificar que el payload viene REALMENTE de Meta.
   *
   * Sin esto, cualquiera con la URL puede inyectar mensajes falsos y hacer que
   * el asistente le responda a cuentas arbitrarias desde el Instagram del
   * cliente. La firma se calcula sobre el cuerpo CRUDO, así que se lee como
   * texto antes de parsear.
   */
  const crudo = await request.text();
  const firma = request.headers.get("x-hub-signature-256");
  if (!firmaMetaValida(crudo, firma)) {
    console.warn("[instagram webhook] firma inválida — payload descartado");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ ok: true }); // 200 igual: que Meta no reintente
  }

  try {
    const resultados = await manejarEntranteInstagram(payload);
    return NextResponse.json({ ok: true, resultados });
  } catch (e) {
    // Nunca romper el 200. Un 500 hace que Meta reintente en bucle y, si se
    // repite, que desactive la suscripción del webhook — que es justo lo que
    // hunde una revisión.
    console.error("[instagram webhook] error:", (e as Error).message);
    return NextResponse.json({ ok: true });
  }
}
