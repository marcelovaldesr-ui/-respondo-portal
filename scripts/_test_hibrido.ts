/**
 * Pruebas de CONVIVENCIA Tino + humano (atención híbrida), sin enviar WhatsApp
 * real: se inyecta un `enviar` simulado que solo registra el texto.
 * Corre contra la base real con un chat de prueba aislado, y limpia al final.
 * Ejecutar: source .env.local && npx tsx scripts/_test_hibrido.ts
 */
import { manejarEntranteEvolution } from "../lib/inboundEvolution";
import { db } from "../lib/db";
import { setModo } from "../lib/estadoChat";

const INSTANCIA = "impresora-color";
const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569HYBTEST01";

let sent: string[] = [];
const mockEnviar = async (_c: string, texto: string) => {
  sent.push(texto);
  return { ok: true, waId: "MOCK-" + Math.random().toString(36).slice(2) };
};

const ev = (text: string, fromMe: boolean, id: string, pushName?: string) => ({
  event: "messages.upsert",
  instance: INSTANCIA,
  data: {
    key: { remoteJid: `${CHAT}@s.whatsapp.net`, fromMe, id },
    pushName,
    message: { conversation: text },
  },
});

async function limpiar() {
  const supa = db();
  await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
  await supa.from("ed_escalaciones").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
}
async function modo() {
  const { data } = await db()
    .from("ed_chat_estado").select("modo")
    .eq("empleado_id", TINO).eq("chat_id", CHAT).maybeSingle();
  return (data?.modo as string) ?? "(sin fila)";
}

async function main() {
  await limpiar();
  console.log("=== CONVIVENCIA TINO + HUMANO ===");

  sent = [];
  let r = await manejarEntranteEvolution(ev("Hola, hacen tarjetas?", false, "C1", "Juan"), { enviar: mockEnviar });
  console.log(`\nH1 cliente (modo bot): accion=${r.accion} envió=${sent.length} modo=${await modo()}`);
  console.log("   Tino:", (sent[0] ?? "").slice(0, 100));

  sent = [];
  r = await manejarEntranteEvolution(ev("Hola, hacen tarjetas?", false, "C1", "Juan"), { enviar: mockEnviar });
  console.log(`\nH2 webhook DUPLICADO (mismo id C1): accion=${r.accion} envió=${sent.length}`);
  console.log("   (con migración 212 → 'duplicado'/0 envíos; sin 212 aún puede reprocesar)");

  sent = [];
  r = await manejarEntranteEvolution(ev("Yo te atiendo Juan, te hago las 500 a $28.000 fijo.", true, "H1"), { enviar: mockEnviar });
  console.log(`\nH3 TOMA DE CONTROL humana (fromMe id nuevo): accion=${r.accion} envió=${sent.length} modo=${await modo()}`);
  console.log("   (esperado: toma_humana, 0 envíos, modo=humano)");

  sent = [];
  r = await manejarEntranteEvolution(ev("dale, las 500 entonces", false, "C2"), { enviar: mockEnviar });
  console.log(`\nH4 cliente con HUMANO activo: accion=${r.accion} envió=${sent.length}`);
  console.log("   (esperado: cliente:silencio, 0 envíos — Tino NO habla encima del humano)");

  await setModo(TINO, CHAT, "bot");
  sent = [];
  await manejarEntranteEvolution(ev("perfecto, ya tengo el diseño listo", false, "C3"), { enviar: mockEnviar });
  const textoTino = sent[0] ?? "___";
  sent = [];
  r = await manejarEntranteEvolution(ev(textoTino, true, "ECO1"), { enviar: mockEnviar });
  console.log(`\nH5 ECO (fromMe = texto propio de Tino): accion=${r.accion} modo=${await modo()}`);
  console.log("   (esperado: 'eco', NO 'toma_humana' — no se pausa por su propio mensaje)");

  await limpiar();
  await manejarEntranteEvolution(ev("hola, cuanto 500 tarjetas full color 2 caras?", false, "R1", "Ana"), { enviar: mockEnviar });
  await manejarEntranteEvolution(ev("Hola Ana! esas 500 te las dejo en $30.000 con un descuento especial 😉", true, "R2"), { enviar: mockEnviar });
  await setModo(TINO, CHAT, "bot");
  sent = [];
  await manejarEntranteEvolution(ev("ya perfecto, y en cuanto estarian listas?", false, "R3"), { enviar: mockEnviar });
  console.log(`\nH6 REANUDACIÓN respetando al humano (humano ofreció $30.000; el fijo es $35.000):`);
  console.log("   Tino:", sent[0] ?? "(sin respuesta)");
  console.log("   (debe respetar $30.000, NO recotizar a $35.000, y responder el plazo)");

  await limpiar();
  console.log("\n=== fin (chat de prueba limpiado) ===");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
