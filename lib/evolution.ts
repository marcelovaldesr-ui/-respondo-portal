import { db } from "@/lib/db";

/**
 * Integración con Evolution API (WhatsApp NO oficial / Opción A).
 *
 * A diferencia de la Cloud API oficial (lib/whatsapp.ts, Opción B), acá el
 * transporte es una instancia de Evolution conectada por QR. El cerebro de
 * Tino es EXACTAMENTE el mismo (lib/responderBot.ts): solo cambia cómo entra
 * el mensaje (parsearEvolution) y cómo sale la respuesta (enviarTextoEvolution).
 * La orquestación (idempotencia, toma de control humana, respuesta) vive en
 * lib/inboundEvolution.ts.
 *
 * Config por entorno:
 *   EVOLUTION_API_URL  base de la API (sin slash final)
 *   EVOLUTION_API_KEY  apikey global de Evolution (header `apikey`)
 * El nombre de la instancia viene en cada webhook (body.instance) y mapea al
 * cliente vía ed_clientes.waba_phone_id.
 */

const BASE = (
  process.env.EVOLUTION_API_URL ||
  "https://evolution-api-production-3386.up.railway.app"
).replace(/\/+$/, "");

/** Mensaje entrante ya normalizado desde el webhook de Evolution. */
export type EntranteEvolution = {
  instancia: string; // nombre de la instancia Evolution (mapea a cliente)
  chatId: string; // número del otro extremo, solo dígitos (sin @s.whatsapp.net)
  jid: string; // remoteJid completo, por si se necesita
  texto: string;
  nombre?: string; // pushName de WhatsApp, si viene
  fromMe: boolean; // true = salió del número del negocio (eco de Tino o mensaje humano)
  waId: string | null; // data.key.id → idempotencia y distinción de eco
};

/**
 * Resuelve el cliente a partir del nombre de instancia (body.instance).
 * Impresora Color: instancia "impresora-color" → cliente 3333...
 */
export async function clientePorInstancia(
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
 * Envía un mensaje de texto por Evolution (endpoint sendText).
 * Devuelve el id del mensaje creado (data.key.id) para poder reconocer luego su
 * eco en el webhook y no tratarlo como intervención humana.
 */
export async function enviarTextoEvolution(
  instancia: string,
  numero: string,
  texto: string,
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) return { ok: false, error: "Falta EVOLUTION_API_KEY" };
  try {
    const r = await fetch(`${BASE}/message/sendText/${instancia}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify({ number: numero, text: texto }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      key?: { id?: string };
    };
    return { ok: true, waId: j?.key?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Extrae el mensaje de texto de un payload del webhook de Evolution
 * (evento MESSAGES_UPSERT). Devuelve null cuando NO hay nada que procesar:
 *  - evento distinto de messages.upsert
 *  - chat de grupo / broadcast / estados
 *  - mensaje sin texto (audio, imagen, sticker, etc. — fase posterior)
 *
 * IMPORTANTE: a diferencia de la versión anterior, ya NO se descartan los
 * mensajes `fromMe`. Se devuelven marcados con fromMe=true porque un `fromMe`
 * puede ser (a) el eco del propio envío de Tino o (b) un mensaje escrito por una
 * PERSONA (Cecilia) desde el WhatsApp del negocio → toma de control humana. Esa
 * distinción se resuelve aguas abajo con el id (ver lib/inboundEvolution.ts).
 */
export function parsearEvolution(payload: unknown): EntranteEvolution | null {
  const body = payload as {
    event?: string;
    instance?: string;
    data?: {
      key?: { remoteJid?: string; fromMe?: boolean; id?: string };
      pushName?: string;
      message?: {
        conversation?: string;
        extendedTextMessage?: { text?: string };
      };
    };
  };

  if (body?.event && body.event !== "messages.upsert") return null;

  const data = body?.data ?? {};
  const key = data.key ?? {};
  const jid = key.remoteJid ?? "";
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast")
    return null;

  const m = data.message ?? {};
  const texto = m.conversation ?? m.extendedTextMessage?.text ?? null;
  if (!texto) return null;

  const instancia = body?.instance ?? "";
  if (!instancia) return null;

  return {
    instancia,
    chatId: jid.replace(/@.*$/, ""),
    jid,
    texto,
    nombre: data.pushName ?? undefined,
    fromMe: key.fromMe === true,
    waId: key.id ?? null,
  };
}
