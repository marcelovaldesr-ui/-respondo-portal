/** Solo M7 (devolver a Tino → responde) + limpieza final. */
import { manejarEntranteMeta } from "../lib/inboundMeta";
import { db } from "../lib/db";
import { setModo } from "../lib/estadoChat";

const PHONE = process.env.WHATSAPP_PHONE_NUMBER_ID || "TESTPHONE1";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569METATEST1";

let sent: string[] = [];
const mockEnviar = async (_c: string, texto: string) => {
  sent.push(texto);
  return { ok: true, waId: "wamid.MOCK-" + Math.random().toString(36).slice(2) };
};

const msg = (texto: string, wamid: string) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: PHONE },
            messages: [{ id: wamid, from: CHAT, type: "text", text: { body: texto } }],
          },
        },
      ],
    },
  ],
});

async function main() {
  const supa = db();
  await setModo(TINO, CHAT, "bot");
  const r = await manejarEntranteMeta(msg("¿y hacen flyers?", "wamid.M7b"), { enviar: mockEnviar });
  console.log("M7 →", JSON.stringify(r));
  console.log("respuesta:", sent[0]?.slice(0, 70) ?? "(nada)");
  const ok = r.some((x) => x.accion.startsWith("cliente:respondio")) && sent.length === 1;

  // Limpieza total del chat de prueba
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id", process.env.WHATSAPP_DEV_CLIENTE_ID!).eq("chat_id", CHAT);
  await supa.from("ed_escalaciones").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);

  if (!ok) throw new Error("M7 FALLÓ");
  console.log("✅ M7 OK + limpieza hecha");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
