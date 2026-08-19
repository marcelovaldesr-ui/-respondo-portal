/**
 * GUARDIA DE TRANSPORTE (18-ago-2026) — evita la doble respuesta al migrar
 * Impresora Color de WAHA a la Cloud API.
 *
 * El onboarding de Meta pone transporte='cloud' al instante, pero la sesión de
 * WAHA sigue vinculada y su webhook sigue llegando. Sin guardia, el cliente
 * recibe dos respuestas y cada canal cree que una persona tomó el control.
 *
 * Esta prueba usa el chat de test aislado y va cambiando `transporte` del
 * cliente demo para comprobar las dos direcciones. Restaura el valor original
 * al terminar, pase lo que pase.
 *
 * Ejecutar: npx tsx scripts/_test_guardia_transporte.ts
 */
import "./_env";
import { manejarEntranteWaha } from "../lib/inboundWaha";
import { db } from "../lib/db";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";
const CHAT = "569TRANSPTEST";

const ev = (texto: string, id: string) => ({
  event: "message.any",
  session: "default",
  payload: {
    id,
    from: `${CHAT}@c.us`,
    fromMe: false,
    body: texto,
    timestamp: Math.floor(Date.now() / 1000),
  },
});

async function main() {
  const supa = db();
  let fallos = 0;
  const ok = (c: boolean, n: string) => {
    if (c) console.log(`  ✓ ${n}`);
    else { fallos++; console.error(`  ✗ ${n}`); }
  };

  const { data: antes } = await supa
    .from("ed_clientes").select("transporte").eq("id", CID).maybeSingle();
  const original = (antes?.transporte as string | null) ?? "waha";
  console.log(`transporte original del cliente demo: ${original}\n`);

  const limpiar = async () => {
    await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
  };
  const setTransporte = async (t: string) =>
    supa.from("ed_clientes").update({ transporte: t }).eq("id", CID);

  try {
    // --- CASO 1: cliente en 'cloud' → WAHA debe callarse y NO guardar ---
    await limpiar();
    await setTransporte("cloud");
    let enviados: string[] = [];
    const mock = async (_c: string, t: string) => {
      enviados.push(t);
      return { ok: true, waId: "MOCK1" };
    };
    console.log("=== CASO 1: cliente migrado a 'cloud' — el webhook de WAHA llega igual ===");
    const r1 = await manejarEntranteWaha(ev("Hola, cuanto valen 100 tarjetas?", "TR1"), { enviar: mock });
    const { count: guardados } = await supa
      .from("ed_mensajes").select("id", { count: "exact", head: true })
      .eq("empleado_id", TINO).eq("chat_id", CHAT);
    ok(r1.accion === "otro_transporte", `accion=otro_transporte (fue "${r1.accion}")`);
    ok(enviados.length === 0, `WAHA no envió nada (envió ${enviados.length})`);
    ok((guardados ?? 0) === 0, `no guardó el mensaje (habría duplicado el historial); filas=${guardados}`);

    // --- CASO 2: cliente en 'waha' → todo sigue funcionando igual que siempre ---
    await limpiar();
    await setTransporte("waha");
    enviados = [];
    console.log("\n=== CASO 2: cliente en 'waha' (hoy / tras rollback) — debe responder normal ===");
    const r2 = await manejarEntranteWaha(ev("Hola, cuanto valen 100 tarjetas?", "TR2"), { enviar: mock });
    ok(r2.accion.startsWith("cliente:"), `responde normal (accion="${r2.accion}")`);
    ok(enviados.length === 1, `envió exactamente 1 respuesta (envió ${enviados.length})`);
    if (enviados[0]) console.log(`     Tino: ${enviados[0].slice(0, 90)}`);
  } finally {
    await setTransporte(original);
    await limpiar();
    const { data: fin } = await supa
      .from("ed_clientes").select("transporte").eq("id", CID).maybeSingle();
    console.log(`\ntransporte restaurado a: ${fin?.transporte}`);
  }

  console.log(fallos === 0 ? "\n✅ GUARDIA DE TRANSPORTE OK" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
