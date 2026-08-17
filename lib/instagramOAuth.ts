import { cifrar, firmarEstado, verificarEstado } from "@/lib/cifrado";

/**
 * BUSINESS LOGIN FOR INSTAGRAM — el flujo con el que un cliente conecta SU
 * cuenta de Instagram a Respondo.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: hasta hoy el canal de Instagram funcionaba
 * pegando `ig_user_id` e `ig_token` a mano con un UPDATE de SQL. Eso alcanzaba
 * para probar, pero no sirve para dos cosas que importan:
 *
 *  1. La revisión de Meta. El revisor tiene que poder conectar una cuenta él
 *     mismo. Un token pegado a mano no le muestra nada.
 *  2. Vender. Ningún cliente va a mandarnos su token por WhatsApp.
 *
 * SE USA "LOGIN DE INSTAGRAM", NO EL DE FACEBOOK (decisión del 3-ago-2026,
 * verificada en la documentación): el de Facebook exige que la cuenta esté
 * vinculada a una PÁGINA de Facebook administrable y pide 4 permisos. En la
 * pyme chilena esa página suele estar abandonada o a nombre de un ex empleado,
 * y pedir recuperarla mata la venta en la reunión. Este camino no pide página y
 * pide 2 permisos.
 *
 * ENDPOINTS (documentación de Meta, no de memoria):
 *   autorizar        https://www.instagram.com/oauth/authorize
 *   código → token   https://api.instagram.com/oauth/access_token   (POST form)
 *   token → 60 días  https://graph.instagram.com/access_token       (ig_exchange_token)
 *   renovar          https://graph.instagram.com/refresh_access_token
 *
 * ⚠️ La URL de autorización hay que CONTRARRESTARLA con la que genera el propio
 * panel de Meta en "Business login settings": el panel arma la URL completa y
 * esa es la fuente de verdad. Si no coinciden, manda la del panel.
 */

const AUTORIZAR = "https://www.instagram.com/oauth/authorize";
const TOKEN_CORTO = "https://api.instagram.com/oauth/access_token";
const TOKEN_LARGO = "https://graph.instagram.com/access_token";
const GRAPH_IG = "https://graph.instagram.com/v23.0";

/**
 * Los DOS permisos, y solo esos.
 *
 * `instagram_business_basic` identifica la cuenta; `..._manage_messages` recibe
 * y responde mensajes directos. No se piden los de comentarios ni publicación:
 * pedir permisos que no se usan es de los motivos más comunes de rechazo, y
 * además alarga la revisión sin darnos nada.
 */
export const SCOPES_IG = ["instagram_business_basic", "instagram_business_manage_messages"];

function credenciales(): { id: string; secreto: string } | null {
  const id = process.env.IG_APP_ID?.trim();
  const secreto = process.env.IG_APP_SECRET?.trim();
  if (!id || !secreto) return null;
  return { id, secreto };
}

/** ¿Está configurado el botón? Si no, el portal simplemente no lo muestra. */
export function instagramConfigurado(): boolean {
  return credenciales() !== null;
}

/**
 * Igual que en Google: fijo a propósito, no derivado del request. Tiene que ser
 * BYTE A BYTE el mismo que se registre en el panel de Meta como URI de
 * redirección válida, o Instagram rechaza el intercambio.
 */
const URL_PORTAL = (process.env.NEXT_PUBLIC_SITE_URL || "https://respondo-portal.vercel.app").replace(/\/+$/, "");
export const REDIRECT_URI_IG = `${URL_PORTAL}/api/instagram/callback`;

export function urlAutorizacionIg(clienteId: string): string {
  const cred = credenciales();
  if (!cred) throw new Error("IG_APP_ID / IG_APP_SECRET no configurados");
  const params = new URLSearchParams({
    client_id: cred.id,
    redirect_uri: REDIRECT_URI_IG,
    response_type: "code",
    scope: SCOPES_IG.join(","),
    state: firmarEstado({ clienteId }, "ig-estado"),
  });
  return `${AUTORIZAR}?${params.toString()}`;
}

export function clienteDelEstadoIg(estado: string): string | null {
  const datos = verificarEstado(estado, "ig-estado");
  return datos?.clienteId ?? null;
}

export type ResultadoIg<T> = { ok: true; datos: T } | { ok: false; motivo: string };

/**
 * Paso 1: el `code` del callback por un token corto + el id de la cuenta.
 * El código dura 1 hora y se puede usar UNA sola vez.
 */
export async function intercambiarCodigoIg(
  code: string,
): Promise<ResultadoIg<{ tokenCorto: string; igUserId: string }>> {
  const cred = credenciales();
  if (!cred) return { ok: false, motivo: "sin_credenciales" };
  try {
    const r = await fetch(TOKEN_CORTO, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cred.id,
        client_secret: cred.secreto,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI_IG,
        code,
      }),
      cache: "no-store",
    });
    const j = (await r.json()) as {
      access_token?: string;
      user_id?: string | number;
      error_message?: string;
      error_type?: string;
    };
    if (!r.ok || !j.access_token || !j.user_id) {
      return { ok: false, motivo: j.error_message ?? j.error_type ?? `HTTP ${r.status}` };
    }
    return { ok: true, datos: { tokenCorto: j.access_token, igUserId: String(j.user_id) } };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

/**
 * Paso 2: token corto (1 hora) por uno largo (60 días).
 * Sin este paso el canal se apaga solo dentro de la misma tarde.
 */
export async function tokenLargoIg(
  tokenCorto: string,
): Promise<ResultadoIg<{ token: string; venceIso: string }>> {
  const cred = credenciales();
  if (!cred) return { ok: false, motivo: "sin_credenciales" };
  try {
    const url = `${TOKEN_LARGO}?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(cred.secreto)}&access_token=${encodeURIComponent(tokenCorto)}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!r.ok || !j.access_token) {
      return { ok: false, motivo: j.error?.message ?? `HTTP ${r.status}` };
    }
    // 5.184.000 s = 60 días, el valor que documenta Meta si no viniera.
    const venceIso = new Date(Date.now() + (j.expires_in ?? 5_184_000) * 1000).toISOString();
    return { ok: true, datos: { token: j.access_token, venceIso } };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

/**
 * Paso 3, EL QUE SE OLVIDA: suscribir la cuenta a los webhooks.
 *
 * Sin esta llamada todo parece haber salido bien —hay token, hay id, el portal
 * dice "conectado"— y NO LLEGA NI UN MENSAJE. No hay error, no hay síntoma: los
 * DMs simplemente nunca entran. Es la misma familia de fallo que el scope
 * `calendar.freebusy` que faltaba en Google.
 *
 * `messages` trae los mensajes entrantes; `messaging_postbacks`, las respuestas
 * a botones.
 */
export async function suscribirWebhooksIg(igUserId: string, token: string): Promise<ResultadoIg<true>> {
  try {
    const r = await fetch(
      `${GRAPH_IG}/${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const j = (await r.json()) as { success?: boolean; error?: { message?: string } };
    if (!r.ok || !j.success) return { ok: false, motivo: j.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, datos: true };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

/** Nombre de usuario de la cuenta, solo para mostrarlo en el portal. */
export async function perfilIg(igUserId: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(`${GRAPH_IG}/${encodeURIComponent(igUserId)}?fields=username`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { username?: string };
    return j.username ?? null;
  } catch {
    return null;
  }
}

/** El token que se guarda en la base va cifrado, igual que el de WhatsApp. */
export function cifrarTokenIg(token: string): string {
  return cifrar(token, "ig-token");
}
