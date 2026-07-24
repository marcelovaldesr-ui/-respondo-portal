import { db } from "@/lib/db";

/**
 * Integración con WAHA (WhatsApp NO oficial / Opción A — motor GOWS/whatsmeow).
 *
 * Reemplaza a Evolution API como TRANSPORTE tras confirmar (22-jul-2026) que
 * Evolution v2.3.7/Baileys tenía roto el envío 1-a-1. WAHA con motor GOWS
 * entrega bien (ack DEVICE).
 *
 * El cerebro de Tino es EXACTAMENTE el mismo (lib/responderBot.ts). Este
 * adaptador solo define: cómo entra el mensaje (parsearWaha), cómo se leen los
 * ACKs (parsearAckWaha) y cómo sale la respuesta (enviarTextoWaha).
 *
 * IMPORTANTE — DIRECCIONAMIENTO LID (23-jul-2026): WhatsApp moderno + GOWS
 * identifican al contacto por un "LID" (p.ej. 223815175028761@lid) en vez del
 * número real. Hay que RESPONDER a la MISMA dirección de la que llegó el
 * mensaje (jid completo, con @lid o @c.us). Forzar @c.us cuando el origen era
 * @lid envía a un número inexistente → ERROR. Por eso guardamos el jid completo
 * y respondemos a él tal cual.
 *
 * Config por entorno:
 *   WAHA_API_URL      base de la API (sin slash final)
 *   WAHA_API_KEY      clave global de WAHA (header `X-Api-Key`)
 *   WAHA_SESSION      nombre de la sesión (default "default")
 *   WAHA_INSTANCIA    nombre lógico que mapea al cliente vía
 *                     ed_clientes.waba_phone_id (default "impresora-color").
 */

const BASE = (process.env.WAHA_API_URL || "").replace(/\/+$/, "");
const SESSION = process.env.WAHA_SESSION || "default";
const INSTANCIA = process.env.WAHA_INSTANCIA || "impresora-color";

/** Mensaje entrante ya normalizado desde el webhook de WAHA. */
export type EntranteWaha = {
  instancia: string; // instancia lógica (mapea a cliente)
  chatId: string; // solo dígitos del LID/número — clave estable en la BD
  jid: string; // dirección COMPLETA de origen (223...@lid o 569...@c.us)
  texto: string;
  nombre?: string;
  fromMe: boolean;
  waId: string | null; // id normalizado (GOWS) → idempotencia/eco/ack
  esMedia?: boolean; // true si el mensaje era imagen/audio/doc (texto sintético)
};

/**
 * Normaliza el id de un mensaje de WAHA a su parte GOWS estable.
 * WAHA serializa como "true_<chat>_<GOWSID>" o "false_<chat>_<GOWSID>".
 * Nos quedamos con <GOWSID> (lo que va después del último "_") para que el id
 * del envío, el del eco y el del ack SIEMPRE calcen, sin importar el envoltorio.
 */
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
 * Formatea una dirección de destino para WAHA. Si ya trae sufijo (@lid, @c.us,
 * @s.whatsapp.net) se respeta TAL CUAL (clave para responder a LIDs). Si son
 * solo dígitos, se asume número y se agrega @c.us.
 */
function aDestino(x: string): string {
  if (x.includes("@")) return x.replace("@s.whatsapp.net", "@c.us");
  return `${x.replace(/\D/g, "")}@c.us`;
}

/** Delay humano proporcional al texto (1–3s con jitter). Acotado para no sumar
 *  demasiada latencia al webhook (ya hay una ventana de debounce aguas arriba). */
function delayHumano(texto: string): number {
  const base = 1000 + texto.length * 20;
  const jitter = Math.floor(Math.random() * 800);
  return Math.min(3000, Math.max(1000, base + jitter));
}

/** Cache LID→número real (por invocación; evita repetir la consulta). */
const _lidCache = new Map<string, string>();

/**
 * IDENTIDAD ESTABLE DEL CONTACTO (fix fragmentación de chats, 23-jul-2026).
 *
 * WhatsApp identifica a la misma persona a veces por su NÚMERO (569...@c.us) y
 * a veces por un LID (223...@lid). Si se usa lo que llega crudo como clave, la
 * misma persona termina en 2 chats distintos. Esta función resuelve SIEMPRE al
 * número real (WAHA expone el mapeo en /api/{session}/lids/{lid}) y devuelve ese
 * número como `chatId` — la clave única de la conversación en la BD.
 *
 * Devuelve: chatId (dígitos del número real), telefono (+569...) y numeroReal
 * (bool: si se pudo resolver). Si NO se puede resolver un LID, cae a usar el LID
 * como clave (mejor eso que perder el mensaje) — es el peor caso, no el normal.
 */
