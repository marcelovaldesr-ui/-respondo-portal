/**
 * RECUPERACIÓN DE MENSAJES HUÉRFANOS (auditoría externa 13-sep-2026, P1).
 *
 * Si la invocación que guardó un mensaje del cliente muere DESPUÉS de
 * persistirlo pero ANTES de responder (timeout, excepción), el reintento del
 * proveedor llegaba a `yaProcesado`, decía "duplicado" y nadie respondía
 * nunca: el cliente quedaba mudo en modo bot, donde el vigilante
 * (lib/reingresoTino.ts) no mira — solo revisa chats en modo "humano".
 *
 * `mensajeSinRespuesta` (lib/mensajes.ts) es la función que decide si ese
 * mensaje puede recuperarse. Nació en lib/inboundMeta.ts (3-sep-2026); esta
 * auditoría encontró que WAHA e Instagram nunca la tuvieron — la
 * canonicalizó acá para que las tres compartan la MISMA regla, sin copiarla
 * tres veces (ver el test de abajo, calcado de tests/turno-tino.test.mjs).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mensajeSinRespuesta } from "../lib/mensajes.ts";
import { crearSupaFalso } from "./_supaFalso.mjs";

const EMPLEADO = "tino-1";
const CHAT = "56911112222";
const WAID = "wamid.ABC123";

/**
 * Arma un supa falso para mensajeSinRespuesta:
 *  - originalCreadoEn: fecha del mensaje original (null = no existe).
 *  - modo: el de ed_chat_estado.
 *  - ultimo: { waId, rol } del último mensaje del chat (null = no hay ninguno).
 */
function supaPara({ originalCreadoEn, modo = "bot", ultimo }) {
  return crearSupaFalso((ll) => {
    if (ll.tabla === "ed_mensajes" && ll.select === "creado_en") {
      return { data: originalCreadoEn ? { creado_en: originalCreadoEn } : null };
    }
    if (ll.tabla === "ed_mensajes" && ll.select === "wa_message_id, rol") {
      return { data: ultimo ? { wa_message_id: ultimo.waId, rol: ultimo.rol } : null };
    }
    if (ll.tabla === "ed_chat_estado") {
      return { data: { modo } };
    }
    return { data: null };
  });
}

test("sin mensaje original guardado, nunca es huérfano", async () => {
  const supa = supaPara({ originalCreadoEn: null });
  assert.equal(await mensajeSinRespuesta(supa, EMPLEADO, CHAT, WAID), false);
});

test("⭐ A) caso normal: el negocio ya respondió — no es huérfano, no se re-responde", async () => {
  // El último mensaje del chat ya NO es el del cliente (Tino ya contestó, o
  // llegó uno más nuevo del cliente): un reintento de este id sigue siendo
  // un simple duplicado.
  const vieja = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min, de sobra >90s
  const supa = supaPara({ originalCreadoEn: vieja, modo: "bot", ultimo: { waId: "otro-id", rol: "empleado" } });
  assert.equal(await mensajeSinRespuesta(supa, EMPLEADO, CHAT, WAID), false);
});

test("muy reciente (<90s): la invocación original todavía podría estar viva — no se toca", async () => {
  const reciente = new Date(Date.now() - 10_000).toISOString();
  const supa = supaPara({ originalCreadoEn: reciente, modo: "bot", ultimo: { waId: WAID, rol: "cliente" } });
  assert.equal(await mensajeSinRespuesta(supa, EMPLEADO, CHAT, WAID), false);
});

test("⭐ D) una persona tomó el control: NO se recupera — no se habla encima del humano", async () => {
  const vieja = new Date(Date.now() - 5 * 60_000).toISOString();
  for (const modo of ["humano", "pausado"]) {
    const supa = supaPara({ originalCreadoEn: vieja, modo, ultimo: { waId: WAID, rol: "cliente" } });
    assert.equal(await mensajeSinRespuesta(supa, EMPLEADO, CHAT, WAID), false, `modo ${modo}`);
  }
});

test("⭐ B) huérfano real: viejo, en modo bot, sigue siendo el último mensaje del cliente → SE RECUPERA", async () => {
  const vieja = new Date(Date.now() - 5 * 60_000).toISOString();
  const supa = supaPara({ originalCreadoEn: vieja, modo: "bot", ultimo: { waId: WAID, rol: "cliente" } });
  assert.equal(await mensajeSinRespuesta(supa, EMPLEADO, CHAT, WAID), true);
});

test("los tres transportes comparten la misma función de recuperación, no una copia", async () => {
  // Igual que turno-tino.test.mjs con conservaElTurno: la divergencia entre
  // copias (WAHA/Instagram sin la protección que Meta sí tenía) fue
  // exactamente el hallazgo de esta auditoría.
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/inboundMeta.ts", "lib/inboundWaha.ts", "lib/inboundInstagram.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /mensajeSinRespuesta\(/, `${f} debe usar la recuperación compartida`);
    assert.doesNotMatch(
      src,
      /async function mensajeSinRespuesta/,
      `${f} no debe tener su propia copia — la función vive en lib/mensajes.ts`,
    );
  }
});
