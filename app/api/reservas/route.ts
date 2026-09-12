import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { reservarCupo } from "@/lib/agenda";
import { programarSeguimientosCita } from "@/lib/agendaSeguimientos";
import { formatearSlot } from "@/lib/agendaCore";
import { limitarDistribuido } from "@/lib/seguridad";
import { validarFicha, type CampoFicha } from "@/lib/fichaServicio";
import { origenCanonico } from "@/lib/origenes";
import {
  esUuid,
  ipDeRequest,
  normalizarNombre,
  normalizarTelefono,
  parsearJsonAcotado,
} from "@/lib/reservasPublicas";

export const dynamic = "force-dynamic";

/**
 * CREAR RESERVA PÚBLICA (F1). Entra por la MISMA vía que las citas de
 * WhatsApp (crearCita → constraint anti doble-reserva de Postgres), así web y
 * WhatsApp jamás pueden tomar el mismo cupo dos veces.
 *
 * Anti-abuso: rate-limit por IP, honeypot ("web" debe venir vacío),
 * validación estricta y tope de reservas activas por teléfono.
 */

export async function POST(request: NextRequest) {
  const ip = ipDeRequest(request.headers);
  if (!(await limitarDistribuido(`resv:${ip}`, 6, 300)).ok) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos, espera un momento." }, { status: 429 });
  }

  const body = parsearJsonAcotado(await request.text());
  if (!body) {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  // Honeypot: los humanos no ven este campo; un bot que lo rellena, afuera.
  if (String(body.web ?? "") !== "") {
    return NextResponse.json({ ok: true, mensaje: "Reserva recibida." });
  }

  const slug = String(body.slug ?? "").trim();
  const servicioId = String(body.servicioId ?? "").trim();
  /**
   * Profesional PEDIDO por el cliente. Vacío = «cualquiera», que es el caso
   * normal: el servidor elige entre los que de verdad están libres a esa hora
   * (ver `reservarCupo`). Antes este campo era obligatorio y la página mandaba
   * el profesional del cupo duplicado que el cliente hubiera tocado.
   */
  const profesionalId = String(body.profesionalId ?? "").trim();
  const inicio = String(body.inicio ?? "").trim();
  const nombre = normalizarNombre(String(body.nombre ?? ""));
  const telefono = normalizarTelefono(String(body.telefono ?? ""));

  if (!slug || !esUuid(servicioId) || !inicio || nombre.length < 2 || !telefono) {
    return NextResponse.json({ ok: false, error: "Revisa tu nombre y teléfono." }, { status: 400 });
  }
  if (profesionalId && !esUuid(profesionalId)) {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
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

  /**
   * FICHA DEL SERVICIO (migración 277) — se valida ACÁ, en el servidor.
   *
   * El formulario del navegador ayuda a que la persona no se equivoque, pero no
   * es una barrera: cualquiera puede mandar este POST a mano. Sin esta
   * validación se podría guardar una previsión que el negocio no ofrece, un RUT
   * inventado o un texto de 100 KB.
   */
  const { data: camposCrudos } = await supa
    .from("ed_servicio_campos")
    .select("id, etiqueta, tipo, opciones, obligatorio, ayuda, orden")
    .eq("servicio_id", servicioId)
    .order("orden", { ascending: true });

  let datosExtra: Record<string, string> | null = null;
  if (camposCrudos?.length) {
    const validada = validarFicha(camposCrudos as unknown as CampoFicha[], body.ficha);
    if (!validada.ok) {
      return NextResponse.json(
        { ok: false, error: "ficha_invalida", errores: validada.errores },
        { status: 400 },
      );
    }
    datosExtra = Object.keys(validada.datos).length ? validada.datos : null;
  }

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

  /**
   * El horario se REVALIDA dentro de `reservarCupo`: lo que el cliente vio
   * hace dos minutos no prueba nada. Ahí también se elige al profesional
   * cuando el cliente dijo «cualquiera» y se reintenta con el siguiente si le
   * ganaron la carrera por milisegundos.
   */
  const r = await reservarCupo(
    {
      clienteId: cliente.id as string,
      servicioId,
      profesionalId: profesionalId || null,
      inicioIso: inicio,
      nombreContacto: nombre,
      telefono,
      chatId: telefono,
      origen: "web",
      datosExtra,
    },
    supa,
  );

  if (!r.ok) {
    if (r.motivo === "cupo_tomado") {
      return NextResponse.json(
        {
          ok: false,
          error: "cupo_tomado",
          mensaje: "Ese horario acaba de ocuparse.",
          // Horas cercanas reales, para no dejar al cliente en un callejón.
          alternativas: (r.alternativas ?? []).map((s) => ({ inicio: s.inicio, texto: formatearSlot(s.inicio) })),
        },
        { status: 409 },
      );
    }
    if (r.motivo === "profesional_invalido" || r.motivo === "sin_profesionales") {
      return NextResponse.json(
        { ok: false, error: "horario_no_disponible", mensaje: "Ese horario ya no está disponible." },
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

  // Enlace de autogestión (migración 277): quien reserva por la web puede no
  // tener WhatsApp con el negocio, así que este enlace es su ÚNICA forma de
  // moverse solo. Se muestra en la pantalla de éxito para que lo guarde.
  const gestion = r.cita.gestion_token ? `${origenCanonico()}/cita/${r.cita.gestion_token}` : null;

  const { data: profAsignado } = await supa
    .from("ed_profesionales")
    .select("nombre")
    .eq("id", r.cita.profesional_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    cuando: formatearSlot(r.cita.inicio),
    inicio: r.cita.inicio,
    servicio: (svc?.nombre as string) ?? null,
    // A quién le tocó: cuando el cliente eligió «cualquiera», esto es lo único
    // que le dice con quién va.
    profesional: (profAsignado?.nombre as string) ?? null,
    requiereConfirmacion: cliente.confirmacion_automatica === false,
    whatsapp: telNegocio ? `https://wa.me/${telNegocio}?text=${textoWa}` : null,
    gestion,
  });
}
