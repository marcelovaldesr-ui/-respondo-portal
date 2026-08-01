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
  /**
   * ADJUNTO, si el mensaje traía uno.
   *
   * BUG REAL (31-jul-2026): el parser hacía `if (!texto) return null`, o sea que
   * una foto SIN pie de foto se descartaba entera. No es que el asistente no la
   * "viera": el mensaje no se guardaba, no aparecía en el portal y la persona
   * del negocio tampoco se enteraba. Para el sistema, el cliente no había
   * escrito nada.
   *
   * Pasó con Erika Pedreros: mandó el diseño por foto, el sistema lo tiró, y el
   * asistente siguió preguntando "¿ya tienes el diseño?" tres veces seguidas.
   * Desde afuera parecía que no leía; en realidad no había nada que leer.
   */
  adjunto?: {
    tipo: "imagen" | "documento" | "audio" | "video" | "sticker" | "ubicacion" | "otro";
    /** URL de descarga que expone WAHA, si la trae. */
    url?: string;
    /** Nombre del archivo, cuando es un documento. */
    nombre?: string;
    mime?: string;
  };
};

/** Traduce el tipo que informa WAHA al vocabulario del portal. */
function tipoDeAdjunto(mime: string, tipoWaha: string): NonNullable<EntranteWaha["adjunto"]>["tipo"] {
  const t = `${tipoWaha} ${mime}`.toLowerCase();
  if (t.includes("sticker")) return "sticker";
  if (t.includes("image")) return "imagen";
  if (t.includes("video")) return "video";
  if (t.includes("audio") || t.includes("ptt") || t.includes("voice")) return "audio";
  if (t.includes("location")) return "ubicacion";
  if (t.includes("document") || t.includes("application") || t.includes("pdf")) return "documento";
  return "otro";
}

/** Cómo se lee un adjunto en el hilo, tanto para el asistente como en el portal. */
export function textoDeAdjunto(a: NonNullable<EntranteWaha["adjunto"]>): string {
  const nombre = a.nombre ? ` (${a.nombre})` : "";
  switch (a.tipo) {
    case "imagen":
      return `[el cliente envió una imagen${nombre}]`;
    case "documento":
      return `[el cliente envió un archivo${nombre}]`;
    case "audio":
      return "[el cliente envió un audio]";
    case "video":
      return "[el cliente envió un video]";
    case "sticker":
      return "[el cliente envió un sticker]";
    case "ubicacion":
      return "[el cliente envió su ubicación]";
    default:
      return "[el cliente envió un archivo]";
  }
}

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

