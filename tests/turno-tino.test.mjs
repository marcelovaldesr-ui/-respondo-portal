import assert from "node:assert/strict";
import test from "node:test";

import { conservaElTurno, evaluarTurno } from "../lib/turnoTino.ts";

/**
 * ⭐ LA REGLA QUE MÁS INCIDENTES HA CAUSADO EN ESTE PRODUCTO.
 *
 * Entre que Tino empieza a pensar y el momento de mandar el mensaje pasan
 * varios segundos: la llamada al modelo, el "escribiendo…", el delay humano.
 * En esos segundos el dueño puede haber contestado desde su teléfono, o el
 * cliente puede haber mandado otro mensaje. Tino tiene que darse cuenta.
 *
 * Hasta la Fase 3 esta regla estaba escrita TRES veces, una por transporte, y
 * las copias se habían separado: la de Instagram nunca miraba el modo. Estos
 * tests existen para que no vuelva a pasar.
 */

test("⭐ si una persona tomó el control, Tino se calla — aunque nada más haya cambiado", () => {
  // El caso del brief: el cliente manda una foto, el humano toma la
  // conversación, y cinco segundos después Tino termina de procesar la imagen.
  for (const modo of ["humano", "pausado"]) {
    const v = evaluarTurno({ modo, idUltimoDelCliente: "m1", idQueRespondo: "m1" });
    assert.equal(v.conserva, false, `modo ${modo}`);
    assert.equal(v.motivo, "modo_no_bot");
  }
});

test("⭐ si llegó un mensaje más nuevo, esta respuesta ya no sirve", () => {
  // Otra ejecución, con el historial completo, va a contestar mejor. Este es
  // el bug del 23:14:36 que documenta responderBot.ts: una pregunta, tres
  // respuestas.
  const v = evaluarTurno({ modo: "bot", idUltimoDelCliente: "m2", idQueRespondo: "m1" });
  assert.equal(v.conserva, false);
  assert.equal(v.motivo, "mensaje_mas_nuevo");
});

test("con el chat en modo bot y siendo el último mensaje, Tino habla", () => {
  const v = evaluarTurno({ modo: "bot", idUltimoDelCliente: "m1", idQueRespondo: "m1" });
  assert.deepEqual(v, { conserva: true, motivo: "ok" });
});

test("el modo manda sobre el id: aunque sea el último mensaje, si hay humano se calla", () => {
  // El orden importa. Si se evaluara primero el id, un chat tomado por una
  // persona dejaría pasar la respuesta cuando no hubiera mensajes nuevos, que
  // es justamente el caso más común del takeover.
  assert.equal(
    conservaElTurno({ modo: "humano", idUltimoDelCliente: "m1", idQueRespondo: "m1" }),
    false,
  );
});

test("sin fila de estado, el chat se considera del bot", () => {
  // Es el default del producto (lib/estadoChat.ts): un chat nuevo no tiene
  // fila y Tino atiende. Si acá se leyera como "no bot", Tino no contestaría
  // nunca el primer mensaje de nadie.
  for (const modo of [null, undefined, "bot"]) {
    assert.equal(conservaElTurno({ modo, idUltimoDelCliente: "m1", idQueRespondo: "m1" }), true);
  }
});

test("sin ids que comparar NO se bloquea: el modo ya es la protección real", () => {
  // Bloquear ante la duda sonaría más seguro, pero dejaría a Tino mudo en un
  // canal que no entrega ids, que es peor y más difícil de diagnosticar.
  assert.equal(conservaElTurno({ modo: "bot", idUltimoDelCliente: null, idQueRespondo: "m1" }), true);
  assert.equal(conservaElTurno({ modo: "bot", idUltimoDelCliente: "m1", idQueRespondo: null }), true);
  assert.equal(conservaElTurno({ modo: "bot" }), true);
  // Pero el modo sigue mandando incluso sin ids.
  assert.equal(conservaElTurno({ modo: "humano" }), false);
});

test("los tres transportes comparten la misma regla, no una copia", async () => {
  /**
   * Esta prueba no mira comportamiento: mira que el código no se vuelva a
   * duplicar. La divergencia entre las tres copias fue la causa del bug, no
   * un síntoma, así que vale la pena fijarla.
   */
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/inboundMeta.ts", "lib/inboundWaha.ts", "lib/inboundInstagram.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /conservaElTurno\(/, `${f} debe usar la regla compartida`);
    assert.match(src, /modo: await modoDe\(/, `${f} debe re-leer el modo`);
  }
});
