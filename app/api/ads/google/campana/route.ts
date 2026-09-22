import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Gestión mínima de UNA campaña de Google creada por Respondo (Search V1).
 *
 *   GET  ?borrador=<id>                  → estructura: estado, presupuesto,
 *                                           grupos, anuncios y palabras clave.
 *   POST {borrador, estado:"PAUSED"}     → pausa.
 *   POST {borrador, estado:"ENABLED"}    → reactiva SOLO en cuentas de prueba
 *                                           de Google Ads (googleGestion.ts).
 *
 * El id de campaña NUNCA viene del navegador: sale del borrador del negocio
 * que tiene la sesión (`google_campaign_id`). Así una sesión no puede operar
 * campañas de otro negocio ni campañas que el negocio maneja a mano.
 */
async function campanaDelBorrador(clienteId: string, borradorId: string): Promise<string | null> {
  const { obtenerBorrador } = await import("@/lib/marketing/campanas");
  const b = await obtenerBorrador(clienteId, borradorId);
  const plan = (b?.plan ?? null) as Record<string, unknown> | null;
  const pub = plan?.publicacion as Record<string, unknown> | undefined;
  if (!pub || pub.plataforma !== "google" || !pub.campaignId) return null;
  return String(pub.campaignId);
}

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return NextResponse.json({ ok: false, mensaje: "Sin sesión." }, { status: 401 });
  const borrador = req.nextUrl.searchParams.get("borrador") ?? "";
  const campaignId = await campanaDelBorrador(usuario.clienteId, borrador);
  if (!campaignId) return NextResponse.json({ ok: false, mensaje: "Ese borrador no tiene una campaña de Google publicada." }, { status: 404 });
  const { leerEstructuraCampanaGoogle } = await import("@/lib/ads/googleGestion");
  const r = await leerEstructuraCampanaGoogle(usuario.clienteId, campaignId);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}

export async function POST(req: NextRequest) {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return NextResponse.json({ ok: false, mensaje: "Sin sesión." }, { status: 401 });
  const cuerpo = (await req.json().catch(() => ({}))) as { borrador?: string; estado?: string };
  if (cuerpo.estado !== "PAUSED" && cuerpo.estado !== "ENABLED") {
    return NextResponse.json({ ok: false, mensaje: "Estado inválido." }, { status: 400 });
  }
  const campaignId = await campanaDelBorrador(usuario.clienteId, String(cuerpo.borrador ?? ""));
  if (!campaignId) return NextResponse.json({ ok: false, mensaje: "Ese borrador no tiene una campaña de Google publicada." }, { status: 404 });
  const { cambiarEstadoCampanaGoogle } = await import("@/lib/ads/googleGestion");
  const r = await cambiarEstadoCampanaGoogle(usuario.clienteId, campaignId, cuerpo.estado);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
