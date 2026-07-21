import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  parsearWebhook,
  configPorPhoneId,
  tinoDe,
  type ConfigWhatsApp,
  type EntranteNormalizado,
} from "@/lib/whatsapp";
import { responderSiBot } from "@/lib/responderBot";

export const dynamic = "force-dynamic";

/**
 * Webhook de la WhatsApp Cloud API.
 *
 * GET  → verificación inicial de Meta (responde el hub.challenge).
 * POST → mensajes entrantes.
 *
 * REGLA DE META: hay que responder 200 rápido. Si el procesamiento demora,
 * Meta reintenta y duplica. Por eso acá se guarda el entrante y se responde;
 * la respuesta del bot (Gemini) se cablea en la Fase 2, idealmente disparada
 * sin bloquear este 200.
 */

// --- GET: verificación del webhook ---
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const modo = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// --- POST: mensajes entrantes ---
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true }); // 200 igual, para que Meta no reintente
  }

  const entrantes = parsearWebhook(payload);

  // Procesar sin romper el 200: si algo falla, se loguea y se sigue.
  for (const m of entrantes) {
    try {
      await guardarEntrante(m);
    } catch (e) {
      console.error("[whatsapp webhook] error guardando entrante:", (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * Guarda un mensaje entrante: resuelve cliente por phone_number_id, ubica al
 * Tino de ese cliente, registra el mensaje y el contacto, y actualiza la marca
 * de la ventana de 24h.
 */
async function guardarEntrante(m: EntranteNormalizado) {
  const cfg = await configPorPhoneId(m.phoneNumberId);
  if (!cfg) {
    console.warn(`[whatsapp webhook] phone_number_id sin cliente: ${m.phoneNumberId}`);
    return;
  }
  const empleadoId = await tinoDe(cfg.clienteId);
  if (!empleadoId) {
    console.warn(`[whatsapp webhook] cliente ${cfg.clienteId} sin Tino activo`);
    return;
  }

  const supa = db();
  const ahora = new Date().toISOString();

  await supa.from("ed_mensajes").insert({
    empleado_id: empleadoId,
    chat_id: m.de,
    rol: "cliente",
    texto: m.texto,
  });

  // Contacto (upsert por cliente_id+chat_id): guarda el nombre de perfil.
  if (m.nombre) {
    await supa
      .from("ed_contactos")
      .upsert(
        {
          cliente_id: cfg.clienteId,
          chat_id: m.de,
          nombre: m.nombre,
          telefono: `+${m.de}`,
          etiqueta: "lead",
        },
        { onConflict: "cliente_id,chat_id" },
      );
  }

  // Marca de ventana de 24h: el cliente acaba de escribir. NO se pisa el modo
  // (bot/humano/pausado) si ya existe — solo se actualiza la marca de tiempo.
  const { data: estado } = await supa
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", m.de)
    .maybeSingle();

  if (estado) {
    await supa
      .from("ed_chat_estado")
      .update({ ultimo_entrante_en: ahora })
      .eq("empleado_id", empleadoId)
      .eq("chat_id", m.de);
  } else {
    await supa.from("ed_chat_estado").insert({
      empleado_id: empleadoId,
      chat_id: m.de,
      modo: "bot",
      ultimo_entrante_en: ahora,
    });
  }

  // Fase 2: si el chat está en modo bot, el asistente responde. Se procesa acá
  // (Gemini ~5s). Para producción de alto volumen conviene moverlo a una cola.
  await responderSiBot({
    clienteId: cfg.clienteId,
    empleadoId,
    chatId: m.de,
    cfg,
  });
}
