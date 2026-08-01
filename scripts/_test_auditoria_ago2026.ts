/**
 * REGRESIONES — Auditoría integral de Tino (1-ago-2026).
 *
 * Cubre los cambios de código puros/near-puros de esa auditoría, SIN tocar la
 * base de datos (usa un Supabase falso). Corre en segundos y sirve de red
 * permanente para que estos bugs no vuelvan.
 *
 *   npx tsx scripts/_test_auditoria_ago2026.ts
 *
 * Qué protege:
 *   A) parsearWebhook (Meta) ya NO descarta multimedia: una foto/audio/PDF del
 *      cliente en la vía OFICIAL se registra (con pie de foto o marcador), en vez
 *      de desaparecer.  [bug HIGH: mensaje llegó a WhatsApp pero no al portal]
 *   B) guardarMensaje conserva la idempotencia (wa_message_id) aunque falten las
 *      columnas nuevas (media_* / canal). Antes, cualquier columna faltante hacía
 *      caer el insert SIN waId → se perdía la protección anti-doble-respuesta.
 */

import { parsearWebhook } from "@/lib/whatsapp";
import { guardarMensaje } from "@/lib/mensajes";
import type { SupabaseClient } from "@supabase/supabase-js";

let fallos = 0;
function ok(cond: boolean, nombre: string, detalle = "") {
  if (cond) console.log(`  ✓ ${nombre}`);
  else {
    fallos++;
    console.error(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// A) parsearWebhook — multimedia de Meta no se pierde
// ---------------------------------------------------------------------------
function metaPayload(msg: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PN1" },
              contacts: [{ profile: { name: "Ana" }, wa_id: "569111" }],
              messages: [{ id: "wamid.X", from: "569111", ...msg }],
            },
          },
        ],
      },
    ],
  };
}

console.log("A) parsearWebhook (Meta) — multimedia");
{
  const texto = parsearWebhook(metaPayload({ type: "text", text: { body: "Hola" } }));
  ok(texto.length === 1 && texto[0].texto === "Hola", "texto normal se procesa");

  const imgSinPie = parsearWebhook(metaPayload({ type: "image", image: {} }));
  ok(
    imgSinPie.length === 1 && imgSinPie[0].texto === "[el cliente envió una imagen]",
    "imagen SIN pie de foto se registra con marcador",
    JSON.stringify(imgSinPie),
  );

  const imgConPie = parsearWebhook(
    metaPayload({ type: "image", image: { caption: "mira esta medida" } }),
  );
  ok(
    imgConPie.length === 1 && imgConPie[0].texto === "mira esta medida",
    "imagen CON pie de foto conserva el texto",
  );

  const pdf = parsearWebhook(
    metaPayload({ type: "document", document: { filename: "logo.pdf" } }),
  );
  ok(
    pdf.length === 1 && pdf[0].texto === "[el cliente envió un archivo (logo.pdf)]",
    "documento se registra con nombre",
  );

  const audio = parsearWebhook(metaPayload({ type: "audio", audio: {} }));
  ok(audio.length === 1 && audio[0].texto === "[el cliente envió un audio]", "audio se registra");

  const loc = parsearWebhook(metaPayload({ type: "location", location: {} }));
  ok(loc.length === 1 && loc[0].texto === "[el cliente envió su ubicación]", "ubicación se registra");

  const sticker = parsearWebhook(metaPayload({ type: "sticker", sticker: {} }));
  ok(sticker.length === 1 && sticker[0].texto === "[el cliente envió un sticker]", "sticker se registra");

  const reaccion = parsearWebhook(metaPayload({ type: "reaction", reaction: { emoji: "👍" } }));
  ok(reaccion.length === 0, "reacción se ignora (no accionable)");

  // Respuestas interactivas (fix revisión independiente 1-ago): el texto del
  // botón tocado ES el mensaje del cliente — jamás "[archivo]".
  const btn = parsearWebhook(metaPayload({ type: "button", button: { text: "Confirmar pedido" } }));
  ok(btn.length === 1 && btn[0].texto === "Confirmar pedido", "botón de plantilla → texto tocado");

  const ibtn = parsearWebhook(
    metaPayload({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Ver precios" } } }),
  );
  ok(ibtn.length === 1 && ibtn[0].texto === "Ver precios", "interactive button_reply → título");

  const ilist = parsearWebhook(
    metaPayload({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "l1", title: "Corte de pelo" } } }),
  );
  ok(ilist.length === 1 && ilist[0].texto === "Corte de pelo", "interactive list_reply → título");

  const ivacio = parsearWebhook(metaPayload({ type: "interactive", interactive: { type: "button_reply" } }));
  ok(ivacio.length === 0, "interactivo sin título se ignora (no registra basura)");

  const vacio = parsearWebhook({ entry: [] });
  ok(vacio.length === 0, "payload sin mensajes → lista vacía");
}

