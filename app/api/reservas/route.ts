import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { crearCita } from "@/lib/agenda";
import { programarSeguimientosCita } from "@/lib/agendaSeguimientos";
import { formatearSlot } from "@/lib/agendaCore";
import { limitar } from "@/lib/seguridad";

export const dynamic = "force-dynamic";

/**
 * CREAR RESERVA PÚBLICA (F1). Entra por la MISMA vía que las citas de
 * WhatsApp (crearCita → constraint anti doble-reserva de Postgres), así web y
 * WhatsApp jamás pueden tomar el mismo cupo dos veces.
 *
 * Anti-abuso: rate-limit por IP, honeypot ("web" debe venir vacío),
 * validación estricta y tope de reservas activas por teléfono.
 */

function normalizarTelefono(crudo: string): string | null {
  const digitos = crudo.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  if (digitos.startsWith("56")) return digitos;
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;
  return digitos;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (!limitar(`resv:${ip}`, 6, 300).ok) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos, espera un momento." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  // Honeypot: los humanos no ven este campo; un bot que lo rellena, afuera.
  if (String(body.web ?? "") !== "") {
    return NextResponse.json({ ok: true, mensaje: "Reserva recibida." });
  }

  const slug = String(body.slug ?? "").trim();
  const servicioId = String(body.servicioId ?? "").trim();
  const profesionalId = String(body.profesionalId ?? "").trim();
  const inicio = String(body.inicio ?? "").trim();
  const nombre = String(body.nombre ?? "").trim().slice(0, 80);
  const telefono = normalizarTelefono(String(body.telefono ?? ""));

  if (!slug || !servicioId || !profesionalId || !inicio || nombre.length < 2 || !telefono) {
    return NextResponse.json({ ok: false, error: "Revisa tu nombre y teléfono." }, { status: 400 });
  }
  if (Number.isNaN(Date.parse(inicio)) || Date.parse(inicio) < Date.now()) {
    return NextResponse.json({ ok: false, error: "Ese horario ya no es válido." }, { status: 400 });
  }

  const supa = db();
  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("id, nombre, confirmacion_automatica, telefono_escalacion")
    .eq("slug", slug)
    .eq("reservas_online", true)
    .eq("activo", true)
    .maybeSingle();
  if (!cliente) return NextResponse.json({ ok: false, error: "Página no disponible." }, { status: 404 });

  // Tope de reservas activas por teléfono (anti-spam sencillo).
  const { count } = await supa
    .from("ed_citas")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", cliente.id as string)
    .eq("chat_id", telefono)
    .in("estado", ["agendada", "confirmada", "reagendada"])
    .gte("fin", new Date().toISOString());
  if ((count ?? 0) >= 3) {
    return NextResponse.json(
      { ok: false, error: "Ya tienes varias horas reservadas. Escríbenos por WhatsApp para coordinar." },
      { status: 409 },
    );
  }

  const r = await crearCita(
    {
      clienteId: cliente.id as string,
      servicioId,
      profesionalId,
      inicioIso: inicio,
      nombreContacto: nombre,
      telefono,
      chatId: telefono,
      origen: "web",
    },
    supa,
  );

  if (!r.ok) {
    if (r.motivo === "cupo_tomado") {
      return NextResponse.json(
        { ok: false, error: "cupo_tomado", mensaje: "Ese horario se acaba de ocupar. Elige otro, por favor." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: "No se pudo crear la reserva." }, { status: 400 });
  }

  // Recordatorios (F3) — best-effort, jamás rompe la reserva.
  const { data: svc } = await supa
    .from("ed_servicios")
    .select("nombre")
    .eq("id", servicioId)
    .maybeSingle();
  await programarSeguimientosCita({
    cita: r.cita,
    servicioNombre: (svc?.nombre as string) ?? "tu hora",
    clienteId: cliente.id as string,
    supa,
  }).catch(() => 0);

  // Puente al WhatsApp del negocio (donde viven los empleados IA).
  const telNegocio = Array.isArray(cliente.telefono_escalacion)
    ? String(cliente.telefono_escalacion[0] ?? "").replace(/\D/g, "")
    : "";
  const textoWa = encodeURIComponent(
    `Hola! Soy ${nombre}, acabo de reservar ${(svc?.nombre as string) ?? "una hora"} para el ${formatearSlot(r.cita.inicio)} 🙌`,
  );

  return NextResponse.json({
    ok: true,
    cuando: formatearSlot(r.cita.inicio),
    requiereConfirmacion: cliente.confirmacion_automatica === false,
    whatsapp: telNegocio ? `https://wa.me/${telNegocio}?text=${textoWa}` : null,
  });
}
