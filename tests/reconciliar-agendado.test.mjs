/**
 * «AGENDADO» NO SE BORRA EN MASA POR UNA LECTURA FALLIDA (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { reconciliarEstados } from "../lib/reconciliarEstados.ts";

const futuro = new Date(Date.now() + 86_400_000).toISOString();

function base() {
  return crearBaseMemoria({
    ed_citas: [
      { cliente_id: "A", chat_id: "1", estado: "agendada", fin: futuro },
      { cliente_id: "B", chat_id: "2", estado: "agendada", fin: futuro },
    ],
    ed_contactos: [
      { cliente_id: "A", chat_id: "1", etiquetas: ["agendado"], etapa: "ganado" },
      { cliente_id: "B", chat_id: "2", etiquetas: ["agendado"], etapa: "ganado" },
      { cliente_id: "A", chat_id: "9", etiquetas: ["agendado"], etapa: "ganado" }, // su cita ya pasó
    ],
    ed_escalaciones: [],
    ed_empleados: [],
    ed_integraciones_salida: [],
  });
}

test("con lectura de citas normal: solo pierde la etiqueta quien de verdad no tiene cita", async () => {
  const supa = base();
  const orig = console.error; console.error = () => {};
  try { await reconciliarEstados(supa, { fechaLimite: Date.now() + 30_000 }); } finally { console.error = orig; }
  const [a1, b2, a9] = supa.tablas.ed_contactos;
  assert.deepEqual(a1.etiquetas, ["agendado"]);
  assert.deepEqual(b2.etiquetas, ["agendado"]);
  assert.deepEqual(a9.etiquetas, []);
});

test("si la lectura de citas FALLA, no se toca ninguna etiqueta y queda el error", async () => {
  const supa = base();
  const from = supa.from;
  supa.from = (t) => {
    const b = from(t);
    if (t === "ed_citas") b.then = (res) => Promise.resolve({ data: null, error: { message: "timeout" } }).then(res);
    return b;
  };
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await reconciliarEstados(supa, { fechaLimite: Date.now() + 30_000 }); } finally { console.error = orig; }
  assert.ok(supa.tablas.ed_contactos.every((c) => c.etiquetas.includes("agendado")), "antes: se borraba en todos los negocios");
  assert.ok((r.errores ?? []).some((e) => /citas activas/.test(e)));
});
