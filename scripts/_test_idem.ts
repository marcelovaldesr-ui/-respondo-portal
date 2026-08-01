/** Idempotencia real (con migración 212 aplicada). Envío simulado. */
import "./_env"; // DEBE ir primero: lib/db.ts lee process.env al importarse
import { manejarEntranteWaha } from "../lib/inboundWaha"; // portado de Evolution (eliminado 30-jul)
import { db } from "../lib/db";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569IDEMTEST9";

let sent: string[] = [];
const mockEnviar = async (_c: string, t: string) => { sent.push(t); return { ok: true, waId: "SENT-" + Math.random() }; };
const ev = (text: string, fromMe: boolean, id: string) => ({
  event: "message.any", session: "default",
  payload: { id, from: `${CHAT}@c.us`, fromMe, body: text, timestamp: Math.floor(Date.now() / 1000) },
});
const supa = db();
const limpiar = async () => {
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
};

async function main() {
  await limpiar();

  sent = [];
  let r = await manejarEntranteWaha(ev("hola, idempotencia test", false, "IDEM1"), { enviar: mockEnviar });
  console.log(`I1a cliente (id IDEM1): accion=${r.accion} envió=${sent.length}  (esperado: respondió, 1)`);

  sent = [];
  r = await manejarEntranteWaha(ev("hola, idempotencia test", false, "IDEM1"), { enviar: mockEnviar });
  console.log(`I1b MISMO id IDEM1 (webhook duplicado): accion=${r.accion} envió=${sent.length}  (esperado: duplicado, 0)`);

  sent = [];
  r = await manejarEntranteWaha(ev("Yo te atiendo (humano)", true, "HUM1"), { enviar: mockEnviar });
  console.log(`I2a humano (id HUM1): accion=${r.accion} envió=${sent.length}  (esperado: toma_humana, 0)`);

  sent = [];
  r = await manejarEntranteWaha(ev("Yo te atiendo (humano)", true, "HUM1"), { enviar: mockEnviar });
  console.log(`I2b MISMO id HUM1 (duplicado): accion=${r.accion} envió=${sent.length}  (esperado: duplicado, 0)`);

  // Verifica que NO se duplicaron filas del cliente en la base:
  const { count } = await supa.from("ed_mensajes").select("id", { count: "exact", head: true })
    .eq("empleado_id", TINO).eq("chat_id", CHAT).eq("wa_message_id", "IDEM1");
  console.log(`\nFilas con wa_message_id=IDEM1 en la base: ${count}  (esperado: 1 — no se duplicó)`);

  await limpiar();
  console.log("=== fin (limpio) ===");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
