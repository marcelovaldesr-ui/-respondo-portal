import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { configPorCliente } from "@/lib/whatsapp";
import { limitarDistribuido } from "@/lib/seguridad";
import { auditarAccion } from "@/lib/auditoria";
import { idSolicitud } from "@/lib/observabilidad";

/**
 * PEDIR EL HISTORIAL DE COEXISTENCIA A META (3-nov-2026).
 *
 * Tras conectar un número en Coexistencia (Embedded Signup + QR en la app),
 * Meta NO manda sola la historia: hay que pedirla con
 * POST /{phone_number_id}/smb_app_data, una vez con sync_type
 * "smb_app_state_sync" (contactos) y otra con "history" (hasta 6 meses de chats).
 *
 * ⚠️ Solo se puede pedir UNA vez por conexión y dentro de las 24 h siguientes
 * a conectar. Fuera de plazo, o para repetirlo, hay que reconectar el número.
 * La respuesta de Meta solo confirma que recibió el pedido; los chats llegan
 * después por el webhook "history" (ver lib/inboundMeta.ts → 0.b).
 */
const GRAPH = "https://graph.facebook.com/v23.0";

type Resultado = { tipo: string; ok: boolean; requestId?: string; error?: string };

export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await limitarDistribuido(`meta-historial:${usuario.clienteId}`, 3, 600)).ok) {
    return NextResponse.json({ error: "Demasiados intentos, espera unos minutos" }, { status: 429 });
  }
  const cfg = await configPorCliente(usuario.clienteId);
  if (!cfg) return NextResponse.json({ error: "Este negocio no tiene WhatsApp conectado" }, { status: 400 });

  const resultados: Resultado[] = [];
  for (const tipo of ["smb_app_state_sync", "history"] as const) {
    try {
      const r = await fetch(`${GRAPH}/${encodeURIComponent(cfg.phoneNumberId)}/smb_app_data`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", sync_type: tipo }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => ({}))) as { request_id?: string; error?: { message?: string; code?: number } };
      resultados.push(
        r.ok
          ? { tipo, ok: true, requestId: j.request_id }
          : { tipo, ok: false, error: `${j.error?.code ?? r.status}: ${(j.error?.message ?? "error de Meta").slice(0, 200)}` },
      );
    } catch (e) {
      resultados.push({ tipo, ok: false, error: (e as Error).message.slice(0, 200) });
    }
  }

  for (const r of resultados) {
    await auditarAccion(usuario, r.ok ? "historial_meta_pedido" : "historial_meta_fallo", {
      recursoId: cfg.phoneNumberId,
      requestId,
      metadata: { tipo: r.tipo, ...(r.requestId ? { meta_request_id: r.requestId } : {}), ...(r.error ? { error: r.error } : {}) },
    });
  }

  const historia = resultados.find((r) => r.tipo === "history");
  return NextResponse.json(
    { ok: Boolean(historia?.ok), resultados, requestId },
    { status: historia?.ok ? 200 : 502 },
  );
}
