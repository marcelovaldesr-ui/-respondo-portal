import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { limitarDistribuido, secretoValido } from "@/lib/seguridad";
import { auditarAccion } from "@/lib/auditoria";
import { idSolicitud } from "@/lib/observabilidad";
import { parsearJsonAcotado } from "@/lib/reservasPublicas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * VINCULACIÓN SIN QR (pairing code) — solución para conectar el WhatsApp de un
 * cliente A DISTANCIA (modalidad sincrónica por teléfono/videollamada).
 *
 * El QR rota cada ~30-60s, así que mandar una foto del QR NUNCA llega a tiempo.
 * En cambio, el pairing code es un código de 8 caracteres que el cliente
 * escribe con calma en su WhatsApp:
 *   WhatsApp → Dispositivos vinculados → Vincular un dispositivo →
 *   "Vincular con el número de teléfono" → escribe el código.
 *
 * Flujo de uso (nosotros por teléfono con el cliente):
 *   1) La sesión WAHA debe estar en SCAN_QR_CODE (esperando vinculación).
 *   2) POST acá con { "telefono": "56912345678" } (dígitos, con código país).
 *   3) Le dictamos el código al cliente → lo escribe → sesión WORKING.
 *
 * Seguridad: requiere sesión del portal. Pensado como herramienta interna de
 * onboarding de Respondo (no está enlazado en la UI del cliente).
 */
export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

  // Esta ruta opera la sesión WAHA global, no un recurso aislado del tenant.
  // La sesión de un cliente no basta: se exige además un secreto que solo
  // conoce el equipo de Respondo.
  const secretoAdmin = process.env.WAHA_PAIRING_SECRET;
  if (!secretoAdmin) {
    return NextResponse.json({ error: "Emparejamiento administrativo no configurado" }, { status: 503 });
  }
  if (!secretoValido(request.headers.get("x-respondo-admin-secret"), secretoAdmin)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  if (!(await limitarDistribuido(`waha-pair:${usuario.email}`, 3, 600)).ok) {
    return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }

  const base = (process.env.WAHA_API_URL ?? "").replace(/\/+$/, "");
  const key = process.env.WAHA_API_KEY;
  const session = process.env.WAHA_SESSION || "default";
  if (!base || !key) {
    return NextResponse.json({ error: "Falta WAHA_API_URL/WAHA_API_KEY" }, { status: 500 });
  }

  const cuerpo = parsearJsonAcotado(await request.text(), 4 * 1024);
  if (!cuerpo) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const telefono = String(cuerpo.telefono ?? "").replace(/\D/g, "");
  if (telefono.length < 8 || telefono.length > 15) {
    return NextResponse.json(
      { error: "Falta 'telefono' (dígitos con código de país, ej: 56912345678)" },
      { status: 400 },
    );
  }

  try {
    // La sesión debe estar esperando vinculación.
    const st = await fetch(`${base}/api/sessions/${session}`, {
      headers: { "X-Api-Key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const sj = (await st.json().catch(() => ({}))) as { status?: string };
    if (sj.status !== "SCAN_QR_CODE") {
      return NextResponse.json(
        {
          error: `La sesión está en ${sj.status ?? "?"}. Debe estar en SCAN_QR_CODE (haz logout/restart primero).`,
        },
        { status: 409 },
      );
    }

    const r = await fetch(`${base}/api/${session}/auth/request-code`, {
      method: "POST",
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: telefono }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { code?: string; error?: string; message?: string };
    if (!r.ok || !j.code) {
      console.error("[waha pairing] proveedor rechazó la solicitud:", r.status);
      return NextResponse.json(
        { error: "WAHA no entregó un código", requestId },
        { status: 502 },
      );
    }

    await auditarAccion(usuario, "waha_codigo_emparejamiento_generado", {
      requestId,
      metadata: { session },
    });
    return NextResponse.json({
      ok: true,
      codigo: j.code,
      instrucciones:
        "En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo → 'Vincular con el número de teléfono' → escribir este código.",
    });
  } catch (e) {
    console.error("[waha pairing] error:", (e as Error).message);
    return NextResponse.json({ error: "No se pudo generar el código" }, { status: 500 });
  }
}
