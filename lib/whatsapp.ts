import { db } from "@/lib/db";
import { descifrar } from "@/lib/cifrado";

/**
 * Integración con la WhatsApp Cloud API oficial (Opción B).
 *
 * DESARROLLO vs PRODUCCIÓN:
 *  - En desarrollo se usa el número de PRUEBA de Meta: un único token y
 *    phone_number_id desde variables de entorno (WHATSAPP_TOKEN, etc.).
 *  - En producción cada cliente tiene su propio número y token (los que
 *    devuelve Embedded Signup, guardados en ed_clientes). La resolución por
 *    cliente ya está preparada abajo.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type ConfigWhatsApp = {
  clienteId: string;
  phoneNumberId: string;
  token: string;
};

type FilaToken = { waba_token_cifrado?: string | null; waba_token?: string | null };

/**
 * Lee una fila de ed_clientes pidiendo la columna cifrada, y si la migración
 * 279 todavía no está aplicada, reintenta sin ella.
 *
 * POR QUÉ EXISTE ESTO: la convención de este repo es desplegar ANTES de migrar
 * (runbook de coexistencia), porque normalmente el código viejo ignora las
 * columnas nuevas. Acá es al revés — el código nuevo NECESITA la columna — y
 * pedirla antes de tiempo hace que PostgREST devuelva error, `data` venga null
 * y **el cliente deje de recibir y responder mensajes**.
 *
 * En vez de confiar en que el orden se respete, el código aguanta los dos
 * órdenes. Cuando la 280 esté aplicada y estable, este respaldo se puede
 * borrar.
 */
async function leerCliente(
  campo: string,
  valor: string,
  columnas: string,
): Promise<Record<string, unknown> | null> {
  const consultar = (cols: string) =>
    db().from("ed_clientes").select(cols).eq(campo, valor).maybeSingle();

  const conCifrado = await consultar(`${columnas}, waba_token_cifrado`);
  if (!conCifrado.error) return conCifrado.data as Record<string, unknown> | null;

  console.warn(
    "[whatsapp] waba_token_cifrado no existe todavía (falta la migración 279); leyendo solo el texto plano.",
  );
  const sinCifrado = await consultar(columnas);
  return sinCifrado.error ? null : (sinCifrado.data as Record<string, unknown> | null);
}

/**
 * Token de WhatsApp de un cliente, venga cifrado (migración 279) o todavía en
 * texto plano (columna vieja, en retirada).
 *
 * Durante la transición conviven las dos columnas. Si el descifrado FALLA
 * teniendo un valor cifrado, se cae al texto plano igual pero se grita en el
 * log: preferimos un cliente atendido y un error visible antes que un cliente
 * mudo y un log limpio. `/api/salud` reporta esta condición aparte.
 *
 * Cuando la migración 280 deje `waba_token` en null, el respaldo se vuelve
 * inofensivo por sí solo y esta función queda leyendo solo lo cifrado.
 */
export function tokenDeFila(fila: FilaToken | null | undefined): string {
  if (!fila) return "";
  const cifrado = fila.waba_token_cifrado;
  if (cifrado) {
    const claro = descifrar(cifrado, "waba-token");
    if (claro) return claro;
    console.error(
      "[whatsapp] waba_token_cifrado no se pudo descifrar (¿rotaron SUPABASE_SERVICE_ROLE_KEY?). Usando el texto plano si existe.",
    );
  }
  return (fila.waba_token as string) || "";
}

/**
 * Resuelve la config de WhatsApp a partir del phone_number_id que manda Meta
 * en el webhook. Primero busca un cliente con ese waba_phone_id; si no lo
 * encuentra y coincide con el número de prueba del entorno, usa el token de
 * entorno (modo desarrollo).
 */
export async function configPorPhoneId(
  phoneNumberId: string,
): Promise<ConfigWhatsApp | null> {
  const data = await leerCliente("waba_phone_id", phoneNumberId, "id, waba_token");

  if (data) {
    const token = tokenDeFila(data as FilaToken) || process.env.WHATSAPP_TOKEN || "";
    if (!token) return null;
    return { clienteId: data.id as string, phoneNumberId, token };
  }

  // Modo desarrollo: número de prueba de Meta configurado por entorno.
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId &&
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_DEV_CLIENTE_ID
  ) {
    return {
      clienteId: process.env.WHATSAPP_DEV_CLIENTE_ID,
      phoneNumberId,
      token: process.env.WHATSAPP_TOKEN,
    };
  }
  return null;
}

