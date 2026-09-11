/**
 * Cancelar una cita solo puede borrar recordatorios del MISMO negocio
 * (auditoría 11-sep-2026). `ed_seguimientos` no tiene cliente_id: cuelga del
 * empleado, así que el borrado tiene que acotarse a los empleados del negocio.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { anularSeguimientosDeCita } from "../lib/agendaSeguimientos.ts";
import { crearSupaFalso, tieneFiltro } from "./_supaFalso.mjs";

test("el borrado se acota a los empleados del negocio indicado", async () => {
  const supa = crearSupaFalso((ll) =>
    ll.tabla === "ed_empleados" ? { data: [{ id: "tino-A" }, { id: "vera-A" }] } : { data: null },
  );
  await anularSeguimientosDeCita("cita-1", "cliente-A", supa);
  const emp = supa.llamadas.find((l) => l.tabla === "ed_empleados");
  assert.ok(tieneFiltro(emp, "eq", "cliente_id", "cliente-A"));
  const borrado = supa.llamadas.find((l) => l.tabla === "ed_seguimientos");
  assert.equal(borrado.op, "delete");
  assert.ok(tieneFiltro(borrado, "in", "empleado_id", ["tino-A", "vera-A"]));
  assert.ok(tieneFiltro(borrado, "is", "enviado_en", null), "nunca borra lo ya enviado");
  assert.ok(tieneFiltro(borrado, "contains", "variables", { cita_id: "cita-1" }));
});

test("sin negocio o sin empleados no borra nada", async () => {
  const supa = crearSupaFalso((ll) => (ll.tabla === "ed_empleados" ? { data: [] } : { data: null }));
  await anularSeguimientosDeCita("cita-1", "", supa);
  assert.equal(supa.llamadas.length, 0);
  await anularSeguimientosDeCita("cita-1", "cliente-sin-empleados", supa);
  assert.ok(!supa.llamadas.some((l) => l.tabla === "ed_seguimientos"));
});

test("si falla la lectura de empleados, no borra (falla cerrado)", async () => {
  const supa = crearSupaFalso((ll) => (ll.tabla === "ed_empleados" ? { data: null, error: { message: "x" } } : { data: null }));
  await anularSeguimientosDeCita("cita-1", "cliente-A", supa);
  assert.ok(!supa.llamadas.some((l) => l.tabla === "ed_seguimientos"));
});