// ---------------------------------------------------------------------------
// B) guardarMensaje — idempotencia robusta ante columnas faltantes
// ---------------------------------------------------------------------------
/**
 * Supabase falso: `faltantes` es el conjunto de columnas que "no existen".
 * Si un insert incluye alguna, devuelve el error PGRST204 (como PostgREST).
 * Si el insert incluye wa_message_id y ese id ya se vio, devuelve 23505.
 * Registra cada insert aceptado para poder inspeccionarlo.
 */
function fakeSupa(faltantes: string[]) {
  const cols = new Set(faltantes);
  const insertados: Record<string, unknown>[] = [];
  const idsVistos = new Set<string>();
  const supa = {
    from() {
      return {
        insert(obj: Record<string, unknown>) {
          const usada = Object.keys(obj).find((k) => cols.has(k));
          if (usada) {
            return Promise.resolve({
              error: { code: "PGRST204", message: `column ${usada} does not exist` },
            });
          }
          const wid = obj.wa_message_id as string | undefined;
          if (wid && idsVistos.has(wid)) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate key" },
            });
          }
          if (wid) idsVistos.add(wid);
          insertados.push(obj);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supa, insertados };
}

console.log("\nB) guardarMensaje — idempotencia robusta");
(async () => {
  // 1) Todas las columnas existen: se guarda con waId + canal + media.
  {
    const { supa, insertados } = fakeSupa([]);
    const r = await guardarMensaje(supa, {
      empleadoId: "E",
      chatId: "C",
      rol: "cliente",
      texto: "[imagen]",
      waId: "w1",
      canal: "whatsapp",
      media: { url: "http://waha/x", mime: "image/jpeg", tipo: "imagen", nombre: null },
    });
    ok(r.ok && !r.dup, "esquema completo: guarda ok");
    ok(insertados[0]?.wa_message_id === "w1", "conserva wa_message_id");
    ok(insertados[0]?.media_tipo === "imagen", "guarda media_tipo");
  }

  // 2) Migración 270 sin aplicar (media_* no existen): NO debe perder el waId.
  {
    const { supa, insertados } = fakeSupa([
      "media_url",
      "media_mime",
      "media_tipo",
      "media_nombre",
    ]);
    const r = await guardarMensaje(supa, {
      empleadoId: "E",
      chatId: "C",
      rol: "cliente",
      texto: "[imagen]",
      waId: "w2",
      canal: "whatsapp",
      media: { url: "http://waha/x", mime: "image/jpeg", tipo: "imagen", nombre: null },
    });
    ok(r.ok, "sin columnas media: guarda ok");
    ok(insertados[0]?.wa_message_id === "w2", "IDEMPOTENCIA preservada sin columnas media");
    ok(!("media_tipo" in (insertados[0] ?? {})), "no intenta escribir media_tipo");
  }

  // 3) Entrega duplicada (mismo waId): devuelve dup=true (no doble respuesta).
  {
    const { supa } = fakeSupa([]);
    await guardarMensaje(supa, { empleadoId: "E", chatId: "C", rol: "cliente", texto: "x", waId: "dup1" });
    const r2 = await guardarMensaje(supa, { empleadoId: "E", chatId: "C", rol: "cliente", texto: "x", waId: "dup1" });
    ok(r2.ok && r2.dup === true, "segundo insert del mismo waId → dup=true");
  }

  // 4) Migración 212 sin aplicar (wa_message_id no existe): cae a núcleo sin romper.
  {
    const { supa, insertados } = fakeSupa(["wa_message_id", "canal", "media_url", "media_mime", "media_tipo", "media_nombre"]);
    const r = await guardarMensaje(supa, {
      empleadoId: "E",
      chatId: "C",
      rol: "humano",
      texto: "hola",
      waId: "w4",
      canal: "whatsapp",
    });
    ok(r.ok, "sin wa_message_id/canal: guarda núcleo ok");
    ok(insertados[0] && !("wa_message_id" in insertados[0]) && !("canal" in insertados[0]), "cae a núcleo mínimo");
  }

  console.log(fallos === 0 ? "\n✅ TODOS OK" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})();
