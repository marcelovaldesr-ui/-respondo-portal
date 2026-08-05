import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitarDistribuido } from "@/lib/seguridad";
import { parsearJsonAcotado } from "@/lib/reservasPublicas";
import { auditarAccion } from "@/lib/auditoria";
import { idSolicitud } from "@/lib/observabilidad";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Onboarding de un número de WhatsApp a la Cloud API vía EMBEDDED SIGNUP
 * (Respondo como Tech Provider directo de Meta — sin BSP).
 *
 * El frontend (botón "Conectar WhatsApp" con FB.login + config_id) obtiene:
 *   - `code`           → se canjea acá por un token de negocio.
 *   - `wabaId`         → WhatsApp Business Account del cliente.
 *   - `phoneNumberId`  → número dentro de esa WABA.
 * (En Coexistencia, el número sigue en la app de WhatsApp Business del cliente.)
 *
 * Este endpoint:
 *   1) Canjea el code por un access token.
 *   2) Suscribe NUESTRA app a los webhooks de esa WABA (para recibir mensajes).
 *   3) Guarda waba_id / waba_phone_id / waba_token en ed_clientes del cliente
 *      logueado → a partir de ahí el envío (lib/whatsapp.ts) y el webhook ya
 *      funcionan multi-cliente (eso ya está construido).
 *
 * Requiere env: WHATSAPP_APP_ID, WHATSAPP_APP_SECRET (de la app de Meta de Respondo).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export async function POST(request: NextRequest) {
  const requestId = idSolicitud(request.headers);
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await limitarDistribuido(`meta-onboarding:${usuario.clienteId}`, 5, 600)).ok) {
    return NextResponse.json({ error: "Demasiados intentos" }, { status: 429 });
  }

  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "La integración de Meta no está configurada", requestId },
      { status: 500 },
    );
  }

  const json = parsearJsonAcotado(await request.text());
  if (!json) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const cuerpo = json as { code?: string; wabaId?: string; phoneNumberId?: string };
  const { code, wabaId, phoneNumberId } = cuerpo;
  if (
    typeof code !== "string" ||
    code.length < 8 ||
    code.length > 2_048 ||
    typeof wabaId !== "string" ||
    !/^\d{5,30}$/.test(wabaId) ||
    typeof phoneNumberId !== "string" ||
    !/^\d{5,30}$/.test(phoneNumberId)
  ) {
    return NextResponse.json(
      { error: "Faltan datos del Embedded Signup (code, wabaId, phoneNumberId)" },
      { status: 400 },
    );
  }

  try {
    // 1) Canjear el code por un access token de negocio.
    const tokenRes = await fetch(`${GRAPH}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: appId, client_secret: appSecret, code }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("[onboarding] canje de code rechazado:", tokenRes.status);
      return NextResponse.json(
        { error: "Meta rechazó la autorización", requestId },
        { status: 502 },
      );
    }
    const token = tokenJson.access_token;

    // Comprobar que el phone_number_id pertenece de verdad a la WABA que el
    // token acaba de autorizar. Los ids vienen del navegador y no son confiables.
    const telefonosRes = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const telefonosJson = (await telefonosRes.json().catch(() => ({}))) as {
      data?: { id?: string }[];
    };
    if (
      !telefonosRes.ok ||
      !telefonosJson.data?.some((telefono) => telefono.id === phoneNumberId)
    ) {
      return NextResponse.json(
        { error: "El número no pertenece a la cuenta de WhatsApp autorizada" },
        { status: 400 },
      );
    }

    // 2) Suscribir NUESTRA app a los webhooks de esa WABA (recibir mensajes).
    const subRes = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!subRes.ok) {
      console.error("[onboarding] subscribed_apps falló:", subRes.status);
      return NextResponse.json(
        { error: "No se pudo activar la recepción de mensajes para esta cuenta", requestId },
        { status: 502 },
      );
    }

    // 3) Guardar credenciales en ed_clientes del cliente logueado.
    const { error } = await db()
      .from("ed_clientes")
      .update({
        waba_id: wabaId,
        waba_phone_id: phoneNumberId,
        waba_token: token,
        // Sin esto, el cron y el inbox seguían mandando por WAHA aunque el
        // Embedded Signup hubiera terminado bien: leen la columna `transporte`,
        // no la presencia de `waba_id`. Faltaba este paso y había que
        // acordarse de cambiarlo a mano — el tipo de detalle que se olvida
        // justo con el primer cliente real que migra.
        transporte: "cloud",
      })
      .eq("id", usuario.clienteId);
    if (error) {
      console.error("[onboarding] no se pudo guardar:", error.message);
      return NextResponse.json({ error: "No se pudo guardar la conexión", requestId }, { status: 500 });
    }

    await auditarAccion(usuario, "integracion_meta_conectada", {
      recursoId: phoneNumberId,
      requestId,
    });

    return NextResponse.json({ ok: true, wabaId, phoneNumberId });
  } catch (e) {
    console.error("[onboarding] error:", (e as Error).message);
    return NextResponse.json({ error: "No se pudo completar la conexión", requestId }, { status: 500 });
  }
}
