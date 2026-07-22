/** Eco + reanudación-con-contexto (rápido: solo 1 llamada a Gemini). */
import { manejarEntranteEvolution } from "../lib/inboundEvolution";
import { db } from "../lib/db";
import { setModo } from "../lib/estadoChat";

const INSTANCIA = "impresora-color";
const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569HYBTEST02";

let sent: string[] = [];
const mockEnviar = async (_c: string, t: string) => { sent.push(t); return { ok: true, waId: "M" + Math.random() }; };
const ev = (text: string, fromMe: boolean, id: string) => ({
  event: "messages.upsert", instance: INSTANCIA,
  data: { key: { remoteJid: `${CHAT}@s.whatsapp.net`, fromMe, id }, message: { conversation: text } },
});
const supa = db();
async function limpiar() {
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
}
async function modo() {
  const { data } = await supa.from("ed_chat_estado").select("modo").eq("empleado_id", TINO).eq("chat_id", CHAT).maybeSingle();
  return (data?.modo as string) ?? "(sin fila)";
}

async function main() {
  await limpiar();
  const TXT = "Perfecto, te confirmo apenas esté listo el diseño 👍 (eco-test)";
  // Simula que Tino ya envió ese mensaje (rol=empleado) hace un momento:
  await supa.from("ed_mensajes").insert({ empleado_id: TINO, chat_id: CHAT, rol: "empleado", texto: TXT });
  await setModo(TINO, CHAT, "bot");

  sent = [];
  let r = await manejarEntranteEvolution(ev(TXT, true, "ECOX"), { enviar: mockEnviar });
  console.log(`H5 ECO (fromMe = texto propio de Tino): accion=${r.accion} modo=${await modo()} envió=${sent.length}`);
  console.log("   (esperado: 'eco', modo sigue 'bot', 0 envíos — NO se pausa por su propio mensaje)");

  sent = [];
  r = await manejarEntranteEvolution(ev("Hola Juan, yo te sigo atendiendo", true, "HUMX"), { enviar: mockEnviar });
  console.log(`\nH5b TOMA humana (fromMe texto NUEVO): accion=${r.accion} modo=${await modo()} envió=${sent.length}`);
  console.log("   (esperado: 'toma_humana', modo 'humano', 0 envíos)");

  // Reanudación respetando al humano
  await limpiar();
  await supa.from("ed_mensajes").insert([
    { empleado_id: TINO, chat_id: CHAT, rol: "cliente", texto: "hola, cuanto 500 tarjetas full color 2 caras?" },
    { empleado_id: TINO, chat_id: CHAT, rol: "humano", texto: "Hola Ana! esas 500 te las dejo en $30.000 con descuento especial 😉" },
  ]);
  await setModo(TINO, CHAT, "bot");
  sent = [];
  await manejarEntranteEvolution(ev("ya perfecto, y en cuanto estarian listas?", false, "R3"), { enviar: mockEnviar });
  console.log(`\nH6 REANUDACIÓN (humano ofreció $30.000; el precio fijo es $35.000):`);
  console.log("   Tino:", sent[0] ?? "(sin respuesta)");
  console.log("   (debe respetar $30.000, NO recotizar $35.000; responde el plazo)");

  await limpiar();
  console.log("\n=== fin ===");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
