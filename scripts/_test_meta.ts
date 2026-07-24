/**
 * Pruebas del webhook OFICIAL (Cloud API) endurecido — lib/inboundMeta.ts.
 * Sin enviar WhatsApp real: `enviar` inyectado. Chat de prueba aislado; limpia al final.
 * Ejecutar: set -a; source .env.local; set +a; \
 *   WHATSAPP_PHONE_NUMBER_ID=TESTPHONE1 WHATSAPP_TOKEN=test \
 *   WHATSAPP_DEV_CLIENTE_ID=33333333-3333-3333-3333-333333333333 \
 *   npx tsx scripts/_test_meta.ts
 */
import { manejarEntranteMeta } from "../lib/inboundMeta";
import { db } from "../lib/db";
import { setModo, modoDe } from "../lib/estadoChat";

const PHONE = process.env.WHATSAPP_PHONE_NUMBER_ID || "TESTPHONE1";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569METATEST1";

let sent: { texto: string; waId: string }[] = [];
const mockEnviar = async (_c: string, texto: string) => {
  const waId = "wamid.MOCK-" + Math.random().toString(36).slice(2);
  sent.push({ texto, waId });
  return { ok: true, waId };
};

// Payload de mensaje de cliente (forma real del webhook de Meta).
const msg = (texto: string, wamid: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: PHONE },
            contacts: [{ profile: { name: "Probador Meta" }, wa_id: CHAT }],
            messages: [
              { id: wamid, from: CHAT, type: "text", text: { body: texto } },
            ],
          },
        },
      ],
    },
  ],
});

// Payload de status (ACK).
const status = (wamid: string, st: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: PHONE },
            statuses: [{ id: wamid, status: st }],
          },
        },
      ],
    },
  ],
});

// Payload de eco de Coexistencia (message_echoes).
const echo = (texto: string, wamid: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: PHONE },
            message_echoes: [
              { id: wamid, to: CHAT, type: "text", text: { body: texto } },
            ],
          },
        },
      ],
    },
  ],
});

async function main() {
  const supa = db();
  console.log("== Limpieza previa ==");
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);

  // M1: cliente escribe → Tino responde.
  console.log("\n== M1: mensaje de cliente → responde ==");
  let r = await manejarEntranteMeta(msg("Hola, ¿hacen tarjetas de presentación?", "wamid.M1"), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  console.log("  enviados:", sent.length, sent[0]?.texto.slice(0, 60) ?? "(nada)");
  if (!r.some((x) => x.accion.startsWith("cliente:respondio")) || sent.length !== 1) throw new Error("M1 FALLÓ");

  // M2: Meta reintenta el MISMO wamid → duplicado, NO responde de nuevo.
  console.log("\n== M2: reintento de Meta (mismo wamid) → duplicado ==");
  r = await manejarEntranteMeta(msg("Hola, ¿hacen tarjetas de presentación?", "wamid.M1"), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  if (!r.some((x) => x.accion === "duplicado") || sent.length !== 1) throw new Error("M2 FALLÓ");

  // M3: ACK delivered del envío de Tino → estado_envio=entregado.
  console.log("\n== M3: status delivered del envío de Tino ==");
  r = await manejarEntranteMeta(status(sent[0].waId, "delivered"));
  console.log("  →", JSON.stringify(r));
  const { data: mm } = await supa
    .from("ed_mensajes").select("estado_envio").eq("empleado_id", TINO)
    .eq("wa_message_id", sent[0].waId).maybeSingle();
  console.log("  estado_envio en DB:", mm?.estado_envio);
  if (mm?.estado_envio !== "entregado") throw new Error("M3 FALLÓ");

  // M4: eco del PROPIO envío de Tino (mismo wamid) → eco, sin toma humana.
  console.log("\n== M4: message_echo del propio envío de Tino → eco ==");
  r = await manejarEntranteMeta(echo(sent[0].texto, sent[0].waId), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  if (!r.some((x) => x.accion === "eco")) throw new Error("M4 FALLÓ");

  // M5: eco con id DESCONOCIDO (Cecilia escribe desde su app) → toma humana.
  console.log("\n== M5: echo humano (id desconocido) → toma_humana (espera 2.5s) ==");
  r = await manejarEntranteMeta(echo("Hola, soy Cecilia, yo te atiendo", "wamid.HUMANO1"), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  const modo1 = await modoDe(TINO, CHAT);
  console.log("  modo del chat:", modo1);
  if (!r.some((x) => x.accion === "toma_humana") || modo1 !== "humano") throw new Error("M5 FALLÓ");

  // M6: cliente escribe con humano al mando → Tino calla.
  console.log("\n== M6: cliente escribe en modo humano → silencio ==");
  const antes = sent.length;
  r = await manejarEntranteMeta(msg("ya, gracias", "wamid.M6"), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  if (!r.some((x) => x.accion === "cliente:silencio") || sent.length !== antes) throw new Error("M6 FALLÓ");

  // M7: devolver a Tino → vuelve a responder.
  console.log("\n== M7: devolver a Tino → responde de nuevo ==");
  await setModo(TINO, CHAT, "bot");
  r = await manejarEntranteMeta(msg("¿y hacen flyers?", "wamid.M7"), { enviar: mockEnviar });
  console.log("  →", JSON.stringify(r));
  console.log("  última respuesta:", sent[sent.length - 1]?.texto.slice(0, 60));
  if (!r.some((x) => x.accion.startsWith("cliente:respondio")) || sent.length !== antes + 1) throw new Error("M7 FALLÓ");

  console.log("\n== Limpieza final ==");
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id", process.env.WHATSAPP_DEV_CLIENTE_ID!).eq("chat_id", CHAT);
  await supa.from("ed_escalaciones").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);

  console.log("\n✅ TODAS LAS PRUEBAS META PASARON (M1-M7)");
}

main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
