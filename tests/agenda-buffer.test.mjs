import assert from "node:assert/strict";
import test from "node:test";

import { computarSlots, horaChileAUtc } from "../lib/agendaCore.ts";

/**
 * Tiempo de preparación entre horas (migración 277).
 *
 * Escenario base: un profesional que atiende un lunes de 10:00 a 13:00, con un
 * servicio de 60 min. Sin nada tomado hay cupos a las 10, 11 y 12.
 */

const PROF = "prof-1";

/** Lunes 17 de agosto de 2026, hora de Chile. */
function lunes(hh, mm = 0) {
  return horaChileAUtc(2026, 8, 17, hh, mm).toISOString();
}

function base(extra = {}) {
  return {
    // "Ahora" muy anterior y sin anticipación: aísla la prueba del reloj real.
    ahora: new Date(horaChileAUtc(2026, 8, 10, 9, 0).getTime()),
    dias: 10,
    ventanas: [{ profesionalId: PROF, diaSemana: 1, desde: "10:00", hasta: "13:00" }],
    ocupados: [],
    duracionMin: 60,
    anticipacionMin: 0,
    maxSlots: 50,
    ...extra,
  };
}

/** Horas de inicio del lunes 17, como "HH:MM" de Chile. */
function horasDelLunes(slots) {
  return slots
    .filter((s) => s.inicio.startsWith("2026-08-17"))
    .map((s) =>
      new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(s.inicio)),
    );
}

test("sin buffer, los cupos van pegados a la cita existente", () => {
  const slots = computarSlots(
    base({
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11), tipo: "cita" }],
    }),
  );
  const horas = horasDelLunes(slots);
  assert.deepEqual(horas, ["11:00", "12:00"]);
});

test("con buffer de 15 min, el cupo pegado a la cita deja de ofrecerse", () => {
  const slots = computarSlots(
    base({
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11), tipo: "cita" }],
      bufferMin: 15,
    }),
  );
  const horas = horasDelLunes(slots);
  // 11:00 chocaría con la limpieza (11:00-11:15); 12:00 sigue libre.
  assert.deepEqual(horas, ["12:00"]);
});

test("el buffer NO se aplica a los bloqueos: tras el almuerzo se atiende a la hora exacta", () => {
  const slots = computarSlots(
    base({
      // Bloqueo de 10:00 a 11:00 (ej. almuerzo o feriado parcial).
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11), tipo: "bloqueo" }],
      bufferMin: 15,
    }),
  );
  const horas = horasDelLunes(slots);
  // Sin buffer sobre bloqueos, 11:00 sigue disponible.
  assert.deepEqual(horas, ["11:00", "12:00"]);
});

test("el buffer protege también hacia atrás (no dejar una hora que invada la preparación)", () => {
  const slots = computarSlots(
    base({
      // Cita de 12:00 a 13:00: un cupo 11:00-12:00 dejaría 0 min de preparación.
      ocupados: [{ profesionalId: PROF, desde: lunes(12), hasta: lunes(13), tipo: "cita" }],
      bufferMin: 15,
    }),
  );
  const horas = horasDelLunes(slots);
  assert.deepEqual(horas, ["10:00"]);
});

test("buffer 0 se comporta exactamente como antes (sin regresión)", () => {
  const conCero = computarSlots(
    base({
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11), tipo: "cita" }],
      bufferMin: 0,
    }),
  );
  const sinParametro = computarSlots(
    base({
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11), tipo: "cita" }],
    }),
  );
  assert.deepEqual(horasDelLunes(conCero), horasDelLunes(sinParametro));
});

test("un ocupado sin `tipo` se trata como cita (conservador)", () => {
  const slots = computarSlots(
    base({
      ocupados: [{ profesionalId: PROF, desde: lunes(10), hasta: lunes(11) }],
      bufferMin: 15,
    }),
  );
  assert.deepEqual(horasDelLunes(slots), ["12:00"]);
});
