/**
 * INFORME SEMANAL AUTOMÁTICO (Fase 0, 11-sep-2026).
 *
 * Reproduce la falla silenciosa: un negocio con "poca actividad" quedaba primero
 * en cada corrida y nadie más recibía su informe. Y un informe parcial generado
 * a mano a mitad de semana bloqueaba el automático del lunes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generarInformesPendientes, informeCompleto } from "../lib/insightsAuto.ts";
import { crearSupaFalso } from "./_supaFalso.mjs";

// Lunes 14-sep-2026 10:00 de Chile (UTC-3). Semana cerrada: 07-sep → 13-sep.
const LUNES = new Date("2026-09-14T13:00:00Z");

function base({ clientes, insights = [] }) {
  return crearSupaFalso((ll) => {
    if (ll.tabla === "ed_clientes") return { data: clientes };
    if (ll.tabla === "ed_insights") return { data: insights };
    return { data: null };
  });
}

test("informeCompleto: uno creado a mitad de semana NO cuenta; uno del lunes siguiente sí", () => {
  assert.equal(informeCompleto("2026-09-10T20:00:00Z", "2026-09-13"), false, "jueves: parcial");
  assert.equal(informeCompleto("2026-09-14T02:30:00Z", "2026-09-13"), false, "domingo 23:30 de Chile: parcial");
  assert.equal(informeCompleto("2026-09-14T03:05:00Z", "2026-09-13"), true, "lunes 00:05 de Chile: completo");
  assert.equal(informeCompleto(null, "2026-09-13"), false);
});

test("un negocio con poca actividad ya no tapa al siguiente (antes: nadie más recibía informe)", async () => {
  const supa = base({ clientes: [{ id: "a-demo", nombre: "Demo" }, { id: "b-impresora", nombre: "Imp" }] });
  const llamados = [];
  const generar = async (cid) => {
    llamados.push(cid);
    return cid === "a-demo" ? { ok: false, omitido: true, motivo: "Hay muy poca actividad" } : { ok: true };
  };
  const r = await generarInformesPendientes({ ahora: LUNES, supa, generar, permitir: async () => true, fechaLimite: Date.now() + 45_000 });
  assert.deepEqual(llamados, ["a-demo", "b-impresora"], "en la MISMA corrida");
  assert.equal(r.generados, 1);
  assert.equal(r.omitidos, 1);
  assert.deepEqual(r.errores, []);
  const q = supa.llamadas.find((l) => l.tabla === "ed_clientes");
  assert.ok(q.modificadores.some((m) => m[0] === "order" && m[1] === "id"), "orden determinista");
  assert.ok(supa.llamadas.some((l) => l.tabla === "ed_insights" && l.filtros.some((f) => f[0] === "eq" && f[1] === "periodo_desde" && f[2] === "2026-09-07")));
});

test("un informe parcial de la semana se rehace; uno completo no", async () => {
  const supa = base({
    clientes: [{ id: "parcial", nombre: "P" }, { id: "completo", nombre: "C" }],
    insights: [
      { cliente_id: "parcial", creado_en: "2026-09-10T20:00:00Z" },
      { cliente_id: "completo", creado_en: "2026-09-14T11:00:00Z" },
    ],
  });
  const llamados = [];
  await generarInformesPendientes({ ahora: LUNES, supa, permitir: async () => true, generar: async (cid) => { llamados.push(cid); return { ok: true }; } });
  assert.deepEqual(llamados, ["parcial"]);
});

test("un fallo del modelo queda como error del negocio, y ocupa el cupo de la corrida", async () => {
  const supa = base({ clientes: [{ id: "x", nombre: "X" }, { id: "y", nombre: "Y" }] });
  const r = await generarInformesPendientes({
    ahora: LUNES, supa, permitir: async () => true,
    generar: async () => ({ ok: false, motivo: "No se pudo generar el análisis: HTTP 503" }),
  });
  assert.equal(r.fallidos, 1);
  assert.equal(r.enEspera, 1, "el segundo espera a la próxima corrida (un informe con modelo por corrida)");
  assert.deepEqual(r.errores, [{ clienteId: "x", error: "No se pudo generar el análisis: HTTP 503" }]);
});

test("un martes igual completa la semana si el lunes no se pudo", async () => {
  const martes = new Date("2026-09-15T15:00:00Z");
  const supa = base({ clientes: [{ id: "x", nombre: "X" }] });
  const r = await generarInformesPendientes({ ahora: martes, supa, permitir: async () => true, generar: async () => ({ ok: true }) });
  assert.equal(r.generados, 1);
  assert.ok(supa.llamadas.some((l) => l.tabla === "ed_insights" && l.filtros.some((f) => f[2] === "2026-09-07")), "sigue siendo la semana 07-sep");
});

test("reintento acotado: un negocio ya intentado en la última hora no se vuelve a intentar", async () => {
  const supa = base({ clientes: [{ id: "x", nombre: "X" }] });
  let n = 0;
  const r = await generarInformesPendientes({ ahora: LUNES, supa, permitir: async () => false, generar: async () => { n++; return { ok: true }; } });
  assert.equal(n, 0);
  assert.equal(r.enEspera, 1);
});

test("sin tiempo de función no se empieza un informe", async () => {
  const supa = base({ clientes: [{ id: "x", nombre: "X" }] });
  let n = 0;
  const r = await generarInformesPendientes({ ahora: LUNES, supa, fechaLimite: Date.now() + 10_000, permitir: async () => true, generar: async () => { n++; return { ok: true }; } });
  assert.equal(n, 0);
  assert.equal(r.enEspera, 1);
});

test("error leyendo negocios se reporta, no se traga", async () => {
  const supa = crearSupaFalso(() => ({ data: null, error: { message: "timeout" } }));
  const r = await generarInformesPendientes({ ahora: LUNES, supa, permitir: async () => true, generar: async () => ({ ok: true }) });
  assert.match(r.errores[0].error, /timeout/);
});

test("cobertura: desde el martes, negocio con actividad y sin informe completo = faltante", async () => {
  const { informesFaltantes } = await import("../lib/insightsAuto.ts");
  const supa = crearSupaFalso((ll) => {
    if (ll.tabla === "ed_clientes") return { data: [{ id: "con" }, { id: "sin" }, { id: "parcial" }, { id: "quieto" }] };
    if (ll.tabla === "ed_insights") return { data: [{ cliente_id: "con", creado_en: "2026-09-14T12:00:00Z" }, { cliente_id: "parcial", creado_en: "2026-09-12T12:00:00Z" }] };
    if (ll.tabla === "ed_empleados") return { data: [{ id: "e1", cliente_id: "con" }, { id: "e2", cliente_id: "sin" }, { id: "e3", cliente_id: "parcial" }, { id: "e4", cliente_id: "quieto" }] };
    if (ll.tabla === "ed_mensajes") {
      const emp = ll.filtros.find((f) => f[0] === "in")[2][0];
      return { count: emp === "e4" ? 3 : 200 };
    }
    return { data: null };
  });
  const r = await informesFaltantes({ ahora: new Date("2026-09-15T15:00:00Z"), supa });
  assert.equal(r.evaluado, true);
  assert.deepEqual(r.faltantes, ["sin", "parcial"]);
  const lunes = await informesFaltantes({ ahora: LUNES, supa });
  assert.equal(lunes.evaluado, false, "el lunes es el día de generarlos");
});