/**
 * Config de WhatsApp para ENVIAR desde el portal (inbox), a partir del cliente.
 * En dev, si el cliente no tiene número propio pero es el cliente de prueba,
 * usa el número de prueba del entorno.
 */
export async function configPorCliente(
  clienteId: string,
): Promise<ConfigWhatsApp | null> {
  const data = await leerCliente("id", clienteId, "waba_phone_id, waba_token");

  const phoneId = (data?.waba_phone_id as string) || "";
  const token = tokenDeFila(data as FilaToken);
  if (phoneId && token) return { clienteId, phoneNumberId: phoneId, token };

  // Modo desarrollo: número de prueba de Meta.
  if (
    process.env.WHATSAPP_DEV_CLIENTE_ID === clienteId &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_TOKEN
  ) {
    return {
      clienteId,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      token: process.env.WHATSAPP_TOKEN,
    };
  }
  return null;
}

/**
 * Envía un mensaje de texto libre (solo válido dentro de la ventana de 24h).
 * Devuelve el `wamid` del mensaje creado: con él se reconoce después su ECO en
 * el webhook (Coexistencia) y se trackean sus ACKs (statuses) — igual que en WAHA.
 */
export async function enviarTexto(
  cfg: ConfigWhatsApp,
  para: string,
  texto: string,
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  try {
    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "text",
        text: { body: texto },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    return { ok: true, waId: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Forma mínima de un mensaje entrante ya normalizado desde el webhook de Meta. */
export type EntranteNormalizado = {
  phoneNumberId: string; // número del negocio (mapea a cliente)
  de: string; // número del cliente final (chat_id)
  nombre?: string; // nombre de perfil de WhatsApp, si viene
  texto: string;
  tipo: string;
  waId: string | null; // wamid → idempotencia (Meta REINTENTA webhooks)
};

/**
 * Marcador legible de un adjunto de Meta, para que un mensaje SIN texto (una
 * foto, un audio, un PDF) NO se pierda. Mismo vocabulario que WAHA
 * (lib/waha.ts → textoDeAdjunto) para que el prompt de Tino y el inbox lean
 * igual en los dos transportes.
 */
function placeholderAdjuntoMeta(tipo: string, filename?: string): string {
  const nombre = filename ? ` (${filename})` : "";
  switch (tipo) {
    case "image":
      return `[el cliente envió una imagen${nombre}]`;
    case "document":
      return `[el cliente envió un archivo${nombre}]`;
    case "audio":
    case "voice":
      return "[el cliente envió un audio]";
    case "video":
      return "[el cliente envió un video]";
    case "sticker":
      return "[el cliente envió un sticker]";
    case "location":
      return "[el cliente envió su ubicación]";
    case "contacts":
      return "[el cliente compartió un contacto]";
    default:
      return "[el cliente envió un archivo]";
  }
}

/**
 * Extrae los mensajes de un payload del webhook de Meta.
 * El payload trae entry[].changes[].value.messages[]. Puede venir sin mensajes
 * (por ejemplo, un evento de "entregado" o "leído"): en ese caso, lista vacía.
 *
 * MULTIMEDIA (fix auditoría 1-ago-2026): antes se hacía `if (type !== "text")
 * continue`, así que en la vía OFICIAL una foto/audio/PDF del cliente se
 * DESCARTABA entera: no se guardaba, no aparecía en el portal y Tino ni se
 * enteraba (podía seguir preguntando lo que la foto respondía). Ahora, igual que
 * en WAHA, un mensaje multimedia SIEMPRE se registra: si trae pie de foto se usa
 * ese texto y se anota el adjunto; si no, se registra un marcador legible.
 */
export function parsearWebhook(payload: unknown): EntranteNormalizado[] {
  const out: EntranteNormalizado[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            image?: { caption?: string };
            video?: { caption?: string };
            document?: { caption?: string; filename?: string };
            /** Respuesta a botón de plantilla (quick reply). */
            button?: { text?: string; payload?: string };
            /** Respuesta a mensaje interactivo (botones / lista). */
            interactive?: {
              type?: string;
              button_reply?: { id?: string; title?: string };
              list_reply?: { id?: string; title?: string };
            };
          }[];
        };
      }[];
    }[];
  };

  // Tipos que sí acarrean intención del cliente y deben registrarse. Se dejan
  // fuera solo los eventos de sistema/no accionables (reaction, system, order,
  // button/interactive se procesarán en su propia fase si hace falta).
  const IGNORADOS = new Set(["reaction", "system", "unsupported", "ephemeral"]);

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.messages?.length) continue;
      const nombre = value.contacts?.[0]?.profile?.name;
      for (const m of value.messages) {
        const tipo = m.type ?? "";
        if (!m.from || !tipo || IGNORADOS.has(tipo)) continue;

        let texto: string;
        if (tipo === "text") {
          if (!m.text?.body) continue;
          texto = m.text.body;
        } else if (tipo === "button" || tipo === "interactive") {
          // RESPUESTA INTERACTIVA (fix revisión independiente 1-ago-2026): el
          // cliente TOCÓ un botón o eligió de una lista — eso ES texto suyo
          // ("Confirmar", "Ver precios"), no un adjunto. Registrarlo como
          // "[archivo]" habría hecho que Tino tratara una confirmación como un
          // documento que no puede ver. Se usa el título tocado tal cual.
          const tocado =
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            "";
          if (!tocado.trim()) continue; // interactivo sin texto: nada que registrar
          texto = tocado.trim();
        } else {
          // Pie de foto (imagen/video/documento) o marcador del adjunto.
          const caption =
            m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "";
          texto =
            caption.trim() || placeholderAdjuntoMeta(tipo, m.document?.filename);
        }

        out.push({
          phoneNumberId,
          de: m.from,
          nombre,
          texto,
          tipo,
          waId: m.id ?? null,
        });
      }
    }
  }
  return out;
}

