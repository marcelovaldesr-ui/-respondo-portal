import { db } from "@/lib/db";

/**
 * INSTAGRAM DIRECT — transporte.
 *
 * El cerebro es el MISMO de siempre (lib/responderBot.ts). Acá solo vive cómo
 * entra un DM, cómo sale la respuesta y cómo se sabe de qué negocio es.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ "LOGIN DE INSTAGRAM" Y NO "LOGIN DE FACEBOOK"
 * ═══════════════════════════════════════════════════════════════════════════
 * Meta ofrece dos caminos para los DMs y no son intercambiables:
 *
 *   · Instagram API con Login de Facebook — exige que la cuenta de Instagram
 *     esté vinculada a una PÁGINA de Facebook y que el dueño pueda administrar
 *     esa página. Pide 4 permisos (instagram_basic, instagram_manage_messages,
 *     pages_show_list, pages_read_engagement). Base: graph.facebook.com
 *
 *   · Instagram API con Login de Instagram — la cuenta profesional se conecta
 *     sola, sin página de Facebook de por medio. Pide 2 permisos
 *     (instagram_business_basic, instagram_business_manage_messages).
 *     Base: graph.instagram.com
 *
 * Se eligió el segundo, y la razón es comercial antes que técnica: en una pyme
 * chilena la página de Facebook suele estar abandonada, a nombre de un ex
 * empleado o de la agencia que les hizo el logo hace cuatro años. Pedirle al
 * dueño de una automotora que recupere el acceso a una página que no usa, para
 * poder conectar el Instagram que sí usa todos los días, mata la venta en la
 * reunión. Con Login de Instagram entra con la clave de su Instagram y listo.
 * De paso son dos permisos menos que justificar en la revisión de Meta.
 *
 * DIFERENCIAS CON WHATSAPP QUE IMPORTAN AL PROGRAMAR
 *  · El payload es de "messaging" (estilo Messenger), no de "changes/value".
 *  · La persona se identifica con un IGSID, no con un teléfono. No sirve para
 *    llamar ni para cruzarlo con la ficha de WhatsApp: es otra identidad.
 *  · Hay 24 h para responder, igual que WhatsApp, pero sin plantillas para
 *    reabrir la conversación. Pasado ese plazo, el hilo se cierra y punto.
 *  · El texto va en UTF-8 y no puede pasar de 1000 bytes. No son 1000
 *    caracteres: una respuesta con tildes y emojis se corta antes.
 *
 * Config por entorno:
 *   IG_APP_SECRET     secreto de la app de Instagram (valida la firma)
 *   IG_VERIFY_TOKEN   token de verificación del webhook (lo elige uno)
 *   IG_TOKEN          token de respaldo para pruebas; en producción el token
 *                     vive en ed_clientes.ig_token, uno por negocio
 */

const GRAPH_IG = "https://graph.instagram.com/v23.0";

/** Tope duro de la API. Se corta antes de enviar, no después de que falle. */
const MAX_BYTES = 1000;

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
          is_unsupported?: boolean;
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
      if (!m || m.is_deleted || m.is_unsupported) continue;

      const esPropio = m.is_echo === true;
      // En un eco, quien "envía" es el negocio y el destinatario es la persona.
      const igsid = (esPropio ? ev.recipient?.id : ev.sender?.id) ?? "";
      const paginaId = entry.id ?? (esPropio ? ev.sender?.id : ev.recipient?.id) ?? "";
      if (!igsid || !paginaId) continue;

      const adj = m.attachments?.[0];
      const adjunto = adj ? { tipo: adj.type ?? "otro", url: adj.payload?.url } : undefined;

      // Mismo criterio que en WhatsApp: un mensaje sin texto pero con adjunto
      // NO se descarta — se registra qué llegó. Perderlo dejaría al asistente
      // preguntando por algo que la persona ya mandó, que es exactamente el
      // error que se descubrió con la foto de una lead en WhatsApp.
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
  if (t.includes("file")) return "[el cliente envió un archivo]";
  return "[el cliente envió un archivo]";
}

export type CuentaIg = {
  clienteId: string;
  /** ID de la cuenta profesional: el destinatario en la URL de envío. */
  igUserId: string;
  token: string;
};

/**
 * De qué negocio es esta cuenta de Instagram, y con qué credenciales responde.
 *
 * Busca por `ig_user_id`, que es el identificador del camino elegido: Instagram
 * API con **Login de Instagram**.
 *
 * ANTES había además un respaldo por `ig_page_id`, pensado para clientes
 * configurados con el Login de Facebook. Se quitó porque esa columna nunca
 * existió —la migración 271 no la crea, y el camino de Facebook se descartó a
 * propósito (exige que la cuenta esté ligada a una página administrable, que en
 * la pyme chilena suele estar abandonada o a nombre de un ex empleado)—. El
 * respaldo no daba compatibilidad con nada: solo gastaba una consulta que
 * siempre devolvía error, por cada mensaje que no calzara a la primera.
 */
export async function cuentaPorIdIg(paginaId: string): Promise<CuentaIg | null> {
  const supa = db();

  const { data } = await supa
    .from("ed_clientes")
    .select("id, ig_user_id, ig_token")
    .eq("ig_user_id", paginaId)
    .eq("activo", true)
    .maybeSingle();
  if (!data) return null;

  const fila = data as { id: string; ig_user_id: string | null; ig_token: string | null };
  // IG_TOKEN de entorno es solo para la cuenta de pruebas: permite probar antes
  // de construir la pantalla de conexión, sin que eso se vuelva la arquitectura.
  const token = fila.ig_token || process.env.IG_TOKEN || "";
  if (!token) return null;

  return { clienteId: fila.id, igUserId: fila.ig_user_id || paginaId, token };
}

