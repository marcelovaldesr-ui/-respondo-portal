import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { inscribirEnClase, proximasClases } from "@/lib/clases";

export const dynamic = "force-dynamic";

/**
 * INSCRIPCIÓN A UNA CLASE desde la página pública de reservas.
 *
 * Ruta aparte de /api/reservas y no un parámetro más, a propósito: una
 * inscripción a clase y una reserva de hora se ven parecidas por fuera pero
 * tienen reglas distintas (cupo numérico vs. bloque exclusivo). Mezclarlas en
 * un endpoint con un `if` terminaría en que una corrección de una rompe la otra.
 *
 * SIN CUENTA DE USUARIO. La persona deja nombre y teléfono, nada más. Esa es la
 * decisión de diseño central de las clases: pedirle registrarse es el mayor
 * asesino de conversión que hay en reservas, y acá no hace falta porque el
 * teléfono ya identifica a la persona en ed_contactos.
 */

/** GET — próximas clases del negocio, para pintar la lista. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim();
  if (!slug) return NextResponse.json({ error: "falta_slug" }, { status: 400 });

  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("id, nombre, reservas_online")
    .eq("slug", slug)
    .maybeSingle();

  if (!cliente || cliente.reservas_online === false) {
    return NextResponse.json({ error: "no_disponible" }, { status: 404 });
  }

  const clases = await proximasClases(cliente.id as string, { dias: 21 });
  return NextResponse.json({
    negocio: cliente.nombre,
    clases: clases.map((c) => ({
      id: c.id,
      servicio: c.servicioNombre,
      profesional: c.profesionalNombre,
      inicio: c.inicio,
      fin: c.fin,
      lugaresLibres: c.lugaresLibres,
      cupoMaximo: c.cupoMaximo,
    })),
  });
}

/** POST — inscribir a una persona en una clase. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "json_invalido" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const claseId = String(body.claseId ?? "").trim();
  const nombre = String(body.nombre ?? "").trim();
  const telefono = String(body.telefono ?? "").trim();

  if (!slug || !claseId || nombre.length < 2 || !telefono) {
    return NextResponse.json({ error: "datos_incompletos" }, { status: 400 });
  }

  const { data: cliente } = await db()
    .from("ed_clientes")
    .select("id, reservas_online")
    .eq("slug", slug)
    .maybeSingle();

  if (!cliente || cliente.reservas_online === false) {
    return NextResponse.json({ error: "no_disponible" }, { status: 404 });
  }

  // El chat_id es el teléfono en dígitos: la MISMA clave con la que entra por
  // WhatsApp. Así quien reserva por la web y después escribe queda en una sola
  // ficha, no en dos personas distintas.
  const chatId = telefono.replace(/\D/g, "") || null;

  const r = await inscribirEnClase({
    claseId,
    clienteId: cliente.id as string,
    nombre,
    telefono,
    chatId,
    origen: "web",
  });

  if (r.ok) {
    return NextResponse.json({
      ok: true,
      lugaresLibres: Math.max(0, r.clase.cupoMaximo - r.clase.cupoOcupado),
    });
  }

  // Mensajes distintos por motivo: "se llenó" y "se canceló" llevan a la
  // persona a hacer cosas distintas, y un error genérico la deja sin saber si
  // reintentar o buscar otra hora.
  const mensajes: Record<string, string> = {
    cupo_tomado: "Esa clase acaba de llenarse. Elige otra y te inscribimos al tiro.",
    cancelada: "Esa clase fue cancelada. Elige otra de la lista.",
    ya_paso: "Esa clase ya comenzó. Elige una de las próximas.",
    no_existe: "No encontramos esa clase.",
    error: "No pudimos completar la inscripción. Intenta de nuevo en un momento.",
  };
  return NextResponse.json(
    { ok: false, motivo: r.motivo, mensaje: mensajes[r.motivo] ?? mensajes.error },
    { status: r.motivo === "cupo_tomado" ? 409 : 400 },
  );
}
