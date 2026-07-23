import { db } from "@/lib/db";

/**
 * Integración con WAHA (WhatsApp NO oficial / Opción A — motor GOWS/whatsmeow).
 *
 * Reemplaza a Evolution API como TRANSPORTE tras confirmar (22-jul-2026) que
 * Evolution v2.3.7/Baileys tenía roto el envío 1-a-1 (todos los sendText a
 * terceros → ERROR; grupos OK). WAHA con motor GOWS entrega bien (ack DEVICE).
 *
 * El cerebro de Tino es EXACTAMENTE el mismo (lib/responderBot.ts). Igual que
 * con Evolution, este adaptador solo define: cómo entra el mensaje (parsearWaha),
 * cómo se leen los ACKs (parsearAckWaha) y cómo sale la respuesta (enviarTextoWaha).
 * La orquestación vive en lib/inboundWaha.ts.
 *
 * Config por entorno:
 *   WAHA_API_URL      base de la API (sin slash final), p.ej.
 *                     https://waha-production-003e.up.railway.app
 *   WAHA_API_KEY      clave global de WAHA (header `X-Api-Key`)
 *   WAHA_SESSION      nombre de la sesión (default "default")
 *   WAHA_INSTANCIA    nombre lógico que mapea al cliente vía
 *                     ed_clientes.waba_phone_id (default "impresora-color",
 *                     reutiliza el registro que ya existía con Evolution).
 */

const BASE = (process.env.WAHA_API_URL || "").replace(/\/+$/, "");
const SESSION = process.env.WAHA_SESSION || "default";
/** Sesión WAHA → instancia lógica (para no duplicar el registro del cliente). */
const INSTANCIA = process.env.WAHA_INSTANCIA || "impresora-color";

/** Mensaje entrante ya normalizado desde el webhook de WAHA. */
export type EntranteWaha = {
  instancia: string; // instancia lógica (mapea a cliente) — NO el session name
  chatId: string; // número del otro extremo, solo dígitos
  jid: string; // "from" completo de WAHA (56...@c.us)
  texto: string;
  nombre?: string; // notifyName / pushName, si viene
  fromMe: boolean;
  waId: string | null; // id del mensaje → idempotencia y distinción de eco
};

/** Convierte un chatId de dígitos a formato WAHA (56...@c.us). */
function aChatId(numero: string): string {
  const limpio = numero.replace(/\D/g, "");
  return `${limpio}@c.us`;
}

/** Delay humano proporcional al texto (1.5–6s con jitter). */
function delayHumano(texto: string): number {
  const base = 1500 + texto.length * 35;
  const jitter = Math.floor(Math.random() * 1200);
  return Math.min(6000, Math.max(1500, base + jitter));
}

/**
 * Resuelve el cliente a partir de la instancia lógica (ed_clientes.waba_phone_id).
 * Reutiliza el mismo registro que usaba Evolution ("impresora-color").
 */
export async function clientePorInstanciaWaha(
  instancia: string,
): Promise<string | null> {
  const { data } = await db()
    .from("ed_clientes")
    .select("id")
    .eq("waba_phone_id", instancia)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/**
 * Envía un mensaje de texto por WAHA (endpoint /api/sendText).
 * Emula el tipeo humano: primero presencia "escribiendo…", luego el texto.
 * Devuelve el id del mensaje (para reconocer su eco y trackear su ACK).
 */
export async function enviarTextoWaha(
  numero: string,
  texto: string,
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const key = process.env.WAHA_API_KEY;
  if (!key || !BASE) return { ok: false, error: "Falta WAHA_API_URL/WAHA_API_KEY" };
  const chatId = aChatId(numero);
  const headers = { "Content-Type": "application/json", "X-Api-Key": key };
  try {
    // Presencia "escribiendo…" (best-effort; no bloquea el envío si falla).
    const espera = delayHumano(texto);
    try {
      await fetch(`${BASE}/api/startTyping`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session: SESSION, chatId }),
      });
      await new Promise((r) => setTimeout(r, espera));
      await fetch(`${BASE}/api/stopTyping`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session: SESSION, chatId }),
      });
    } catch {
      /* presencia opcional */
    }

    const r = await fetch(`${BASE}/api/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session: SESSION, chatId, text: texto }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      id?: string | { id?: string; _serialized?: string };
    };
    const waId =
      typeof j.id === "string" ? j.id : j.id?._serialized || j.id?.id;
    return { ok: true, waId: waId ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Extrae el mensaje de texto de un payload del webhook de WAHA (evento "message").
 * Devuelve null cuando no hay nada que procesar: evento distinto, grupo/estado,
 * o mensaje sin texto (media = fase posterior).
 *
 * Igual que en Evolution, NO se descartan los fromMe: pueden ser el eco de Tino
 * o un mensaje humano (toma de control). Se resuelve aguas abajo por el id.
 */
export function parsearWaha(payload: unknown): EntranteWaha | null {
  const body = payload as {
    event?: string;
    session?: string;
    payload?: {
      id?: string;
      from?: string;
      fromMe?: boolean;
      body?: string;
      notifyName?: string;
      _data?: { notifyName?: string; pushName?: string };
    };
  };

  if (body?.event && body.event !== "message") return null;
  const p = body?.payload ?? {};
  const from = p.from ?? "";
  if (!from || from.endsWith("@g.us") || from.endsWith("@broadcast") || from.includes("status@"))
    return null;

  const texto = (p.body ?? "").trim();
  if (!texto) return null;

  return {
    instancia: INSTANCIA,
    chatId: from.replace(/@.*$/, ""),
    jid: from,
    texto,
    nombre: p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? undefined,
    fromMe: p.fromMe === true,
    waId: p.id ?? null,
  };
}

// ============================================================================
// ACKs de entrega (evento "message.ack")
// ============================================================================

export type AckWaha = {
  instancia: string;
  waId: string;
  estado: "pendiente" | "server_ack" | "entregado" | "leido" | "error";
};

/**
 * Mapea el ack numérico de WAHA/whatsmeow a nuestro estado.
 * WAHA: -1/0 ERROR, 1 PENDING, 2 SERVER, 3 DEVICE(entregado), 4 READ, 5 PLAYED.
 * (En GOWS ack=2 ya llega con ackName "DEVICE" = entregado; se cubre por nombre.)
 */
export function parsearAckWaha(payload: unknown): AckWaha | null {
  const body = payload as {
    event?: string;
    payload?: { id?: string; ack?: number; ackName?: string };
  };
  if (body?.event !== "message.ack") return null;
  const p = body?.payload ?? {};
  if (!p.id) return null;

  const nombre = (p.ackName || "").toUpperCase();
  const porNombre: Record<string, AckWaha["estado"]> = {
    ERROR: "error",
    PENDING: "pendiente",
    SERVER: "server_ack",
    DEVICE: "entregado",
    READ: "leido",
    PLAYED: "leido",
  };
  const porNumero: Record<number, AckWaha["estado"]> = {
    [-1]: "error",
    0: "error",
    1: "pendiente",
    2: "server_ack",
    3: "entregado",
    4: "leido",
    5: "leido",
  };
  const estado =
    porNombre[nombre] ??
    (typeof p.ack === "number" ? porNumero[p.ack] : undefined);
  if (!estado) return null;
  return { instancia: INSTANCIA, waId: p.id, estado };
}
