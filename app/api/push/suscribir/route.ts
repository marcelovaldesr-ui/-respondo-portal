import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";

export const dynamic = "force-dynamic";

/**
 * ALTA Y BAJA DE UN DISPOSITIVO PARA RECIBIR AVISOS.
 *
 * POST → registra este navegador. DELETE → lo da de baja.
 *
 * SEGURIDAD: la suscripción queda atada al `cliente_id` de la sesión, NO a lo
 * que mande el navegador. Si se aceptara un `cliente_id` del cuerpo, cualquiera
 * con sesión podría suscribirse a los avisos de otro negocio y ver de reojo las
 * conversaciones ajenas en su barra de notificaciones.
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  // Suscribirse escribe en la base; sin freno, una sesión comprometida podría
  // llenar la tabla de destinos basura. Diez por minuto es más que suficiente:
  // una persona se suscribe una vez por dispositivo.
  if (!(await limitarDistribuido(`push:${usuario.email}`, 10, 60)).ok) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos seguidos." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "Suscripción incompleta" }, { status: 400 });
  }

  const { error } = await db()
    .from("ed_push_suscripciones")
    .upsert(
      {
        cliente_id: usuario.clienteId,
        email: usuario.email,
        endpoint,
        p256dh,
        auth,
        // Se guarda recortado: sirve para reconocer el aparato, no para perfilar.
        agente: (request.headers.get("user-agent") ?? "").slice(0, 120),
        visto_en: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

  if (error) {
    // Tabla inexistente: la migración 283 todavía no se aplicó.
    console.warn("[push] no se pudo guardar la suscripción:", error.code, error.message);
    return NextResponse.json(
      { ok: false, error: "Las notificaciones todavía no están habilitadas en el servidor." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
  if (!endpoint) return NextResponse.json({ ok: false, error: "Falta endpoint" }, { status: 400 });

  // Se filtra también por cliente: nadie puede dar de baja el dispositivo de
  // otro negocio conociendo su endpoint.
  await db()
    .from("ed_push_suscripciones")
    .delete()
    .eq("endpoint", endpoint)
    .eq("cliente_id", usuario.clienteId);

  return NextResponse.json({ ok: true });
}
