/**
 * DISPONIBILIDAD: un mapeo viejo servicio(A) → profesional(B) no puede usar
 * las horas de B en la página pública de A (Fase 0, multi-tenant).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { disponibilidad } from "../lib/agenda.ts";

test("se ignoran profesionales de otro negocio aunque estén mapeados al servicio", async () => {
  const supa = crearBaseMemoria({
    ed_servicios: [{ id: "s1", cliente_id: "A", nombre: "Corte", duracion_min: 30, activo: true, buffer_min: 0 }],
    ed_clientes: [{ id: "A", anticipacion_min_horas: 0, horizonte_dias: 3 }],
    ed_servicio_profesional: [
      { servicio_id: "s1", profesional_id: "pA" },
      { servicio_id: "s1", profesional_id: "pB" }, // mapeo cruzado heredado
    ],
    ed_profesionales: [
      { id: "pA", cliente_id: "A", activo: true },
      { id: "pB", cliente_id: "B", activo: true },
    ],
    ed_horarios: [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      { profesional_id: "pA", dia_semana: d, desde: "10:00:00", hasta: "11:00:00" },
      { profesional_id: "pB", dia_semana: d, desde: "15:00:00", hasta: "16:00:00" },
    ]),
    ed_bloqueos: [],
    ed_citas: [],
  });
  const r = await disponibilidad("A", "s1", { supa, ahora: new Date("2026-09-11T12:00:00Z") });
  assert.equal(r.ok, true);
  assert.ok(r.slots.length > 0);
  assert.ok(r.slots.every((s) => s.profesionalId === "pA"), "ningún cupo del profesional del otro negocio");
  const horarios = supa.llamadas.find((l) => l.tabla === "ed_horarios");
  assert.deepEqual(horarios.filtros.find((f) => f[0] === "in")[2], ["pA"]);
});
