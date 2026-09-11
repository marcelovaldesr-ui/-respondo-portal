/**
 * MÉTRICAS CANÓNICAS (Fase 0, 11-sep-2026): el mismo concepto, el mismo número.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { contarEsperando, contarConversacionesActivas, leerTodo, leerTodoParalelo, unaPorChat } from "../lib/metricas.ts";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { crearSupaFalso } from "./_supaFalso.mjs";

test("esperando: usa el RPC de la bandeja (conversaciones) cuando existe", async () => {
  const supa = crearSupaFalso((ll) => (ll.op === "rpc" ? { data: { espera: 52 } } : { data: [] }));
  assert.equal(await contarEsperando("c1", ["e1"], supa), 52);
});

test("esperando sin la migración: cuenta CHATS distintos, no filas (antes 53 vs 52)", async () => {
  const supa = crearBaseMemoria({
    ed_escalaciones: [
      { empleado_id: "e1", chat_id: "a", atendida_en: null, creado_en: "2026-09-01T00:00:00Z" },
      { empleado_id: "e1", chat_id: "a", atendida_en: null, creado_en: "2026-09-02T00:00:00Z" },
      { empleado_id: "e2", chat_id: "b", atendida_en: null, creado_en: "2026-09-02T00:00:00Z" },
      { empleado_id: "e1", chat_id: "c", atendida_en: "2026-09-03T00:00:00Z", creado_en: "2026-09-02T00:00:00Z" },
      { empleado_id: "otro", chat_id: "z", atendida_en: null, creado_en: "2026-09-02T00:00:00Z" },
    ],
  });
  assert.equal(await contarEsperando("c1", ["e1", "e2"], supa), 2);
  assert.equal(await contarEsperando("c1", [], supa), 0);
});

test("conversaciones activas: contactos del negocio con mensaje desde la fecha; error → null", async () => {
  const supa = crearBaseMemoria({
    ed_contactos: [
      { cliente_id: "c1", chat_id: "a", ultimo_mensaje_en: "2026-09-10T00:00:00Z" },
      { cliente_id: "c1", chat_id: "b", ultimo_mensaje_en: "2026-08-10T00:00:00Z" },
      { cliente_id: "c2", chat_id: "a", ultimo_mensaje_en: "2026-09-10T00:00:00Z" },
    ],
  });
  assert.equal(await contarConversacionesActivas("c1", "2026-09-01T04:00:00Z", supa), 1);
  const rota = crearSupaFalso(() => ({ count: null, error: { message: "x" } }));
  assert.equal(await contarConversacionesActivas("c1", "2026-09-01", rota), null, "un error no se muestra como 0");
});

test("leerTodo pagina más allá de las 1.000 filas y avisa si quedó incompleto", async () => {
  const total = 2345;
  const armar = async (a, z) => ({ data: Array.from({ length: Math.max(0, Math.min(z, total - 1) - a + 1) }, (_, i) => a + i), error: null });
  const r = await leerTodo(armar);
  assert.equal(r.filas.length, total);
  assert.equal(r.completo, true);
  const conError = await leerTodo(async (a) => (a === 0 ? { data: Array(1000).fill(0), error: null } : { data: null, error: { message: "x" } }));
  assert.equal(conError.completo, false);
});

test("unaPorChat conserva la primera (la más antigua con orden ascendente)", () => {
  assert.deepEqual(unaPorChat([{ chat_id: "a", n: 1 }, { chat_id: "b", n: 2 }, { chat_id: "a", n: 3 }]).map((x) => x.n), [1, 2]);
});

test("leerTodoParalelo trae todo en tandas y cae a serie si el conteo falla", async () => {
  const total = 3456;
  const armar = async (a, z) => ({ data: Array.from({ length: Math.max(0, Math.min(z, total - 1) - a + 1) }, (_, i) => a + i), error: null });
  const r = await leerTodoParalelo(async () => ({ count: total, error: null }), armar, { concurrencia: 3 });
  assert.equal(r.filas.length, total);
  assert.deepEqual(r.filas.slice(998, 1002), [998, 999, 1000, 1001]);
  const serie = await leerTodoParalelo(async () => ({ count: null, error: { message: "x" } }), armar);
  assert.equal(serie.filas.length, total);
  const topado = await leerTodoParalelo(async () => ({ count: 5000, error: null }), armar, { tope: 2000 });
  assert.equal(topado.completo, false);
});
