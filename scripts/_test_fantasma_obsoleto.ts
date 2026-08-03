/**
 * REPRODUCCIÓN: mensaje "fantasma" cuando la respuesta queda obsoleta DURANTE
 * el tipeo (mensajes fragmentados del cliente — caso real 1-ago-2026,
 * Impresora Color, chat "Ese" / "Mismo" / "Es ese mismo": Tino preguntó lo
 * mismo 4 veces seguidas en ~1 minuto).
 *
 * Root cause encontrada en la auditoría de Monday-readiness (3-ago-2026):
 * enviarTextoWaha ya revisaba `vigente` justo antes de mandar (después del
 * "escribiendo…") y correctamente NO llamaba a /sendText si llegó un mensaje
 * más nuevo del cliente mientras tanto. Pero responderBot.ts IGNORABA ese
 * resultado y guardaba la respuesta en ed_mensajes de todos modos — un
 * mensaje "fantasma" que el cliente nunca recibió, pero que sí aparecía en el
 * historial (Tino "creía" haberlo dicho) y en el inbox del portal (parecía
 * que Tino repitió la pregunta más veces de las que en realidad mandó).
 *
 * Se reproduce SIN azar con un WAHA falso: su handler de /api/startTyping
 * inserta un mensaje de cliente MÁS NUEVO justo antes de que termine el
 * tipeo — exactamente la ventana que describía el comentario de "Erika
 * Pedreros" en enviarTextoWaha. Se afirma que /api/sendText nunca se llama Y
 * que NO queda ninguna fila fantasma en ed_mensajes.
 *
 * Ejecutar: npx tsx scripts/_test_fantasma_obsoleto.ts
 */
import { createServer } from "http";
import type { AddressInfo } from "net";

async function main() {
  const llamadas: string[] = [];
  let alEmpezarATipear: (() => Promise<void>) | null = null;

  const server = createServer(async (req, res) => {
    const ruta = req.url ?? "";
    llamadas.push(ruta);
    for await (const _ of req) {
      /* drain */
    }
    if (ruta.includes("startTyping") && alEmpezarATipear) {
      await alEmpezarATipear();
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "FAKE_SEND_ID" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const puerto = (server.address() as AddressInfo).port;

  process.env.WAHA_API_URL = `http://127.0.0.1:${puerto}`;
  process.env.WAHA_API_KEY = "fake-key-test";
  process.env.ENV_SILENCIO = "1";

  await import("./_env");
  const { manejarEntranteWaha } = await import("../lib/inboundWaha");
  const { db } = await import("../lib/db");

  const CID = "33333333-3333-3333-3333-333333333333";
  const TINO = "a3333333-0000-0000-0000-000000000001";
  const CHAT = "569FANTASMA1";
  const supa = db();

  const limpiar = async () => {
    await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
    await supa.from("ed_escalaciones").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  };
  await limpiar();

  // Durante el "escribiendo…", el cliente manda un mensaje MÁS NUEVO — el
  // fragmento siguiente ("Mismo" llegando mientras se procesaba "Ese").
  alEmpezarATipear = async () => {
    await supa.from("ed_mensajes").insert({
      empleado_id: TINO,
      chat_id: CHAT,
      rol: "cliente",
      texto: "Mismo",
      wa_message_id: "FRAG2",
    });
    console.log("   [carrera] llegó un fragmento MÁS NUEVO del cliente durante el tipeo");
  };

  console.log("=== FANTASMA: respuesta obsoleta durante el tipeo (fragmentos) ===");
  const r = await manejarEntranteWaha({
    event: "message.any",
    session: "default",
    payload: {
      id: "FRAG1",
      from: `${CHAT}@c.us`,
      fromMe: false,
      body: "Ese",
      timestamp: Math.floor(Date.now() / 1000),
    },
  });

  const seEnvio = llamadas.some((u) => u.includes("sendText"));
  console.log(`\n   accion=${r.accion} detalle=${r.detalle ?? ""}`);
  console.log(`   sendText llegó: ${seEnvio}`);

  let fallos = 0;
  const ok = (c: boolean, n: string) => {
    if (c) console.log(`   ✓ ${n}`);
    else {
      fallos++;
      console.error(`   ✗ ${n}`);
    }
  };

  ok(!seEnvio, "no se llamó a sendText (la respuesta a 'Ese' no se mandó de verdad)");

  const { data: fantasmas } = await supa
    .from("ed_mensajes")
    .select("id, texto")
    .eq("empleado_id", TINO)
    .eq("chat_id", CHAT)
    .eq("rol", "empleado");
  ok(
    (fantasmas ?? []).length === 0,
    `NO queda ninguna fila fantasma de 'empleado' en ed_mensajes (encontradas: ${(fantasmas ?? []).length})`,
  );

  await limpiar();
  server.close();
  console.log(fallos === 0 ? "\n✅ SIN FANTASMAS" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