export async function resolverContacto(jid: string): Promise<{
  chatId: string;
  telefono: string | null;
  numeroReal: boolean;
}> {
  const digits = jid.replace(/@.*$/, "");
  if (!jid.endsWith("@lid")) {
    // Ya es un número real (@c.us / @s.whatsapp.net).
    return { chatId: digits, telefono: `+${digits}`, numeroReal: true };
  }
  // Es un LID: resolver al número real.
  let pn = _lidCache.get(digits) || null;
  if (!pn) {
    const key = process.env.WAHA_API_KEY;
    if (key && BASE) {
      try {
        const r = await fetch(`${BASE}/api/${SESSION}/lids/${digits}`, {
          headers: { "X-Api-Key": key },
        });
        if (r.ok) {
          const j = (await r.json()) as { pn?: string };
          const p = (j.pn || "").replace(/@.*$/, "");
          if (p) {
            pn = p;
            _lidCache.set(digits, p);
          }
        }
      } catch {
        /* cae al fallback */
      }
    }
  }
  if (pn) return { chatId: pn, telefono: `+${pn}`, numeroReal: true };
  return { chatId: digits, telefono: null, numeroReal: false }; // fallback: LID
}

/**
 * Nombre visible del contacto (pushName), best-effort desde /api/contacts.
 * Devuelve null si no se puede (no rompe el flujo).
 */