// ============================================================================
// ACKs (statuses) y ECOS de Coexistencia — espejo de lo que ya se hizo en WAHA
// ============================================================================

/** ACK de entrega normalizado desde value.statuses[] del webhook de Meta. */
export type AckMeta = {
  phoneNumberId: string;
  waId: string; // wamid del mensaje al que refiere
  estado: "server_ack" | "entregado" | "leido" | "error";
  errorDetalle?: string;
};

const MAPA_STATUS_META: Record<string, AckMeta["estado"]> = {
  sent: "server_ack",
  delivered: "entregado",
  read: "leido",
  failed: "error",
};

/** Extrae los ACKs (statuses) de un payload del webhook de Meta. */
export function parsearAcksMeta(payload: unknown): AckMeta[] {
  const out: AckMeta[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          statuses?: {
            id?: string;
            status?: string;
            errors?: { title?: string; message?: string }[];
          }[];
        };
      }[];
    }[];
  };

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.statuses?.length) continue;
      for (const s of value.statuses) {
        const estado = s.status ? MAPA_STATUS_META[s.status] : undefined;
        if (!s.id || !estado) continue;
        const err = s.errors?.[0];
        out.push({
          phoneNumberId,
          waId: s.id,
          estado,
          errorDetalle: err ? (err.message ?? err.title) : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * ECO de Coexistencia normalizado. Con Coexistencia activa, los mensajes que el
 * NEGOCIO manda desde su app de WhatsApp Business llegan por el campo de webhook
 * `smb_message_echoes` (value.message_echoes[]). Igual que el fromMe de WAHA:
 * puede ser (a) eco de un envío propio o (b) una PERSONA (Cecilia) escribiendo
 * desde su teléfono → toma de control humana. Se resuelve aguas abajo por id.
 */
export type EcoMeta = {
  phoneNumberId: string;
  para: string; // número del cliente final (chat_id)
  texto: string;
  waId: string | null;
};

/** Extrae los ecos de Coexistencia (message_echoes) de un payload de Meta. */
export function parsearEcosMeta(payload: unknown): EcoMeta[] {
  const out: EcoMeta[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          message_echoes?: {
            id?: string;
            to?: string;
            type?: string;
            text?: { body?: string };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.message_echoes?.length) continue;
      for (const e of value.message_echoes) {
        if (e.type !== "text" || !e.text?.body || !e.to) continue;
        out.push({
          phoneNumberId,
          para: e.to,
          texto: e.text.body,
          waId: e.id ?? null,
        });
      }
    }
  }
  return out;
}

/** El empleado que atiende el inbound de WhatsApp de un cliente es su Tino. */
export async function tinoDe(clienteId: string): Promise<string | null> {
  const { data } = await db()
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("rol", "tino")
    .eq("activo", true)
    .maybeSingle();
  return (data?.id as string) ?? null;
}
