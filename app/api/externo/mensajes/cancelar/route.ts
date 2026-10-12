import { autenticarExterno } from "@/lib/externo";
import { db } from "@/lib/db";
import { emitirEvento } from "@/lib/webhookSalida";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CANCELACIÓN DE ENVÍOS EN COLA POR CAMPAÑA O CLAVES (P10).
 *
 * POST /api/externo/mensajes/cancelar
 *   Cuerpo JSON:
 *     { "prefijoIdempotencia": "kambak-..." }
 *     o { "idempotencyKeys": ["kambak-...", ...] }
 *     o { "origenRef": "slug-local" }
 *   Firma: HMAC-SHA256 estándar con x-respondo-ts, x-respondo-nonce, x-respondo-firma.
 *
 * Reglas de seguridad:
 *   - Solo cancela filas con `estado = 'en_cola'` (nunca 'enviando', 'sent', 'fallido').
 *   - Solo cancela filas que pertenezcan estrictamente al `clienteId` autenticado.
 *   - Emite un evento webhook `message.status` con `reason: "cancelled"` por cada fila cancelada.
 *   - Idempotente: si ya fueron canceladas o despachadas, responde `{ ok: true, cancelados: 0 }`.
 */
export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;

  try {
    const cuerpo = auth.cuerpo;
    const clienteId = auth.clienteId;

    const prefijo = typeof cuerpo.prefijoIdempotencia === "string" ? cuerpo.prefijoIdempotencia.trim() : null;
    const keys = Array.isArray(cuerpo.idempotencyKeys)
      ? cuerpo.idempotencyKeys.filter((k): k is string => typeof k === "string")
      : null;
    const origenRef = typeof cuerpo.origenRef === "string" ? cuerpo.origenRef.trim() : null;

    if (!prefijo && (!keys || keys.length === 0) && !origenRef) {
      return Response.json(
        { ok: false, error: "Debe proporcionar prefijoIdempotencia, idempotencyKeys u origenRef" },
        { status: 400 },
      );
    }

    const supa = db();
    let query = supa
      .from("ed_envios_api")
      .select("id, clave, origen_ref")
      .eq("cliente_id", clienteId)
      .eq("canal", "waha")
      .eq("estado", "en_cola");

    if (keys && keys.length > 0) {
      query = query.in("clave", keys);
    } else if (prefijo) {
      query = query.like("clave", `${prefijo}%`);
    } else if (origenRef) {
      query = query.eq("origen_ref", origenRef);
    }

    const { data: filas, error: errorLectura } = await query;
    if (errorLectura) {
      console.error("[externo/mensajes/cancelar] error al consultar filas:", errorLectura.message);
      return Response.json({ ok: false, error: "Error al consultar envíos" }, { status: 500 });
    }

    if (!filas || filas.length === 0) {
      return Response.json({ ok: true, cancelados: 0 });
    }

    const ahoraIso = new Date().toISOString();
    const ids = filas.map((f) => f.id as string);

    // Actualizar todas las filas en_cola seleccionadas a estado fallido / cancelled
    const { error: errorUpdate } = await supa
      .from("ed_envios_api")
      .update({
        estado: "fallido",
        motivo: "cancelled",
        actualizado_en: ahoraIso,
      })
      .in("id", ids)
      .eq("cliente_id", clienteId)
      .eq("estado", "en_cola");

    if (errorUpdate) {
      console.error("[externo/mensajes/cancelar] error al actualizar:", errorUpdate.message);
      return Response.json({ ok: false, error: "Error al cancelar envíos" }, { status: 500 });
    }

    // Emitir eventos webhook hacia Kambak para cada fila cancelada
    await Promise.allSettled(
      filas.map((f) =>
        emitirEvento(clienteId, "message.status", `status:${f.id}:cancelled`, {
          id: f.id,
          status: "failed",
          reason: "cancelled",
          error_code: "cancelled",
        }),
      ),
    );

    return Response.json({ ok: true, cancelados: filas.length });
  } catch (err) {
    console.error("[externo/mensajes/cancelar]", (err as Error).message);
    return Response.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