/** Espera humana proporcional al texto, igual que en WhatsApp. */
function delayHumano(texto: string): number {
  const base = 1200 + texto.length * 30;
  return Math.min(5000, Math.max(1200, base + Math.floor(Math.random() * 1000)));
}

/**
 * Recorta a 1000 bytes sin partir un carácter por la mitad.
 *
 * `slice(0, 1000)` cuenta caracteres, no bytes: una respuesta en español con
 * tildes y un emoji pasa el límite aunque parezca corta, y la API la rechaza
 * entera. Cortar por bytes a ciegas es peor todavía —parte un carácter multibyte
 * y el texto llega con un rombo negro al final—, así que se retrocede hasta el
 * último límite de carácter válido.
 */
export function recortarIg(texto: string): string {
  const buf = Buffer.from(texto, "utf8");
  if (buf.length <= MAX_BYTES) return texto;
  // El "…" también son bytes: TRES, no uno. Reservar uno solo dejaba el
  // resultado en 1001 bytes justo en el caso que había que resolver —un texto
  // largo con tildes— y la API lo habría rechazado entero.
  let corte = MAX_BYTES - 3;
  // Retroceder hasta el inicio de un carácter: 10xxxxxx es continuación, así
  // que si caímos ahí estamos partiendo una letra al medio.
  while (corte > 0 && (buf[corte] & 0b1100_0000) === 0b1000_0000) corte--;
  return buf.subarray(0, corte).toString("utf8").trimEnd() + "…";
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
  cuenta: CuentaIg,
  igsid: string,
  texto: string,
  opts?: { vigente?: () => Promise<boolean> },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  if (!cuenta.token) return { ok: false, error: "Instagram sin token para este cliente" };

  try {
    await new Promise((r) => setTimeout(r, delayHumano(texto)));

    if (opts?.vigente && !(await opts.vigente())) {
      return { ok: false, error: "obsoleto:llego_mensaje_nuevo" };
    }

    const r = await fetch(`${GRAPH_IG}/${cuenta.igUserId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cuenta.token}`,
      },
      body: JSON.stringify({
        recipient: { id: igsid },
        message: { text: recortarIg(texto) },
      }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      console.error("[instagram] envío falló:", r.status, detalle.slice(0, 300));
      // 190 = token inválido o vencido. Se distingue porque es el único error
      // que no se arregla reintentando: hay que reconectar la cuenta.
      const vencido = detalle.includes('"code":190') || r.status === 401;
      return { ok: false, error: vencido ? "token_vencido" : `${r.status}` };
    }
    const j = (await r.json()) as { message_id?: string };
    return { ok: true, waId: j.message_id };
  } catch (e) {
    console.error("[instagram] envío reventó:", e);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Renueva los tokens que están por vencer.
 *
 * ESTO NO ES OPCIONAL Y CONVIENE ENTENDER POR QUÉ. El token de Instagram dura
 * 60 días. Cuando vence, la API deja de aceptar los envíos y el portal no
 * muestra nada raro: las conversaciones siguen entrando, el asistente sigue
 * "respondiendo", y los mensajes simplemente no llegan. Un cliente puede pasar
 * una semana perdiendo ventas antes de que alguien lo note.
 *
 * Meta permite renovar un token que tenga al menos 24 h de vida y no haya
 * vencido. Se renueva con 15 días de anticipación: margen de sobra para que un
 * fallo temporal de red no queme la única ventana disponible.
 *
 * Cuelga del cron de seguimientos, que ya corre cada 5 minutos.
 */
export async function renovarTokensIg(): Promise<{ renovados: number; fallas: string[] }> {
  const supa = db();
  const limite = new Date(Date.now() + 15 * 86400_000).toISOString();

  const { data } = await supa
    .from("ed_clientes")
    .select("id, nombre, ig_token, ig_token_vence")
    .not("ig_token", "is", null)
    .lt("ig_token_vence", limite)
    .eq("activo", true);

  const filas = (data ?? []) as {
    id: string;
    nombre: string;
    ig_token: string;
    ig_token_vence: string | null;
  }[];
  if (!filas.length) return { renovados: 0, fallas: [] };

  let renovados = 0;
  const fallas: string[] = [];

  for (const c of filas) {
    try {
      const url = `${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(c.ig_token)}`;
      const r = await fetch(url);
      if (!r.ok) {
        fallas.push(`${c.nombre}: ${r.status}`);
        continue;
      }
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      if (!j.access_token) {
        fallas.push(`${c.nombre}: respuesta sin token`);
        continue;
      }
      await supa
        .from("ed_clientes")
        .update({
          ig_token: j.access_token,
          ig_token_vence: new Date(Date.now() + (j.expires_in ?? 5_184_000) * 1000).toISOString(),
        })
        .eq("id", c.id);
      renovados++;
    } catch (e) {
      fallas.push(`${c.nombre}: ${(e as Error).message}`);
    }
  }

  if (fallas.length) console.error("[instagram] tokens sin renovar:", fallas.join(" · "));
  return { renovados, fallas };
}
