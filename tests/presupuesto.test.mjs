import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FUNCION_MS,
  RESERVA_RESPUESTA_MS,
  fechaLimiteModelo,
  restanteMs,
} from "../lib/presupuesto.ts";
import { generarJSON } from "../lib/gemini.ts";

test("la fecha límite deja reservado el tiempo de la red de seguridad", () => {
  const inicio = Date.now();
  const limite = fechaLimiteModelo(inicio);
  const consumido = limite - inicio;

  // El modelo nunca puede usar el presupuesto completo de la función.
  assert.ok(consumido < MAX_FUNCION_MS, "la fecha límite no puede llegar al techo de la función");
  // Y lo que queda después del límite alcanza para responder y derivar.
  assert.ok(
    MAX_FUNCION_MS - consumido >= RESERVA_RESPUESTA_MS,
    "debe quedar al menos la reserva completa para avisar al cliente",
  );
});

test("restanteMs nunca devuelve negativo", () => {
  assert.equal(restanteMs(Date.now() - 10_000), 0);
  assert.ok(restanteMs(Date.now() + 5_000) > 0);
});

test("sin tiempo de función, el modelo falla rápido en vez de colgar la invocación", async () => {
  const fetchOriginal = globalThis.fetch;
  const claveOriginal = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "clave-de-prueba";

  // Simula a Gemini colgado: nunca resuelve salvo que aborten la petición.
  let llamadas = 0;
  globalThis.fetch = (_url, opciones) =>
    new Promise((_resolve, reject) => {
      llamadas += 1;
      opciones?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
    });

  try {
    const t0 = Date.now();
    await assert.rejects(
      // Fecha límite ya vencida: no queda tiempo útil.
      () => generarJSON("prompt de prueba", { fechaLimite: Date.now() - 1 }),
      /sin tiempo/i,
    );
    const transcurrido = Date.now() - t0;

    assert.equal(llamadas, 0, "no debe intentar llamar al modelo sin presupuesto");
    assert.ok(transcurrido < 1_000, `debe fallar de inmediato, tardó ${transcurrido}ms`);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (claveOriginal === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = claveOriginal;
  }
});

test("con poco tiempo, el modelo recorta su propio timeout y no se pasa del presupuesto", async () => {
  const fetchOriginal = globalThis.fetch;
  const claveOriginal = process.env.GEMINI_API_KEY;
  const modeloOriginal = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "clave-de-prueba";
  // Un solo modelo: aísla la prueba del recorrido al modelo de respaldo.
  process.env.GEMINI_MODEL = "gemini-2.5-flash";

  globalThis.fetch = (_url, opciones) =>
    new Promise((_resolve, reject) => {
      opciones?.signal?.addEventListener("abort", () => reject(new Error("abortado")));
    });

  try {
    const presupuesto = 4_000;
    const t0 = Date.now();
    await assert.rejects(() =>
      generarJSON("prompt de prueba", { fechaLimite: Date.now() + presupuesto }),
    );
    const transcurrido = Date.now() - t0;

    // Sin el tope, el timeout por defecto (20 s) × 2 intentos habría tardado
    // más de 40 s y matado la función antes de la red de seguridad.
    assert.ok(
      transcurrido < presupuesto + 2_500,
      `no debe exceder el presupuesto (+margen); tardó ${transcurrido}ms`,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    if (claveOriginal === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = claveOriginal;
    if (modeloOriginal === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = modeloOriginal;
  }
});
