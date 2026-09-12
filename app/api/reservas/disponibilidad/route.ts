import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { disponibilidad } from "@/lib/agenda";
import { diaChileDe } from "@/lib/agendaCore";
import { limitarDistribuido } from "@/lib/seguridad";
import { esUuid, ipDeRequest, rangoDelMes, rangoDelDia } from "@/lib/reservasPublicas";

export const dynamic = "force-dynamic";

/**
 * DISPONIBILIDAD PÚBLICA — la consume el widget de /reservar/[slug].
 *
 * Sin auth (es la página pública), con rate-limit por IP y exponiendo SOLO lo
 * mínimo. Dos modos, y esa es la diferencia con la versión anterior:
 *
 *  · `modo=dias&mes=2026-09` → qué DÍAS del mes tienen al menos un cupo. Para
 *    pintar el calendario basta con eso, así que el cálculo se detiene en el
 *    primer cupo de cada día.
 *  · `modo=horas&fecha=2026-09-18` → las horas de ESE día, ya deduplicadas.
 *
 * Antes había un solo modo que devolvía «los próximos 120 cupos»: con tres
 * profesionales eso eran dos días, el calendario mostraba el mes casi vacío y
 * la respuesta pesaba lo mismo aunque solo se quisiera saber qué días abren.
 *
 * `profesional` es opcional: sin él la respuesta es «cualquiera» (un cupo por
 * hora, con la lista de quiénes pueden tomarlo).
 */
export async function GET(request: NextRequest) {
  const ip = ipDeRequest(request.headers);
  if (!(await limitarDistribuido(`disp:${ip}`, 60, 60)).ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const servicioId = url.searchParams.get("servicio") ?? "";
  const profesional = url.searchParams.get("profesional");
  const modo = url.searchParams.get("modo") === "horas" ? "horas" : "dias";
  if (!slug || !esUuid(servicioId)) {
    return NextResponse.json({ ok: false, error: "parametros" }, { status: 400 });
  }
  if (profesional && !esUuid(profesional)) {
    return NextResponse.json({ ok: false, error: "parametros" }, { status: 400 });
  }

  const rango =
    modo === "horas"
      ? rangoDelDia(url.searchParams.get("fecha"))
      : rangoDelMes(url.searchParams.get("mes"));
  if (!rango) return NextResponse.json({ ok: false, error: "parametros" }, { status: 400 });

  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("id")
    .eq("slug", slug)
    .eq("reservas_online", true)
    .eq("activo", true)
    .maybeSingle();
  if (!cliente) return NextResponse.json({ ok: false, error: "no_existe" }, { status: 404 });

  const disp = await disponibilidad(cliente.id as string, servicioId, {
    desdeDia: rango.desde,
    dias: rango.dias,
    profesionalId: profesional,
    soloPrimeroPorDia: modo === "dias",
    maxPorDia: modo === "dias" ? 1 : 60,
  });
  if (!disp.ok) return NextResponse.json({ ok: false, error: disp.motivo }, { status: 404 });

  const comun = {
    ok: true as const,
    servicio: {
      nombre: disp.servicio.nombre,
      duracion_min: disp.servicio.duracion_min,
      precio_clp: disp.servicio.precio_clp,
    },
    // El selector público necesita nombres; nada más del negocio viaja.
    profesionales: disp.profesionales.map((p) => ({ id: p.id, nombre: p.nombre })),
  };

  if (modo === "dias") {
    return NextResponse.json({ ...comun, dias: [...new Set(disp.slots.map((s) => diaChileDe(s.inicio)))] });
  }

  return NextResponse.json({
    ...comun,
    horas: disp.slots.map((s) => ({
      inicio: s.inicio,
      // Cuántas personas pueden tomarla: sirve para decir «quedan pocas» sin
      // repetir la misma hora N veces, que era el problema de antes.
      profesionales: s.profesionales,
    })),
  });
}
