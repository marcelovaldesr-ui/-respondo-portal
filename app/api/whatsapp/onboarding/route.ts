import { NextResponse, type NextRequest } from "next/server";
import { obtenerUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";

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
  const usuario = await obtenerUsuarioPortal();
  if (!usuario) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "Faltan WHATSAPP_APP_ID / WHATSAPP_APP_SECRET (app de Meta de Respondo)" },
      { status: 500 },
    );
  }

  let cuerpo: { code?: string; wabaId?: string; phoneNumberId?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const { code, wabaId, phoneNumberId } = cuerpo;
  if (!code || !wabaId || !phoneNumberId) {
    return NextResponse.json(
      { error: "Faltan datos del Embedded Signup (code, wabaId, phoneNumberId)" },
      { status: 400 },
    );
  }

  try {
    // 1) Canjear el code por un access token de negocio.
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`,
      { cache: "no-store" },
    );
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
    if (!tokenRes.ok || !tokenJson.access_token) {
      return NextResponse.json(
        { error: `No se pudo canjear el code: ${tokenJson.error?.message ?? tokenRes.status}` },
        { status: 502 },
      );
    }
    const token = tokenJson.access_token;

    // 2) Suscribir NUESTRA app a los webhooks de esa WABA (recibir mensajes).
    const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!subRes.ok) {
      const t = await subRes.text();
      console.error("[onboarding] subscribed_apps falló:", subRes.status, t.slice(0, 200));
      // No abortamos: a veces ya está suscrita. Se registra y sigue.
    }

    // 3) Guardar credenciales en ed_clientes del cliente logueado.
    const { error } = await db()
      .from("ed_clientes")
      .update({
        waba_id: wabaId,
        waba_phone_id: phoneNumberId,
        waba_token: token,
      })
      .eq("id", usuario.clienteId);
    if (error) {
      return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, wabaId, phoneNumberId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