export async function nombreDeContacto(jid: string): Promise<string | null> {
  const key = process.env.WAHA_API_KEY;
  if (!key || !BASE) return null;
  try {
    const r = await fetch(
      `${BASE}/api/contacts?session=${SESSION}&contactId=${encodeURIComponent(jid)}`,
      { headers: { "X-Api-Key": key } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { pushname?: string; name?: string };
    return j?.pushname || j?.name || null;
  } catch {
    return null;
  }
}

/** Resuelve el cliente a partir de la instancia lógica. */
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
 * `destino` puede ser el jid completo (223...@lid) o un número; se respeta el
 * sufijo para responder a LIDs. Emula tipeo humano y devuelve el id normalizado.
 */
export async function enviarTextoWaha(
  destino: string,
  texto: string,
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const key = process.env.WAHA_API_KEY;
  if (!key || !BASE) return { ok: false, error: "Falta WAHA_API_URL/WAHA_API_KEY" };
  const chatId = aDestino(destino);
  const headers = { "Content-Type": "application/json", "X-Api-Key": key };
  try {
    // Presencia "escribiendo…" (best-effort; no bloquea el envío si falla).
    try {
      await fetch(`${BASE}/api/startTyping`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session: SESSION, chatId }),
      });
      await new Promise((r) => setTimeout(r, delayHumano(texto)));
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
    const j = (await r.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, waId: normalizeWaId(j.id) ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Extrae el mensaje de texto de un payload del webhook de WAHA (evento "message").
 * Devuelve null si no hay nada que procesar (otro evento, grupo/estado, sin texto).
 * NO descarta fromMe (puede ser eco de Tino o mensaje humano; se resuelve por id).
 */
export function parsearWaha(payload: unknown): EntranteWaha | null {
  const body = payload as {
    event?: string;
    session?: string;
    payload?: {
      id?: unknown;
      from?: string;
      fromMe?: boolean;
      body?: string;
      type?: string;
      hasMedia?: boolean;
      notifyName?: string;
      _data?: { notifyName?: string; pushName?: string; Message?: unknown };
    };
  };

  if (body?.event && body.event !== "message") return null;
  const p = body?.payload ?? {};
  const from = p.from ?? "";
  if (!from || from.endsWith("@g.us") || from.endsWith("@broadcast") || from.includes("status@"))
    return null;

  let texto = (p.body ?? "").trim();
  let esMedia = false;

  // MEDIA (fix estabilización 24-jul): si no hay texto pero es un mensaje real
  // (imagen/audio/documento/etc), NO lo descartamos: generamos un texto
  // sintético con el tipo para que el cerebro de Tino responda con gracia
  // (acuse recibo / pedir descripción / escalar) en vez de quedarse mudo.
  if (!texto) {
    const tipo = detectarTipoMedia(p);
    if (!tipo) return null; // no es media ni texto → nada que procesar
    esMedia = true;
    texto = MARCADOR_MEDIA[tipo] ?? "[El cliente envió un archivo adjunto]";
  }

  return {
    instancia: INSTANCIA,
    chatId: from.replace(/@.*$/, ""), // dígitos del LID/número → clave BD estable
    jid: from, // dirección COMPLETA → a ésta se responde
    texto,
    nombre: p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? undefined,
    fromMe: p.fromMe === true,
    waId: normalizeWaId(p.id),
    esMedia,
  };
}

/** Texto sintético por tipo de media (lo lee el cerebro de Tino). */
const MARCADOR_MEDIA: Record<string, string> = {
  image: "[El cliente envió una IMAGEN 🖼️ (posible diseño/referencia)]",
  video: "[El cliente envió un VIDEO 🎬]",
  audio: "[El cliente envió un mensaje de VOZ 🎤]",
  ptt: "[El cliente envió un mensaje de VOZ 🎤]",
  document: "[El cliente envió un DOCUMENTO/PDF 📄]",
  sticker: "[El cliente envió un sticker]",
  location: "[El cliente compartió una UBICACIÓN 📍]",
  contact: "[El cliente compartió un CONTACTO]",
};

/**
 * Detecta el tipo de un mensaje sin texto. Robusto entre formas de WAHA/GOWS:
 * usa payload.type, hasMedia, o las claves del RawMessage de whatsmeow.
 * Devuelve null si no parece un mensaje de media manejable.
 */
function detectarTipoMedia(p: {
  type?: string;
  hasMedia?: boolean;
  _data?: { Message?: unknown };
}): string | null {
  const t = (p.type || "").toLowerCase();
  if (t && MARCADOR_MEDIA[t]) return t;
  // whatsmeow: _data.Message.{imageMessage,audioMessage,documentMessage,...}
  const msg = (p._data?.Message ?? {}) as Record<string, unknown>;
  const claves = Object.keys(msg).map((k) => k.toLowerCase());
  if (claves.some((k) => k.includes("image"))) return "image";
  if (claves.some((k) => k.includes("video"))) return "video";
  if (claves.some((k) => k.includes("audio") || k.includes("ptt"))) return "audio";
  if (claves.some((k) => k.includes("document"))) return "document";
  if (claves.some((k) => k.includes("sticker"))) return "sticker";
  if (claves.some((k) => k.includes("location"))) return "location";
  if (claves.some((k) => k.includes("contact"))) return "contact";
  // Señal genérica de media sin tipo claro.
  if (p.hasMedia === true || (t && t !== "chat" && t !== "text" && t !== "notification_template"))
    return "document";
  return null;
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
 * Mapea el ack de WAHA/whatsmeow a nuestro estado (por nombre o número).
 * ERROR/-1/0, PENDING/1, SERVER/2, DEVICE(entregado)/3, READ/4, PLAYED/5.
 */
export function parsearAckWaha(payload: unknown): AckWaha | null {
  const body = payload as {
    event?: string;
    payload?: { id?: unknown; ack?: number; ackName?: string };
  };
  if (body?.event !== "message.ack") return null;
  const p = body?.payload ?? {};
  const waId = normalizeWaId(p.id);
  if (!waId) return null;

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
  return { instancia: INSTANCIA, waId, estado };
}

// ============================================================================
// ENVÍO DE MEDIA (imagen / documento) — para respuestas del humano desde el portal
// ============================================================================

/**
 * Envía un archivo por WAHA. Usa /api/sendImage para imágenes y /api/sendFile
 * para el resto (PDF, etc). `destino` puede ser jid completo o número.
 * `data` es base64 SIN el prefijo data: (solo el contenido).
 */
export async function enviarMediaWaha(
  destino: string,
  media: { data: string; mimetype: string; filename: string; caption?: string },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const key = process.env.WAHA_API_KEY;
  if (!key || !BASE) return { ok: false, error: "Falta WAHA_API_URL/WAHA_API_KEY" };
  const chatId = aDestino(destino);
  const esImagen = media.mimetype.startsWith("image/");
  const endpoint = esImagen ? "/api/sendImage" : "/api/sendFile";
  try {
    const r = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({
        session: SESSION,
        chatId,
        file: {
          mimetype: media.mimetype,
          filename: media.filename,
          data: media.data,
        },
        caption: media.caption || undefined,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, waId: normalizeWaId(j.id) ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
