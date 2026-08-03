import { db } from "@/lib/db";

/**
 * INSTAGRAM DIRECT — transporte.
 *
 * El cerebro es el MISMO de siempre (lib/responderBot.ts). Acá solo vive cómo
 * entra un DM (parsearInstagram), cómo sale la respuesta (enviarTextoInstagram)
 * y cómo se sabe de qué negocio es (clientePorPaginaIg).
 *
 * POR QUÉ LA API OFICIAL Y NO ALGO "POR FUERA" COMO WAHA
 * Con WhatsApp existe la vía no oficial porque el protocolo de WhatsApp Web
 * está reimplementado y el número sigue siendo del negocio. En Instagram el
 * equivalente son APIs privadas que piden la contraseña de la cuenta, y el
 * castigo por usarlas es la pérdida PERMANENTE de la cuenta. Estaríamos
 * arriesgando el Instagram del cliente, que en una automotora o una clínica
 * suele ser su activo comercial más valioso. No es una opción.
 *
 * DIFERENCIAS CON WHATSAPP QUE IMPORTAN AL PROGRAMAR
 *  · El payload es de "messaging" (estilo Messenger), no de "changes/value".
 *  · El identificador de la persona es un IGSID, no un teléfono. No sirve para
 *    llamar ni para cruzarlo con la ficha de WhatsApp: es otra identidad.
 *  · La ventana para responder es de 24 h desde el último mensaje del usuario,
 *    igual que WhatsApp, pero sin plantillas para reabrirla.
 *
 * Config por entorno:
 *   IG_TOKEN            token de acceso de la página/cuenta de Instagram
 *   IG_VERIFY_TOKEN     token de verificación del webhook (lo elige uno)
 *   META_APP_SECRET     ya existe: se reusa para validar la firma
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type EntranteInstagram = {
  /** id de la cuenta de Instagram del NEGOCIO que recibió el mensaje. */
  paginaId: string;
  /** IGSID de la persona que escribe. Es la clave del chat. */
  igsid: string;
  texto: string;
  mid: string | null;
  /** true si lo mandó el negocio (eco de una respuesta propia o de una persona). */
  esPropio: boolean;
  adjunto?: { tipo: string; url?: string };
};

/**
 * Convierte el payload del webhook a algo que el resto del sistema entiende.
 *
 * Devuelve una LISTA porque Meta agrupa varios eventos en una sola entrega, a
 * diferencia de WAHA que manda uno por uno.
 */
export function parsearInstagram(payload: unknown): EntranteInstagram[] {
  const body = payload as {
    object?: string;
    entry?: {
      id?: string;
      messaging?: {
        sender?: { id?: string };
        recipient?: { id?: string };
        message?: {
          mid?: string;
          text?: string;
          is_echo?: boolean;
          is_deleted?: boolean;
          attachments?: { type?: string; payload?: { url?: string } }[];
        };
      }[];
    }[];
  };

  // Solo eventos de Instagram. Si llega otra cosa por esta ruta, se ignora en
  // vez de intentar interpretarla.
  if (body?.object !== "instagram") return [];

  const out: EntranteInstagram[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_deleted) continue;

      const esPropio = m.is_echo === true;
      // En un eco, quien "envía" es el negocio y el destinatario es la persona.
      const igsid = (esPropio ? ev.recipient?.id : ev.sender?.id) ?? "";
      const paginaId = entry.id ?? (esPropio ? ev.sender?.id : ev.recipient?.id) ?? "";
      if (!igsid || !paginaId) continue;

      const adj = m.attachments?.[0];
      const adjunto = adj
        ? { tipo: adj.type ?? "otro", url: adj.payload?.url }
        : undefined;

      // Mismo criterio que en WhatsApp: un mensaje sin texto pero con adjunto
      // NO se descarta — se registra qué llegó. Perderlo dejaría al asistente
      // preguntando por algo que la persona ya mandó.
      const texto = (m.text ?? "").trim() || (adjunto ? textoDeAdjuntoIg(adjunto.tipo) : "");
      if (!texto) continue;

      out.push({ paginaId, igsid, texto, mid: m.mid ?? null, esPropio, adjunto });
    }
  }
  return out;
}

/** Cómo se lee un adjunto de Instagram en el hilo. */
export function textoDeAdjuntoIg(tipo: string): string {
  const t = (tipo || "").toLowerCase();
  if (t.includes("image")) return "[el cliente envió una imagen]";
  if (t.includes("video")) return "[el cliente envió un video]";
  if (t.includes("audio")) return "[el cliente envió un audio]";
  if (t.includes("share")) return "[el cliente compartió una publicación]";
  if (t.includes("story")) return "[el cliente respondió a una historia]";
  return "[el cliente envió un archivo]";
}

/**
 * De qué negocio es esta cuenta de Instagram.
 *
 * Usa `ed_clientes.ig_page_id`, columna que ya existía en el esquema — el
 * canal estaba previsto desde antes, solo faltaba conectarlo.
 */
export async function clientePorPaginaIg(paginaId: string): Promise<string | null> {
  const { data } = await db()
    .from("ed_clientes")
    .select("id")
    .eq("ig_page_id", paginaId)
    .eq("activo", true)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** Espera humana proporcional al texto, igual que en WhatsApp. */
function delayHumano(texto: string): number {
  const base = 1200 + texto.length * 30;
  return Math.min(5000, Math.max(1200, base + Math.floor(Math.random() * 1000)));
}

/**
 * Envía un DM.
 *
 * `vigente` es el mismo control que en WhatsApp: entre que se decide responder
 * y que el mensaje sale hay una espera, y en ese rato la persona puede haber
 * escrito otra cosa. Sin esta comprobación final salen dos respuestas casi
 * iguales seguidas — pasó de verdad en WhatsApp y no hay razón para repetirlo.
 */
export async function enviarTextoInstagram(
  igsid: string,
  texto: string,
  opts?: { vigente?: () => Promise<boolean> },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const token = process.env.IG_TOKEN;
  if (!token) return { ok: false, error: "Falta IG_TOKEN" };

  try {
    await new Promise((r) => setTimeout(r, delayHumano(texto)));

    if (opts?.vigente && !(await opts.vigente())) {
      return { ok: false, error: "obsoleto:llego_mensaje_nuevo" };
    }

    const r = await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: igsid },
        message: { text: texto },
        messaging_type: "RESPONSE",
      }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      console.error("[instagram] envío falló:", r.status, detalle.slice(0, 300));
      return { ok: false, error: `${r.status}` };
    }
    const j = (await r.json()) as { message_id?: string };
    return { ok: true, waId: j.message_id };
  } catch (e) {
    console.error("[instagram] envío reventó:", e);
    return { ok: false, error: (e as Error).message };
  }
}
