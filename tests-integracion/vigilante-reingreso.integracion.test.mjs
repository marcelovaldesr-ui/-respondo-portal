import test from "node:test";
import assert from "node:assert/strict";

import { clienteDePruebaSoloLectura } from "./soporte/entorno.mjs";
import { instalarMocksDeSalida } from "./soporte/mocksSalida.mjs";
import { resumenBitacora } from "./soporte/dbSoloLectura.mjs";

/**
 * revisarAbandonadas — "EL VIGILANTE DE CONVERSACIONES ABANDONADAS" (así se
 * autodescribe en lib/reingresoTino.ts) — es el módulo más delicado de los
 * tres: además de leer/escribir en la base, decide con el modelo (Gemini) si
 * le vuelve a escribir al cliente, y puede mandar un WhatsApp real.
 *
 * Por eso esta prueba es la que más mocks necesita (ver soporte/mocksSalida.mjs):
 * Gemini queda interceptado con una respuesta neutra ("no digas nada"), y
 * WhatsApp/WAHA/push/puente quedan bloqueados pase lo que pase.
 *
 * El propio módulo trae un presupuesto de tiempo (`MINIMO_POR_REVISION_MS`,
 * 22 s) para no arrancar una revisión que no alcanza a terminar antes del
 * `fechaLimite`: por eso acá se le da bastante más margen que a las otras dos
 * pruebas — con menos, corta apenas empieza sin revisar ningún candidato de
 * verdad, y esta prueba dejaría de probar nada.
 */
test("revisarAbandonadas (el vigilante) corre contra la base real sin mandar nada de verdad", async (t) => {
  const { llamadas, restaurar } = await instalarMocksDeSalida();
  t.after(() => restaurar());

  const { revisarAbandonadas } = await import("@/lib/reingresoTino");
  const { cliente, bitacora } = clienteDePruebaSoloLectura();

  const resumen = await revisarAbandonadas(cliente, { fechaLimite: Date.now() + 45_000 });

  console.log("\n[vigilante] resumen:", resumen);
  console.log(
    "[vigilante] mensajes que se habrían mandado — waha:",
    llamadas.waha.length,
    "| meta:",
    llamadas.metaTexto.length,
  );
  console.log("[vigilante] avisos push que se habrían mandado:", llamadas.push.length);
  console.log("[vigilante] consultas al modelo interceptadas (no llegaron a Gemini de verdad):", llamadas.gemini.length);
  console.log("[vigilante] escrituras interceptadas:", resumenBitacora(bitacora));

  assert.ok(resumen);
  assert.equal(typeof resumen.revisados, "number");
  assert.equal(typeof resumen.reingresados, "number");
  assert.equal(typeof resumen.callados, "number");
  assert.ok(Array.isArray(resumen.detalle));

  // Con Gemini siempre devolviendo "{}" (accion "nada"), nunca debería haber
  // decidido mandar un mensaje real — si esto falla, revisar reingresoDecision.ts:
  // algo estaría tratando un JSON vacío como una decisión válida de responder.
  assert.equal(llamadas.waha.length, 0);
  assert.equal(llamadas.metaTexto.length, 0);

  // Este módulo solo debería tocar ed_contactos y ed_reingresos (bitácora de
  // reingresos) y ed_mensajes (si guarda el mensaje que mandaría).
  const tablasEsperadas = new Set(["ed_contactos", "ed_reingresos", "ed_mensajes"]);
  for (const e of bitacora) {
    assert.ok(
      tablasEsperadas.has(e.tabla),
      `escritura en una tabla no esperada: ${JSON.stringify(e)}`,
    );
  }
});
