import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAS_MAX,
  DIAS_MIN,
  DIAS_SIN_REPETIR,
  cuposDisponibles,
  decidirCotizacion,
} from "../lib/generadorCotizacionCore.ts";

/**
 * Estas reglas deciden a QUIÉN se le manda una plantilla de MARKETING (~$85 cada
 * una) sin que nadie mire. Equivocarse acá tiene dos costos:
 *
 *  - de más: se le insiste a un cliente que ya compró, o que acaba de escribir,
 *    y el negocio queda como si no leyera. Y encima se paga.
 *  - de menos: 134 cotizaciones se enfrían solas, que es lo que pasa hoy.
 */

const AHORA = new Date("2026-08-26T12:00:00.000Z").getTime();
const haceDias = (d) => new Date(AHORA - d * 86_400_000).toISOString();

const BASE = {
  chatId: "56900000000",
  etiquetas: ["cotizacion"],
  etapa: "cotizado",
  ultimoMensajeEn: haceDias(7),
  ultimoRol: "empleado",
  ultimoSeguimientoEn: null,
};

test("el caso normal: se cotizó, pasaron 7 días y no contestó", () => {
  const v = decidirCotizacion(BASE, AHORA);
  assert.equal(v.enviar, true);
  assert.equal(v.diasEsperando, 7);
});

// ── Lo que protege al cliente ───────────────────────────────────────────────

test("⭐⭐ NUNCA se le escribe a quien está marcado no_contactar", () => {
  // Va antes que todo lo demás: ninguna otra regla puede pasarle por encima.
  const v = decidirCotizacion({ ...BASE, etiquetas: ["cotizacion", "no_contactar"] }, AHORA);
  assert.equal(v.enviar, false);
});

test("⭐⭐ si el CLIENTE habló último, no se le escribe", () => {
  // O está esperando respuesta —y ahí el problema es otro— o ya respondió la
  // cotización. En los dos casos «¿sigue en pie?» deja al negocio como si no
  // leyera lo que le escriben.
  const v = decidirCotizacion({ ...BASE, ultimoRol: "cliente" }, AHORA);
  assert.equal(v.enviar, false);
});

test("no se persigue a quien ya compró ni a quien dijo que no", () => {
  for (const etapa of ["ganado", "perdido"]) {
    assert.equal(decidirCotizacion({ ...BASE, etapa }, AHORA).enviar, false, etapa);
  }
});

test("no se insiste dos veces por la misma cotización", () => {
  const v = decidirCotizacion(
    { ...BASE, ultimoSeguimientoEn: haceDias(DIAS_SIN_REPETIR - 1) },
    AHORA,
  );
  assert.equal(v.enviar, false);
});

test("pasados los días sin repetir, se puede volver a intentar", () => {
  const v = decidirCotizacion(
    { ...BASE, ultimoSeguimientoEn: haceDias(DIAS_SIN_REPETIR + 1) },
    AHORA,
  );
  assert.equal(v.enviar, true);
});

// ── La ventana de tiempo ────────────────────────────────────────────────────

test("demasiado pronto: todavía lo está pensando", () => {
  for (const d of [0, 1, DIAS_MIN - 1]) {
    assert.equal(decidirCotizacion({ ...BASE, ultimoMensajeEn: haceDias(d) }, AHORA).enviar, false, `${d}d`);
  }
});

test("demasiado tarde: ya es reactivación fría, no seguimiento", () => {
  // Después de un mes el mensaje correcto es otro, y otra la conversación.
  const v = decidirCotizacion({ ...BASE, ultimoMensajeEn: haceDias(DIAS_MAX + 1) }, AHORA);
  assert.equal(v.enviar, false);
});

test("los bordes de la ventana entran", () => {
  assert.equal(decidirCotizacion({ ...BASE, ultimoMensajeEn: haceDias(DIAS_MIN) }, AHORA).enviar, true);
  assert.equal(decidirCotizacion({ ...BASE, ultimoMensajeEn: haceDias(DIAS_MAX) }, AHORA).enviar, true);
});

// ── Que de verdad haya una cotización ───────────────────────────────────────

test("sin etiqueta ni etapa de cotización, no aplica", () => {
  const v = decidirCotizacion({ ...BASE, etiquetas: [], etapa: "nuevo" }, AHORA);
  assert.equal(v.enviar, false);
});

test("basta con la etiqueta O con la etapa", () => {
  assert.equal(decidirCotizacion({ ...BASE, etapa: "interesado" }, AHORA).enviar, true);
  assert.equal(decidirCotizacion({ ...BASE, etiquetas: [] }, AHORA).enviar, true);
});

test("una fecha corrupta no dispara un envío", () => {
  // Ante la duda, NO se manda: un envío de más cuesta plata y molesta.
  for (const f of [null, "", "no-es-fecha"]) {
    assert.equal(decidirCotizacion({ ...BASE, ultimoMensajeEn: f }, AHORA).enviar, false, `${f}`);
  }
});

// ── El tope de gasto ────────────────────────────────────────────────────────

test("⭐⭐ el tope diario manda sobre la cantidad de candidatos", () => {
  // 134 cotizaciones abiertas × $85 son ~$11.000 de una, decididos por un cron
  // a las tres de la mañana. El tope es lo que lo convierte en una decisión.
  assert.equal(cuposDisponibles({ topeDiario: 10, enviadosHoy: 0, candidatos: 134 }), 10);
});

test("lo ya enviado hoy descuenta del tope", () => {
  assert.equal(cuposDisponibles({ topeDiario: 10, enviadosHoy: 7, candidatos: 134 }), 3);
});

test("con el tope agotado no sale ninguno", () => {
  assert.equal(cuposDisponibles({ topeDiario: 10, enviadosHoy: 10, candidatos: 50 }), 0);
  assert.equal(cuposDisponibles({ topeDiario: 10, enviadosHoy: 99, candidatos: 50 }), 0);
});

test("tope en cero = apagado", () => {
  assert.equal(cuposDisponibles({ topeDiario: 0, enviadosHoy: 0, candidatos: 134 }), 0);
});

test("si hay menos candidatos que cupo, manda la cantidad real", () => {
  assert.equal(cuposDisponibles({ topeDiario: 10, enviadosHoy: 0, candidatos: 3 }), 3);
});
