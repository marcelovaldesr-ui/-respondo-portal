import { NextResponse } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { reencolarFallidos } from "@/lib/webhookSalida";

export const dynamic = "force-dynamic";

/**
 * BANDEJA DE EVENTOS FALLIDOS hacia el sistema de Kambak.
 *
 *   GET  → los últimos 50 eventos que agotaron sus reintentos (sin su contenido).
 *   POST → { ids?: string[] } los devuelve a la cola (todos si no se indican).
 *
 * Solo para el dueño de una cuenta de solo mensajería.
 */
async function autorizar() {
  const u = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!u || !u.soloMensajeria) return null;
  return u;
}

export async function GET() {
  const u = await autorizar();
  if (!u) return NextResponse.json({ ok: false, error: "Sin permiso" }, { status: 403 });
  const { data } = await db()
    .from("ed_eventos_salida")
    .select("id, tipo, intentos, ultimo_error, creado_en")
    .eq("cliente_id", u.clienteId).eq("estado", "fallido")
    .order("creado_en", { ascending: false }).limit(50);
  return NextResponse.json({ ok: true, fallidos: data ?? [] });
}

export async function POST(request: Request) {
  const u = await autorizar();
  if (!u) return NextResponse.json({ ok: false, error: "Sin permiso" }, { status: 403 });
  const cuerpo = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(cuerpo.ids) ? cuerpo.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined;
  const n = await reencolarFallidos(u.clienteId, ids);
  return NextResponse.json({ ok: true, reencolados: n });
}
