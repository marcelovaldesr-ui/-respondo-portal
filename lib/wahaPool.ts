import { createHash } from "node:crypto";

/**
 * CLIENTE WAHA PARA EL POOL DE NÚMEROS DE KAMBAK (Marketing).
 *
 * Módulo independiente del WAHA legado (lib/waha.ts).
 * Recibe SIEMPRE el nombre de la sesión como parámetro para poder rotar
 * entre múltiples chips/números.
 *
 * Variables de entorno:
 *   WAHA_POOL_URL      Base de la API en Railway (ej. https://waha-pool.up.railway.app)
 *   WAHA_POOL_API_KEY  Clave de API global para el servicio WAHA
 *   WAHA_POOL_APAGADO  "1" para apagar el pool globalmente (kill switch)
 *   RESPONDO_POOL_SIMULADO "1" para preview/testing sin llamar a la API real
 */

export function poolSimulado(): boolean {
  return process.env.RESPONDO_POOL_SIMULADO === "1";
}

export function wahaPoolApagado(): boolean {
  return process.env.WAHA_POOL_APAGADO === "1";
}

export function wahaPoolConfigurado(): boolean {
  const url = process.env.WAHA_POOL_URL;
  const key = process.env.WAHA_POOL_API_KEY;
  return Boolean(url && key);
}

function baseUrl(): string {
  return (process.env.WAHA_POOL_URL || "").replace(/\/+$/, "");
}

function apiKey(): string {
  return process.env.WAHA_POOL_API_KEY || "";
}

/** Formatea destino: "569XXXXXXXX@c.us" o respeta JID si ya trae @. */
export function aDestinoPool(x: string): string {
  if (x.includes("@")) return x.replace("@s.whatsapp.net", "@c.us");
  return `${x.replace(/\D/g, "")}@c.us`;
}

/** Extrae el id normalizado GOWS tras el último "_". */
export function normalizeWaId(raw: unknown): string | null {
  let s: string | null = null;
  if (typeof raw === "string") s = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as { _serialized?: string; id?: string };
    s = o._serialized || o.id || null;
  }
  if (!s) return null;
  const i = s.lastIndexOf("_");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Verifica si un teléfono está registrado en WhatsApp usando el endpoint
 * GET /api/contacts/check-exists de WAHA.
 */
export async function existeEnWhatsApp(
  sesion: string,
  tel: string,
): Promise<{ ok: boolean; existe: boolean; error?: string }> {
  if (poolSimulado()) {
    // En modo simulado números con 569 y 8 dígitos existen
    const digitos = tel.replace(/\D/g, "");
    const existe = /^569\d{8}$/.test(digitos);
    return { ok: true, existe };
  }

  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) {
    return { ok: false, existe: false, error: "Falta WAHA_POOL_URL o WAHA_POOL_API_KEY" };
  }

  const limpio = tel.replace(/\D/g, "");
  try {
    const r = await fetch(
      `${base}/api/contacts/check-exists?phone=${encodeURIComponent(limpio)}&session=${encodeURIComponent(sesion)}`,
      {
        headers: { "X-Api-Key": key },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, existe: false, error: `HTTP ${r.status}: ${txt.slice(0, 150)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { numberExists?: boolean };
    return { ok: true, existe: Boolean(j.numberExists) };
  } catch (e) {
    return { ok: false, existe: false, error: (e as Error).message };
  }
}

/**
 * Inicia la presencia "escribiendo…" en el chat.
 */
export async function iniciarTipeo(
  sesion: string,
  destino: string,
): Promise<{ ok: boolean; error?: string }> {
  if (poolSimulado()) return { ok: true };
  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) return { ok: false, error: "Falta WAHA_POOL_URL/WAHA_POOL_API_KEY" };

  try {
    const r = await fetch(`${base}/api/startTyping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ session: sesion, chatId: aDestinoPool(destino) }),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Detiene la presencia "escribiendo…" en el chat.
 */
export async function pararTipeo(
  sesion: string,
  destino: string,
): Promise<{ ok: boolean; error?: string }> {
  if (poolSimulado()) return { ok: true };
  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) return { ok: false, error: "Falta WAHA_POOL_URL/WAHA_POOL_API_KEY" };

  try {
    const r = await fetch(`${base}/api/stopTyping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ session: sesion, chatId: aDestinoPool(destino) }),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Consulta el estado de una sesión en WAHA (GET /api/sessions/{session}).
 * Posibles estados: 'WORKING', 'STARTING', 'SCAN_QR_CODE', 'FAILED', 'STOPPED', etc.
 */
export async function estadoSesion(
  sesion: string,
): Promise<{ ok: boolean; status: string; me?: { id?: string }; error?: string }> {
  if (poolSimulado()) {
    return { ok: true, status: "WORKING", me: { id: "simulated@c.us" } };
  }

  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) {
    return { ok: false, status: "UNKNOWN", error: "Falta WAHA_POOL_URL o WAHA_POOL_API_KEY" };
  }

  try {
    const r = await fetch(`${base}/api/sessions/${encodeURIComponent(sesion)}`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) {
      return { ok: false, status: "UNKNOWN", error: `HTTP ${r.status}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      status?: string;
      me?: { id?: string };
    };
    return {
      ok: true,
      status: j.status ?? "UNKNOWN",
      me: j.me,
    };
  } catch (e) {
    return { ok: false, status: "UNKNOWN", error: (e as Error).message };
  }
}

/**
 * Envía un mensaje de texto a través del pool usando la sesión indicada.
 */
export async function enviarTextoPool(
  sesion: string,
  destino: string,
  texto: string,
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  if (poolSimulado()) {
    const waId = `sim.${createHash("sha1").update(`${sesion}:${destino}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 16)}`;
    return { ok: true, waId };
  }

  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) {
    return { ok: false, error: "Falta WAHA_POOL_URL o WAHA_POOL_API_KEY" };
  }

  const chatId = aDestinoPool(destino);
  try {
    const r = await fetch(`${base}/api/sendText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ session: sesion, chatId, text: texto }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, waId: normalizeWaId(j.id) ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
