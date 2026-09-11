/** Decisiones puras de la cola de seguimientos (Fase 0). */
import assert from "node:assert/strict";
import test from "node:test";
import { vigenciaDeCita, manana10Chile, decidirPospuesto } from "../lib/seguimientosCore.ts";

const AHORA = new Date("2026-09-11T15:00:00Z");
const en = (h) => new Date(AHORA.getTime() + h * 3600_000).toISOString();

test("confirmación: vigente con más de 12 h; tardía o de cita cancelada se descarta", () => {
  assert.equal(vigenciaDeCita("confirmacion_cita", { estado: "agendada", inicio: en(20), fin: en(21) }, AHORA).vigente, true);
  assert.equal(vigenciaDeCita("confirmacion_cita", { estado: "agendada", inicio: en(5), fin: en(6) }, AHORA).vigente, false);
  assert.equal(vigenciaDeCita("confirmacion_cita", { estado: "cancelada", inicio: en(30), fin: en(31) }, AHORA).vigente, false);
});

test("recordatorio: no sale si la cita empieza en menos de 15 min o está cerrada", () => {
  assert.equal(vigenciaDeCita("recordatorio_cita", { estado: "confirmada", inicio: en(1), fin: en(2) }, AHORA).vigente, true);
  assert.equal(vigenciaDeCita("recordatorio_cita", { estado: "confirmada", inicio: en(0.1), fin: en(1) }, AHORA).vigente, false);
  assert.equal(vigenciaDeCita("recordatorio_cita", { estado: "no_show", inicio: en(2), fin: en(3) }, AHORA).vigente, false);
  assert.equal(vigenciaDeCita("recordatorio_cita", null, AHORA).vigente, false);
});

test("encuesta: sale tras una cita atendida; no tras cancelación ni 20 h después", () => {
  assert.equal(vigenciaDeCita("encuesta_postventa", { estado: "completada", inicio: en(-4), fin: en(-3) }, AHORA).vigente, true);
  assert.equal(vigenciaDeCita("encuesta_postventa", { estado: "cancelada", inicio: en(-4), fin: en(-3) }, AHORA).vigente, false);
  assert.equal(vigenciaDeCita("encuesta_postventa", { estado: "agendada", inicio: en(-30), fin: en(-29) }, AHORA).vigente, false);
});

test("tipos que no son de cita no se tocan", () => {
  assert.equal(vigenciaDeCita("mantencion_toca", null, AHORA).vigente, true);
});

test("mañana 10:00 respeta el horario de Chile en invierno y en verano", () => {
  assert.equal(manana10Chile(new Date("2026-09-11T15:00:00Z")).toISOString(), "2026-09-12T13:00:00.000Z");
  assert.equal(manana10Chile(new Date("2026-07-01T15:00:00Z")).toISOString(), "2026-07-02T14:00:00.000Z");
  // Tarde en la noche de Chile (ya es otro día en UTC): sigue siendo "mañana" chileno.
  assert.equal(manana10Chile(new Date("2026-09-12T02:30:00Z")).toISOString(), "2026-09-12T13:00:00.000Z");
});

test("pospuesto: reintenta en 2 h conservando desde cuándo espera; a los 7 días se cierra", () => {
  const d1 = decidirPospuesto({ texto: "x" }, AHORA);
  assert.equal(d1.accion, "reprogramar");
  assert.equal(d1.pospuestoDesde, AHORA.toISOString());
  const d2 = decidirPospuesto({ pospuesto_desde: "2026-09-09T15:00:00.000Z" }, AHORA);
  assert.equal(d2.accion, "reprogramar");
  assert.equal(d2.pospuestoDesde, "2026-09-09T15:00:00.000Z");
  assert.equal(decidirPospuesto({ pospuesto_desde: "2026-09-01T15:00:00.000Z" }, AHORA).accion, "descartar");
});
