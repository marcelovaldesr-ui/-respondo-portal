import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { COOKIE_PUSH, decidirSincronizacion, huellaEndpoint } from "@/lib/push";
import { peticionDelPortal } from "@/lib/origenes";

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
 *
 * (Fase 1)
 *  · Solo desde el propio portal (Origin): un sitio vecino con las cookies no
 *    puede suscribir su propio endpoint a un negocio.
 *  · `sincronizar: true` (la re-sincronización silenciosa al abrir Inicio) NUNCA
 *    cambia de dueño una suscripción: si es de otra cuenta, o ya no existe, se
 *    responde 409 y el navegador se da de baja. Solo un «Activar avisos»
 *    explícito crea o reasigna.
 *  · Cookie HttpOnly con la huella del endpoint: permite que /auth/salir borre
 *    la suscripción de ESTE navegador aunque el JavaScript no alcance a hacerlo.
 */

const COOKIE_OPCIONES = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

export async function POST(request: NextRequest) {
  if (!peticionDelPortal(request)) {
    return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  }
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
    sincronizar?: boolean;
  } | null;

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: "Suscripción incompleta" }, { status: 400 });
  }

  const supa = db();

  if (body?.sincronizar === true) {
    const { data: fila, error: errLeer } = await supa
      .from("ed_push_suscripciones")
      .select("email, cliente_id")
      .eq("endpoint", endpoint)
      .maybeSingle();
    if (errLeer) {
      return NextResponse.json({ ok: false, error: "No se pudo verificar la suscripción" }, { status: 503 });
    }
    const decision = decidirSincronizacion(fila, usuario);
    if (decision !== "propia") {
      // No se traspasa en silencio: el navegador se da de baja y la persona
      // decide si activa los avisos con SU cuenta.
      return NextResponse.json({ ok: false, codigo: "no_vinculada" }, { status: 409 });
    }
  }

  const { error } = await supa
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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_PUSH, huellaEndpoint(endpoint), COOKIE_OPCIONES);
  return res;
}

export async function DELETE(request: NextRequest) {
  if (!peticionDelPortal(request)) {
    return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  }
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });

  // (Fase 1) El endpoint viaja en el cuerpo: en la URL quedaba en los logs.
  // Se acepta todavía por query para navegadores con la versión anterior abierta.
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  const endpoint = body?.endpoint || new URL(request.url).searchParams.get("endpoint") || "";
  if (!endpoint) return NextResponse.json({ ok: false, error: "Falta endpoint" }, { status: 400 });

  // Se filtra también por cliente: nadie puede dar de baja el dispositivo de
  // otro negocio conociendo su endpoint.
  await db()
    .from("ed_push_suscripciones")
    .delete()
    .eq("endpoint", endpoint)
    .eq("cliente_id", usuario.clienteId);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_PUSH);
  return res;
}
