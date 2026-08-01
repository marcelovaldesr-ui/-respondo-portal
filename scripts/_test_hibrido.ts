/**
 * Pruebas de CONVIVENCIA Tino + humano (atención híbrida), sin enviar WhatsApp
 * real: se inyecta un `enviar` simulado que solo registra el texto.
 * Corre contra la base real con un chat de prueba aislado, y limpia al final.
 * Ejecutar: source .env.local && npx tsx scripts/_test_hibrido.ts
 */
import "./_env"; // DEBE ir primero: lib/db.ts lee process.env al importarse
import { manejarEntranteWaha } from "../lib/inboundWaha";
import { db } from "../lib/db";
import { setModo } from "../lib/estadoChat";

// PORTADO A WAHA (auditoría 1-ago-2026): este test importaba
// ../lib/inboundEvolution, que se ELIMINÓ el 30-jul al retirar Evolution como
// transporte. Quedó roto (import inexistente) → la regresión de convivencia
// Tino+humano dejó de correr justo en el área más delicada. Se reescribe sobre
// el transporte vivo (WAHA), con payloads del webhook real de WAHA.
const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569HYBTEST01";

let sent: string[] = [];
const mockEnviar = async (_c: string, texto: string) => {
  sent.push(texto);
  return { ok: true, waId: "MOCK-" + Math.random().toString(36).slice(2) };
};

/** Payload del webhook de WAHA (evento message.any). timestamp=ahora para pasar
 *  la guardia de frescura (>180s se ignora). */
const ev = (text: string, fromMe: boolean, id: string, pushName?: string) => ({
  event: "message.any",
  session: "default",
  payload: {
    id,
    from: `${CHAT}@c.us`,
    fromMe,
    body: text,
    notifyName: pushName,
    timestamp: Math.floor(Date.now() / 1000),
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
  let r = await manejarEntranteWaha(ev("Hola, hacen tarjetas?", false, "C1", "Juan"), { enviar: mockEnviar });
  console.log(`\nH1 cliente (modo bot): accion=${r.accion} envió=${sent.length} modo=${await modo()}`);
  console.log("   Tino:", (sent[0] ?? "").slice(0, 100));

  sent = [];
  r = await manejarEntranteWaha(ev("Hola, hacen tarjetas?", false, "C1", "Juan"), { enviar: mockEnviar });
  console.log(`\nH2 webhook DUPLICADO (mismo id C1): accion=${r.accion} envió=${sent.length}`);
  console.log("   (con migración 212 → 'duplicado'/0 envíos; sin 212 aún puede reprocesar)");

  sent = [];
  r = await manejarEntranteWaha(ev("Yo te atiendo Juan, te hago las 500 a $28.000 fijo.", true, "H1"), { enviar: mockEnviar });
  console.log(`\nH3 TOMA DE CONTROL humana (fromMe id nuevo): accion=${r.accion} envió=${sent.length} modo=${await modo()}`);
  console.log("   (esperado: toma_humana, 0 envíos, modo=humano)");

  sent = [];
  r = await manejarEntranteWaha(ev("dale, las 500 entonces", false, "C2"), { enviar: mockEnviar });
  console.log(`\nH4 cliente con HUMANO activo: accion=${r.accion} envió=${sent.length}`);
  console.log("   (esperado: cliente:silencio, 0 envíos — Tino NO habla encima del humano)");

  await setModo(TINO, CHAT, "bot");
  sent = [];
  await manejarEntranteWaha(ev("perfecto, ya tengo el diseño listo", false, "C3"), { enviar: mockEnviar });
  const textoTino = sent[0] ?? "___";
  sent = [];
  r = await manejarEntranteWaha(ev(textoTino, true, "ECO1"), { enviar: mockEnviar });
  console.log(`\nH5 ECO (fromMe = texto propio de Tino): accion=${r.accion} modo=${await modo()}`);
  console.log("   (esperado: 'eco', NO 'toma_humana' — no se pausa por su propio mensaje)");

  await limpiar();
  await manejarEntranteWaha(ev("hola, cuanto 500 tarjetas full color 2 caras?", false, "R1", "Ana"), { enviar: mockEnviar });
  await manejarEntranteWaha(ev("Hola Ana! esas 500 te las dejo en $30.000 con un descuento especial 😉", true, "R2"), { enviar: mockEnviar });
  await setModo(TINO, CHAT, "bot");
  sent = [];
  await manejarEntranteWaha(ev("ya perfecto, y en cuanto estarian listas?", false, "R3"), { enviar: mockEnviar });
  console.log(`\nH6 REANUDACIÓN respetando al humano (humano ofreció $30.000; el fijo es $35.000):`);
  console.log("   Tino:", sent[0] ?? "(sin respuesta)");
  console.log("   (debe respetar $30.000, NO recotizar a $35.000, y responder el plazo)");

  // H7 — ECO de un mensaje que el HUMANO mandó desde el inbox NO se duplica.
  // Fix 1-ago-2026: responderComoHumano ahora guarda el mensaje humano CON su
  // wa_message_id; así, cuando WAHA devuelve ese mismo mensaje como fromMe (eco),
  // yaProcesado lo reconoce y NO lo inserta de nuevo. Antes se guardaba sin id →
  // el eco no calzaba (esEcoReciente solo mira rol=empleado) → mensaje humano
  // DUPLICADO en el inbox y en el contexto de Tino.
  await limpiar();
  await setModo(TINO, CHAT, "bot");
  await db()
    .from("ed_mensajes")
    .insert({ empleado_id: TINO, chat_id: CHAT, rol: "humano", texto: "Te confirmo y te aviso 👍", wa_message_id: "HUMANECO1" });
  sent = [];
  r = await manejarEntranteWaha(ev("Te confirmo y te aviso 👍", true, "HUMANECO1"), { enviar: mockEnviar });
  const { count: filasHumano } = await db()
    .from("ed_mensajes")
    .select("id", { count: "exact", head: true })
    .eq("empleado_id", TINO)
    .eq("chat_id", CHAT)
    .eq("wa_message_id", "HUMANECO1");
  console.log(`\nH7 ECO de mensaje del HUMANO (mismo id): accion=${r.accion} filas=${filasHumano}`);
  console.log("   (esperado: accion=duplicado o eco, y filas=1 — el mensaje del humano NO se duplica.");
  console.log("    Nota: sale 'duplicado' porque el id ya guardado se ataja en la idempotencia general,");
  console.log("    ANTES de llegar a la rama de eco — mismo efecto protector. Verificado en vivo 1-ago.)");

  await limpiar();
  console.log("\n=== fin (chat de prueba limpiado) ===");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
