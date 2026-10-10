import { autenticarExterno } from "@/lib/externo";
import { procesarEnvio } from "@/lib/kambakEnvios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * ENVÍO DE PLANTILLAS PARA CUENTAS DE SOLO MENSAJERÍA (Kambak).
 *
 * POST /api/externo/mensajes
 *   Cuerpo JSON: { clienteId, to, template, language?, variables[], idempotencyKey }
 *   Firma: la misma de /api/externo/* (x-respondo-firma, x-respondo-ts,
 *   x-respondo-nonce; HMAC-SHA256 de `${ts}.${nonce}.${cuerpo}` con el secreto
 *   de la integración activa de la cuenta).
 *
 * Respuestas (siempre JSON):
 *   200 { ok, id, status: "sent" | "queued" | "skipped", reason? , duplicate? }
 *   400 cuerpo o clave inválida · 401 firma · 403 cuenta no habilitada
 *   422 número, plantilla o variables inválidas · 429 demasiados envíos
 *   502 Meta rechazó { status: "failed" } · 503 WhatsApp sin configurar
 * `skipped` + reason `opted_out` | `monthly_cap` NO es un error: es la segunda
 * barrera haciendo su trabajo. Detalle del contrato en KAMBAK.md.
 */
export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;
  try {
    const r = await procesarEnvio(auth.clienteId, auth.cuerpo);
    return Response.json(r.cuerpo, { status: r.status });
  } catch (e) {
    console.error("[externo/mensajes]", (e as Error).message);
    return Response.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
