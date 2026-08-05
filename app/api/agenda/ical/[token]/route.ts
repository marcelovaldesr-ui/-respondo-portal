import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { construirIcal, type EventoIcal } from "@/lib/ical";
import { limitarDistribuido } from "@/lib/seguridad";
import { ipDeRequest } from "@/lib/reservasPublicas";

export const dynamic = "force-dynamic";

/**
 * FEED iCal DEL NEGOCIO (F5 sin OAuth).
 *
 * El dueño pega esta URL en Google Calendar (Otros calendarios → Desde URL) y
 * ve sus horas de Respondo en el celular. No requiere login: la seguridad es
 * el token largo e irrepetible de la URL (mismo modelo que los calendarios
 * privados de Google). El token vive en ed_clientes.ical_token (migración 221)
 * y se puede rotar cambiando esa fila.
 *
 * Publica una ventana acotada (60 días atrás, 180 adelante) para que el
 * archivo no crezca sin control.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = ipDeRequest(request.headers);
  if (!(await limitarDistribuido(`ical:${ip}`, 60, 60)).ok) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  const { token: tokenParam } = await params;
  const token = (tokenParam ?? "").replace(/\.ics$/i, "").trim();
  if (!/^[a-f0-9]{32,64}$/i.test(token)) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  const supa = db();
  const { data: cliente, error } = await supa
    .from("ed_clientes")
    .select("id, nombre")
    .eq("ical_token", token)
    .eq("activo", true)
    .maybeSingle();

  // Si la migración 221 no está aplicada, la columna no existe: 404 limpio.
  if (error || !cliente) return new NextResponse("No encontrado", { status: 404 });

  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const hasta = new Date(Date.now() + 180 * 86_400_000).toISOString();

  const { data: citas } = await supa
    .from("ed_citas")
    .select(
      "id, nombre_contacto, telefono, chat_id, inicio, fin, estado, origen, actualizado_en, ed_servicios(nombre), ed_profesionales(nombre)",
    )
    .eq("cliente_id", cliente.id as string)
    .gte("inicio", desde)
    .lte("inicio", hasta)
    .order("inicio", { ascending: true });

  const eventos: EventoIcal[] = (citas ?? []).map((c) => {
    const fila = c as unknown as {
      id: string;
      nombre_contacto: string;
      telefono: string | null;
      chat_id: string | null;
      inicio: string;
      fin: string;
      estado: string;
      origen: string;
      actualizado_en: string | null;
      ed_servicios: { nombre: string } | null;
      ed_profesionales: { nombre: string } | null;
    };
    const servicio = fila.ed_servicios?.nombre ?? "Hora reservada";
    const profesional = fila.ed_profesionales?.nombre ?? "";
    const contacto = fila.telefono ?? fila.chat_id ?? "sin teléfono";

    return {
      id: fila.id,
      inicio: fila.inicio,
      fin: fila.fin,
      titulo: `${servicio} · ${fila.nombre_contacto}`,
      descripcion: [
        `Cliente: ${fila.nombre_contacto}`,
        `Contacto: ${contacto}`,
        profesional ? `Atiende: ${profesional}` : "",
        `Estado: ${fila.estado}`,
        `Reservado vía: ${fila.origen}`,
        "— Agenda de Respondo",
      ]
        .filter(Boolean)
        .join("\n"),
      cancelado: fila.estado === "cancelada" || fila.estado === "no_show",
      actualizado: fila.actualizado_en ?? undefined,
    };
  });

  const ics = construirIcal({
    nombreCalendario: `${cliente.nombre} · Respondo`,
    eventos,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="respondo-${token.slice(0, 8)}.ics"`,
      // Los lectores de calendario reconsultan solos; se evita caché agresiva
      // intermedia para que un cambio se vea en el siguiente refresco.
      // El token es una credencial y el feed contiene datos personales: no se
      // permite que una caché compartida/CDN conserve la respuesta.
      "Cache-Control": "private, max-age=300",
    },
  });
}
