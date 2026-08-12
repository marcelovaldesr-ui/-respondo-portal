import { NextResponse, type NextRequest } from "next/server";
import { limitarDistribuido } from "@/lib/seguridad";
import { ipDeRequest, parsearJsonAcotado } from "@/lib/reservasPublicas";
import { tokenConFormato } from "@/lib/autogestion";
import {
  cancelarPorToken,
  cuposParaReagendar,
  reagendarPorToken,
} from "@/lib/autogestionDatos";

export const dynamic = "force-dynamic";

/**
 * AUTOGESTIÓN DE LA HORA (migración 277) — la usa /cita/[token].
 *
 * Sin sesión: el token ES la credencial. Por eso acá arriba de todo va el
 * rate-limit por IP, y por token: sin él, alguien podría probar tokens al voleo
 * o repetir la cancelación para hacer ruido.
 *
 *   GET  → cupos a los que se puede mover la hora
 *   POST → { accion: 'cancelar' } | { accion: 'reagendar', inicio }
 */

async function limitar(request: NextRequest, token: string, cupo: number) {
  const ip = ipDeRequest(request.headers);
  const [porIp, porToken] = await Promise.all([
    limitarDistribuido(`cita-ip:${ip}`, cupo, 60),
    // También por token: una IP rotativa no debe poder martillar UNA cita.
    limitarDistribuido(`cita-tk:${token.slice(0, 16)}`, cupo, 60),
  ]);
  return porIp.ok && porToken.ok;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenConFormato(token)) {
    return NextResponse.json({ ok: false, error: "Enlace no válido." }, { status: 404 });
  }
  if (!(await limitar(request, token, 20))) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos." }, { status: 429 });
  }

  const r = await cuposParaReagendar(token);
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return NextResponse.json(r);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!tokenConFormato(token)) {
    return NextResponse.json({ ok: false, error: "Enlace no válido." }, { status: 404 });
  }
  // Más estricto que el GET: estas acciones escriben.
  if (!(await limitar(request, token, 8))) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos." }, { status: 429 });
  }

  const cuerpo = parsearJsonAcotado(await request.text());
  if (!cuerpo) return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });

  const accion = String((cuerpo as { accion?: unknown }).accion ?? "");

  if (accion === "cancelar") {
    const r = await cancelarPorToken(token);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (accion === "reagendar") {
    const inicio = String((cuerpo as { inicio?: unknown }).inicio ?? "");
    if (!inicio || Number.isNaN(Date.parse(inicio))) {
      return NextResponse.json({ ok: false, error: "Elige un horario válido." }, { status: 400 });
    }
    const r = await reagendarPorToken(token, inicio);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "Acción no reconocida." }, { status: 400 });
}