/** Delay humano proporcional al texto (1.5–6s con jitter). */
function delayHumano(texto: string): number {
  const base = 1500 + texto.length * 35;
  const jitter = Math.floor(Math.random() * 1200);
  return Math.min(6000, Math.max(1500, base + jitter));
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
  opts?: {
    /**
     * Última comprobación antes de mandar de verdad.
     *
     * POR QUÉ HACE FALTA ACÁ Y NO SOLO ANTES (bug real, 31-jul-2026)
     * Entre que se decide responder y que el mensaje sale pasan hasta 6 segundos
     * de "escribiendo…". La revalidación de responderSiBot ocurre ANTES de esa
     * espera, así que un mensaje del cliente que llegue durante los 6 segundos
     * no la ve, y la respuesta —ya obsoleta— se manda igual.
     *
     * Pasó exactamente así con Erika Pedreros:
     *   20:08  se valida: el último mensaje es "Mismo" → sigue vigente
     *   20:12  el cliente escribe "Es ese mismo"
     *   20:14  sale la respuesta vieja → dos mensajes casi iguales seguidos
     *
     * Comprobar al final cierra esa ventana: mientras el asistente "escribe",
     * el cliente puede seguir escribiendo, y eso es lo normal en WhatsApp.
     */
    vigente?: () => Promise<boolean>;
  },
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

    // Último control, ya sin nada más en el medio.
    if (opts?.vigente && !(await opts.vigente())) {
      return { ok: false, error: "obsoleto:llego_mensaje_nuevo" };
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
      timestamp?: number;
      notifyName?: string;
      hasMedia?: boolean;
      media?: { url?: string; mimetype?: string; filename?: string } | null;
      type?: string;
      location?: unknown;
      _data?: {
        notifyName?: string;
        pushName?: string;
        type?: string;
        mimetype?: string;
        caption?: string;
        filename?: string;
      };
    };
  };

  // WAHA distingue dos eventos y la diferencia es CRÍTICA:
  //   "message"     → SOLO lo que entra (excluye los mensajes propios).
  //   "message.any" → todo, incluidos los que escribe la persona del negocio
  //                   desde su propio teléfono (fromMe).
  // Bug real (31-jul): la sesión estaba suscrita solo a "message", así que las
  // respuestas que Cecilia escribía desde su WhatsApp NO llegaban al portal. La
  // conversación se veía a medias y —peor— Tino no las tenía en su historial,
  // con riesgo de contradecir lo que ella acababa de acordar.
  const evento = body?.event;
  if (evento && evento !== "message" && evento !== "message.any") return null;
  const p = body?.payload ?? {};
  const from = p.from ?? "";
  if (!from || from.endsWith("@g.us") || from.endsWith("@broadcast") || from.includes("status@"))
    return null;

  /**
   * ADJUNTOS — antes acá se hacía `if (!texto) return null` y se perdía el
   * mensaje entero.
   *
   * Un mensaje de WhatsApp puede no tener texto y aun así decir mucho: una foto
   * del diseño, un PDF, un audio. Descartarlo no solo dejaba ciego al
   * asistente; borraba el mensaje del portal, así que la persona del negocio
   * tampoco sabía que había llegado algo. Ahora el mensaje SIEMPRE se registra;
   * si no trae texto, se registra qué llegó.
   */
  const mime = p.media?.mimetype ?? p._data?.mimetype ?? "";
  const tipoCrudo = p.type ?? p._data?.type ?? "";
  const hayAdjunto =
    Boolean(p.hasMedia) || Boolean(p.media?.url) || Boolean(mime) ||
    /image|video|audio|ptt|document|sticker|location/i.test(tipoCrudo);

  const adjunto = hayAdjunto
    ? {
        tipo: tipoDeAdjunto(mime, tipoCrudo),
        url: p.media?.url || undefined,
        nombre: p.media?.filename || p._data?.filename || undefined,
        mime: mime || undefined,
      }
    : undefined;

  // El pie de foto viaja a veces en body y a veces en _data.caption.
  const escrito = (p.body ?? p._data?.caption ?? "").trim();
  // Si vino con pie de foto, se conserva el texto Y se anota el adjunto: el
  // asistente necesita ambos para entender ("mira esta medida" + la foto).
  const texto = escrito || (adjunto ? textoDeAdjunto(adjunto) : "");

  // Sin texto y sin adjunto no hay nada que registrar (eventos de sistema).
  if (!texto) return null;

  // GUARDIA DE FRESCURA (clave al conectar un número REAL con historial):
  // al vincular por QR, WhatsApp puede re-entregar mensajes RECIENTES del
  // historial como si fueran nuevos. Sin esto, Tino respondería en masa a
  // conversaciones viejas. Un mensaje "de verdad" llega en segundos; si trae
  // timestamp y tiene más de 3 minutos, se ignora por completo.
  if (typeof p.timestamp === "number" && p.timestamp > 0) {
    const edadSeg = Date.now() / 1000 - p.timestamp;
    if (edadSeg > 180) return null;
  }

  return {
    instancia: INSTANCIA,
    chatId: from.replace(/@.*$/, ""), // dígitos del LID/número → clave BD estable
    jid: from, // dirección COMPLETA → a ésta se responde
    texto,
    nombre: p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? undefined,
    fromMe: p.fromMe === true,
    waId: normalizeWaId(p.id),
    adjunto,
  };
}

/**
 * Envía una imagen o un documento por WAHA.
 *  - Imágenes (mimetype image/*) → /api/sendImage → se ven inline en WhatsApp.
 *  - Resto (PDF, etc.)           → /api/sendFile  → llegan como documento.
 *
 * `data` es base64 SIN el prefijo `data:...;base64,`. `destino` puede ser el jid
 * completo (223...@lid / 569...@c.us) o solo dígitos; se respeta el sufijo igual
 * que en el envío de texto. Devuelve el id normalizado para el tracking de ACKs.
 */
export async function enviarMediaWaha(
  destino: string,
  media: { data: string; mimetype: string; filename: string; caption?: string },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const key = process.env.WAHA_API_KEY;
  if (!key || !BASE) return { ok: false, error: "Falta WAHA_API_URL/WAHA_API_KEY" };
  const chatId = aDestino(destino);
  const endpoint = media.mimetype.startsWith("image/") ? "sendImage" : "sendFile";
  const headers = { "Content-Type": "application/json", "X-Api-Key": key };
  try {
    const r = await fetch(`${BASE}/api/${endpoint}`, {
      method: "POST",
      headers,
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
