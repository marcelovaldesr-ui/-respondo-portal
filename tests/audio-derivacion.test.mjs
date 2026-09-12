import assert from "node:assert/strict";
import test from "node:test";

import { MARCADOR_AUDIO, esAudioDelCliente, esAudioSinTexto } from "../lib/marcadorAudio.ts";

/**
 * EL FALLBACK DE AUDIO — la protección que no puede fallar.
 *
 * Cuando llega una nota de voz que Tino no puede escuchar, responderBot pasa
 * el chat a modo humano, registra la escalación y avisa al dueño. Ese camino
 * es bueno y es el que queda si la transcripción nunca se enciende.
 *
 * Todo depende de una sola pregunta: «¿esto es un audio?». Si esa pregunta se
 * contesta mal, Tino le responde a un cliente sobre algo que no oyó — y no hay
 * ningún otro control aguas abajo que lo detenga. Por eso se prueba sola.
 */

test("⭐ un audio se detecta por el TIPO del archivo, no por la forma del texto", () => {
  // El caso que abrió el riesgo: en la Fase 3 el pie de foto dejó de borrar el
  // marcador del adjunto. Si mañana un canal entrega texto junto a un audio,
  // el texto guardado deja de ser exactamente el marcador.
  assert.equal(esAudioSinTexto(`${MARCADOR_AUDIO} hola`), false, "la comparación exacta falla, y está bien que falle");
  assert.equal(
    esAudioDelCliente({ mediaTipo: "audio", texto: `${MARCADOR_AUDIO} hola` }),
    true,
    "pero el tipo del archivo sigue diciendo la verdad",
  );
});

test("los mensajes viejos, sin media_tipo, se siguen detectando por el marcador", () => {
  // Instagram recién empezó a informar media_tipo en la Fase 3: las notas de
  // voz anteriores están guardadas con media_tipo nulo.
  assert.equal(esAudioDelCliente({ mediaTipo: null, texto: MARCADOR_AUDIO }), true);
  assert.equal(esAudioDelCliente({ texto: MARCADOR_AUDIO }), true);
});

test("un mensaje normal NO se confunde con un audio", () => {
  // El costo de un falso positivo también es alto: derivaría a una persona una
  // conversación de texto que Tino podía atender solo.
  for (const m of [
    { mediaTipo: "imagen", texto: "[el cliente envió una imagen] ¿pueden hacer esto?" },
    { mediaTipo: null, texto: "hola, quiero cotizar" },
    { mediaTipo: "documento", texto: "[el cliente envió un archivo (arte.pdf)]" },
    { mediaTipo: null, texto: "me mandaron un audio por otro lado" },
    { mediaTipo: null, texto: "" },
    {},
  ]) {
    assert.equal(esAudioDelCliente(m), false, JSON.stringify(m));
  }
});

test("responderBot usa el predicado compartido y no una copia del marcador", async () => {
  // La regla vale lo que valga su único punto de uso. Si alguien vuelve a
  // comparar el texto a mano en responderBot, esta prueba lo dice.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/responderBot.ts", import.meta.url), "utf8");
  assert.match(src, /esAudioDelCliente\(ultimo\)/);
  assert.doesNotMatch(src, /esAudioSinTexto/, "responderBot ya no compara el texto por su cuenta");
});
