import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { disponibilidad } from "@/lib/agenda";
import { limitar } from "@/lib/seguridad";

export const dynamic = "force-dynamic";

/**
 * DISPONIBILIDAD PÚBLICA (F1) — la consume el widget de /reservar/[slug].
 * Sin auth (es la página pública), con rate-limit por IP y exponiendo SOLO
 * lo mínimo: cupos y datos del servicio. Nada del negocio interno.
 */
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (!limitar(`disp:${ip}`, 30, 60).ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const servicioId = url.searchParams.get("servicio") ?? "";
  if (!slug || !servicioId) {
    return NextResponse.json({ ok: false, error: "parametros" }, { status: 400 });
  }

  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("id")
    .eq("slug", slug)
    .eq("reservas_online", true)
    .eq("activo", true)
    .maybeSingle();
  if (!cliente) return NextResponse.json({ ok: false, error: "no_existe" }, { status: 404 });

  const disp = await disponibilidad(cliente.id as string, servicioId, { maxSlots: 120 });
  if (!disp.ok) return NextResponse.json({ ok: false, error: disp.motivo }, { status: 404 });

  return NextResponse.json({
    ok: true,
    servicio: {
      nombre: disp.servicio.nombre,
      duracion_min: disp.servicio.duracion_min,
      precio_clp: disp.servicio.precio_clp,
    },
    slots: disp.slots.map((s) => ({
      inicio: s.inicio,
      profesionalId: s.profesionalId,
    })),
  });
}
