import assert from "node:assert/strict";
import test from "node:test";

import { permisosDeGestion, tokenConFormato } from "../lib/autogestion.ts";

const AHORA = new Date("2026-08-17T12:00:00Z");
const TODO_PERMITIDO = { permiteCancelar: true, permiteReagendar: true, cancelacionMinHoras: 4 };

/** Cita a N horas de "ahora". */
function citaEn(horas, estado = "agendada") {
  return { estado, inicioIso: new Date(AHORA.getTime() + horas * 3_600_000).toISOString() };
}

test("con la hora lejos, se puede cancelar y reagendar", () => {
  const p = permisosDeGestion(citaEn(48), TODO_PERMITIDO, AHORA);
  assert.equal(p.cancelar.permitido, true);
  assert.equal(p.reagendar.permitido, true);
  assert.equal(p.yaPaso, false);
});

test("dentro del plazo de corte, se bloquea y se explica por qué", () => {
  const p = permisosDeGestion(citaEn(2), TODO_PERMITIDO, AHORA);
  assert.equal(p.cancelar.permitido, false);
  assert.match(p.cancelar.motivo, /4 horas antes/);
  assert.equal(p.reagendar.permitido, false);
});

test("justo en el límite todavía se permite", () => {
  const p = permisosDeGestion(citaEn(4), TODO_PERMITIDO, AHORA);
  assert.equal(p.cancelar.permitido, true);
});

test("el negocio puede permitir cancelar pero NO reagendar", () => {
  const p = permisosDeGestion(citaEn(48), {
    permiteCancelar: true,
    permiteReagendar: false,
    cancelacionMinHoras: 4,
  }, AHORA);
  assert.equal(p.cancelar.permitido, true);
  assert.equal(p.reagendar.permitido, false);
  // El motivo invita a escribir, no deja al cliente sin salida.
  assert.match(p.reagendar.motivo, /escríbenos/i);
});

test("una hora ya pasada no se puede tocar", () => {
  const p = permisosDeGestion(citaEn(-1), TODO_PERMITIDO, AHORA);
  assert.equal(p.yaPaso, true);
  assert.equal(p.cancelar.permitido, false);
  assert.match(p.cancelar.motivo, /ya pasó/i);
});

test("una hora cancelada o completada no se puede volver a gestionar", () => {
  const cancelada = permisosDeGestion(citaEn(48, "cancelada"), TODO_PERMITIDO, AHORA);
  assert.equal(cancelada.anulada, true);
  assert.match(cancelada.cancelar.motivo, /ya está cancelada/i);

  const completada = permisosDeGestion(citaEn(48, "completada"), TODO_PERMITIDO, AHORA);
  assert.equal(completada.anulada, true);
  assert.match(completada.cancelar.motivo, /ya se realizó/i);
});

test("con plazo 0, se puede hasta la hora misma", () => {
  const p = permisosDeGestion(citaEn(0.5), {
    permiteCancelar: true,
    permiteReagendar: true,
    cancelacionMinHoras: 0,
  }, AHORA);
  assert.equal(p.cancelar.permitido, true);
});

test("el plazo se redacta en días cuando corresponde", () => {
  const p = permisosDeGestion(citaEn(10), {
    permiteCancelar: true,
    permiteReagendar: true,
    cancelacionMinHoras: 48,
  }, AHORA);
  assert.match(p.cancelar.motivo, /2 días antes/);
});

test("el formato del token filtra basura antes de consultar la base", () => {
  assert.equal(tokenConFormato("a".repeat(36)), true);
  assert.equal(tokenConFormato("A".repeat(36)), false, "hex es minúscula");
  assert.equal(tokenConFormato("abc"), false);
  assert.equal(tokenConFormato(null), false);
  assert.equal(tokenConFormato("' or 1=1 --"), false);
});
