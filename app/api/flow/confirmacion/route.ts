import { NextRequest, NextResponse } from "next/server";
import { procesarConfirmacionFlow } from "@/lib/flow/flowPagos";

export const dynamic = "force-dynamic";

/**
 * WEBHOOK OFICIAL DE CONFIRMACIÓN DE FLOW.CL (`urlConfirmation`).
 *
 * Flow envía una petición POST servidor a servidor con el parámetro `token`.
 *
 * Flujo:
 *  1. Extraer el token del body (form-urlencoded o JSON).
 *  2. Llamar a `procesarConfirmacionFlow(token)` para validar con Flow (`/payment/getStatus`).
 *  3. Responder HTTP 200 a Flow con `{ status: "ok" }`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let token = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData().catch(() => null);
      if (formData) {
        token = String(formData.get("token") ?? "").trim();
      }
    } else if (contentType.includes("application/json")) {
      const bodyJson = (await req.json().catch(() => null)) as { token?: string } | null;
      if (bodyJson?.token) {
        token = String(bodyJson.token).trim();
      }
    }

    // Fallback: si no vino en el body parseado, intentar como texto o query param
    if (!token) {
      const url = new URL(req.url);
      token = (url.searchParams.get("token") ?? "").trim();
    }

    if (!token) {
      const rawText = await req.text().catch(() => "");
      const params = new URLSearchParams(rawText);
      token = (params.get("token") ?? "").trim();
    }

    if (!token) {
      console.warn("[flow/confirmacion] Webhook recibido sin token");
      return NextResponse.json({ error: "Falta parámetro token" }, { status: 400 });
    }

    const resultado = await procesarConfirmacionFlow(token);

    if (!resultado.ok) {
      console.error("[flow/confirmacion] Error al procesar pago Flow:", resultado.error);
      // Responder 200 para evitar que Flow reintente indefinidamente ante tokens inválidos,
      // pero reportar el estado en el JSON
      return NextResponse.json({ status: "error", error: resultado.error }, { status: 200 });
    }

    return NextResponse.json({
      status: "ok",
      pagoId: resultado.pagoId,
      estado: resultado.estado,
      yaProcesado: resultado.yaProcesado,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error interno";
    console.error("[flow/confirmacion] Excepción no controlada en webhook Flow:", msg);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
