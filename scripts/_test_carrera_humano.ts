/**
 * REPRODUCCIÓN DETERMINISTA DE LA CARRERA B1 (revisión independiente 1-ago-2026).
 *
 * Bug original: responderSiBot re-lee el modo ANTES de la espera de tipeo de
 * enviarTextoWaha (1.5–6 s de "escribiendo…"). Si la persona toca "Tomar el
 * control" DURANTE esa espera, la comprobación ya pasó y —sin el fix— Tino
 * mandaba su respuesta ENCIMA del humano.
 *
 * Cómo se reproduce SIN azar: se levanta un servidor WAHA FALSO en localhost.
 * Su handler de /api/startTyping (el primer paso del envío real) ejecuta
 * setModo(humano) — o sea, la toma de control ocurre EXACTAMENTE dentro de la
 * ventana de tipeo. Luego se afirma que /api/sendText NUNCA recibe el mensaje.
 *
 * Con el fix (sigueVigente ahora chequea modoDe()===bot y se evalúa como
 * `vigente` justo antes del sendText), el envío se aborta con
 * "obsoleto:llego_mensaje_nuevo". Sin el fix, sendText se llama → el test falla.
 *
 * Corre contra la BD real con un chat de prueba aislado (se limpia al final) y
 * el WhatsApp es 100% falso (localhost). Ejecutar:
 *     npx tsx scripts/_test_carrera_humano.ts
 */
import { createServer } from "http";
import type { AddressInfo } from "net";

async function main() {
  // 1) Servidor WAHA falso — DEBE existir antes de importar lib/waha (BASE es
  //    constante de módulo), por eso los imports de la app son dinámicos.
  const llamadas: string[] = [];
  let alEmpezarATipear: (() => Promise<void>) | null = null;

  const server = createServer(async (req, res) => {
    const ruta = req.url ?? "";
    llamadas.push(ruta);
    // Consumir el body para no dejar sockets colgando.
    for await (const _ of req) {
      /* drain */
    }
    if (ruta.includes("startTyping") && alEmpezarATipear) {
      // ← LA CARRERA: la persona toma el control mientras Tino "escribe".
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

  // 2) Ahora sí: cargar env de la BD e importar la app.
  await import("./_env");
  const { manejarEntranteWaha } = await import("../lib/inboundWaha");
  const { db } = await import("../lib/db");
  const { setModo } = await import("../lib/estadoChat");

  const CID = "33333333-3333-3333-3333-333333333333";
  const TINO = "a3333333-0000-0000-0000-000000000001";
  const CHAT = "569RACETEST1";
  const supa = db();

  const limpiar = async () => {
    await supa.from("ed_mensajes").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_chat_estado").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
    await supa.from("ed_contactos").delete().eq("cliente_id", CID).eq("chat_id", CHAT);
    await supa.from("ed_escalaciones").delete().eq("empleado_id", TINO).eq("chat_id", CHAT);
  };
  await limpiar();

  // La toma de control se dispara desde el startTyping del servidor falso.
  alEmpezarATipear = async () => {
    await setModo(TINO, CHAT, "humano", supa);
    console.log("   [carrera] persona tomó el control DURANTE el tipeo");
  };

  console.log("=== CARRERA B1: toma de control durante el 'escribiendo…' ===");
  const r = await manejarEntranteWaha({
    event: "message.any",
    session: "default",
    payload: {
      id: "RACE1",
      from: `${CHAT}@c.us`,
      fromMe: false,
      body: "Hola, ¿hacen pendones? Necesito uno urgente para mañana.",
      timestamp: Math.floor(Date.now() / 1000),
    },
  }); // SIN mock de envío: usa enviarTextoWaha real → servidor falso

  const seEnvio = llamadas.some((u) => u.includes("sendText"));
  const huboTipeo = llamadas.some((u) => u.includes("startTyping"));

  console.log(`\n   accion=${r.accion} detalle=${r.detalle ?? ""}`);
  console.log(`   startTyping llegó: ${huboTipeo} · sendText llegó: ${seEnvio}`);

  let fallos = 0;
  if (!huboTipeo) {
    console.error("   ✗ PRECONDICIÓN: el flujo no llegó al tipeo (no se ejerció la carrera)");
    fallos++;
  }
  if (seEnvio) {
    console.error("   ✗ FALLO: Tino ENVIÓ encima del humano (sendText salió)");
    fallos++;
  } else {
    console.log("   ✓ Tino NO envió encima del humano (sendText nunca salió)");
  }

  // El aviso de fallback tampoco debe salir: no hubo error de modelo, solo
  // obsolescencia. La respuesta queda guardada como no enviada (auditable).
  const { data: ultimo } = await supa
    .from("ed_mensajes")
    .select("rol, texto")
    .eq("empleado_id", TINO)
    .eq("chat_id", CHAT)
    .eq("rol", "empleado")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultimo) {
    console.log(`   (la respuesta quedó registrada sin enviar: "${(ultimo.texto as string).slice(0, 60)}…")`);
  }

  await limpiar();
  server.close();
  console.log(fallos === 0 ? "\n✅ CARRERA B1 CONTROLADA" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
