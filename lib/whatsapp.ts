import { db } from "@/lib/db";

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

/**
 * Resuelve la config de WhatsApp a partir del phone_number_id que manda Meta
 * en el webhook. Primero busca un cliente con ese waba_phone_id; si no lo
 * encuentra y coincide con el número de prueba del entorno, usa el token de
 * entorno (modo desarrollo).
 */
export async function configPorPhoneId(
  phoneNumberId: string,
): Promise<ConfigWhatsApp | null> {
  const { data } = await db()
    .from("ed_clientes")
    .select("id, waba_token")
    .eq("waba_phone_id", phoneNumberId)
    .maybeSingle();

  if (data) {
    const token = (data.waba_token as string) || process.env.WHATSAPP_TOKEN || "";
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
  const { data } = await db()
    .from("ed_clientes")
    .select("waba_phone_id, waba_token")
    .eq("id", clienteId)
    .maybeSingle();

  const phoneId = (data?.waba_phone_id as string) || "";
  const token = (data?.waba_token as string) || "";
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

/** Envía un mensaje de texto libre (solo válido dentro de la ventana de 24h). */
export async function enviarTexto(
  cfg: ConfigWhatsApp,
  para: string,
  texto: string,
): Promise<{ ok: boolean; error?: string }> {
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
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
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
};

/**
 * Extrae los mensajes de texto de un payload del webhook de Meta.
 * El payload trae entry[].changes[].value.messages[]. Puede venir sin mensajes
 * (por ejemplo, un evento de "entregado" o "leído"): en ese caso, lista vacía.
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
            from?: string;
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
      if (!phoneNumberId || !value?.messages?.length) continue;
      const nombre = value.contacts?.[0]?.profile?.name;
      for (const m of value.messages) {
        // Por ahora solo texto; audio/imagen se maneja en una fase posterior.
        if (m.type !== "text" || !m.text?.body || !m.from) continue;
        out.push({
          phoneNumberId,
          de: m.from,
          nombre,
          texto: m.text.body,
          tipo: m.type,
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
