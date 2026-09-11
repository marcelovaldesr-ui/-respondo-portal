/**
 * OBSERVABILIDAD DE LOS PROCESOS DEL CRON (Fase 0, 11-sep-2026).
 *
 * Un paso que falla deja rastro (cuándo, qué negocio, qué error), un día sin
 * trabajo no "sana" un fallo anterior, y los errores guardados no llevan
 * tokens ni teléfonos.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fusionarDetalle, evaluarProceso, limpiarError, FALLOS_PARA_ALERTA } from "../lib/procesosCore.ts";
import { registrarProcesos, leerProcesos, correrPaso } from "../lib/procesos.ts";
import { crearSupaFalso } from "./_supaFalso.mjs";

const T0 = new Date("2026-09-14T13:00:00Z");
const mas = (min) => new Date(T0.getTime() + min * 60_000);

test("fallo → éxito resetea; sin trabajo no borra un fallo previo", () => {
  let d = fusionarDetalle(null, { nombre: "informe_semanal", ok: true, errores: [{ clienteId: "c1", error: "modelo caído" }] }, T0);
  assert.equal(d.ultimo_estado, "fallo");
  assert.equal(d.fallos_seguidos, 1);
  assert.equal(d.errores[0].clienteId, "c1");
  assert.equal(d.ultimo_fallo_en, T0.toISOString());

  d = fusionarDetalle(d, { nombre: "informe_semanal", ok: true, trabajo: false }, mas(5));
  assert.equal(d.ultimo_estado, "fallo", "el martes 'no es lunes' no sana el fallo del lunes");
  assert.equal(d.fallos_seguidos, 1);

  d = fusionarDetalle(d, { nombre: "informe_semanal", ok: true, resumen: { generados: 2 } }, mas(10));
  assert.equal(d.ultimo_estado, "ok");
  assert.equal(d.fallos_seguidos, 0);
  assert.equal(d.ultimo_exito_en, mas(10).toISOString());
  assert.equal(d.ultimo_fallo_en, T0.toISOString(), "se conserva cuándo fue el último fallo");
  assert.equal(d.errores.length, 1, "se conserva el historial corto de errores");
});

test("evaluar: 'fallando' solo con fallos seguidos suficientes", () => {
  let d = null;
  for (let i = 0; i < FALLOS_PARA_ALERTA - 1; i++) d = fusionarDetalle(d, { nombre: "p", ok: false }, mas(i));
  assert.equal(evaluarProceso("p", d, mas(0).toISOString()).estado, "con_errores");
  d = fusionarDetalle(d, { nombre: "p", ok: false, errores: [{ error: "x" }] }, mas(9));
  const ev = evaluarProceso("p", d, mas(9).toISOString());
  assert.equal(ev.estado, "fallando");
  assert.match(ev.texto, /x/);
  assert.equal(evaluarProceso("p", null, null).estado, "sin_datos");
});

test("evaluar: errores frecuentes aunque no seguidos también alertan (y los viejos no)", () => {
  let d = null;
  for (let i = 0; i < 5; i++) {
    d = fusionarDetalle(d, { nombre: "seguimientos", ok: true, errores: [{ clienteId: "c1", error: "HTTP 401" }] }, mas(i * 30));
    d = fusionarDetalle(d, { nombre: "seguimientos", ok: true }, mas(i * 30 + 5));
  }
  assert.equal(d.fallos_seguidos, 0);
  assert.equal(evaluarProceso("seguimientos", d, mas(125).toISOString(), mas(125)).estado, "fallando");
  assert.equal(evaluarProceso("seguimientos", d, mas(125).toISOString(), mas(60 * 24)).estado, "ok", "un día después ya no");
});

test("detalle corrupto o viejo en la base no rompe", () => {
  const d = fusionarDetalle({ fallos_seguidos: "nope", errores: "x" }, { nombre: "p", ok: true }, T0);
  assert.equal(d.fallos_seguidos, 0);
  assert.deepEqual(d.errores, []);
});

test("limpiarError quita tokens, teléfonos y correos, y acorta", () => {
  const s = limpiarError(
    "GET https://graph.instagram.com/refresh?access_token=IGQWRabcdefghijklmnopqrstuvwxyz123 falló para +56 9 1234 5678 y dueno@negocio.cl Bearer abc.def " + "z".repeat(400),
  );
  assert.ok(!s.includes("IGQWR"));
  assert.ok(!s.includes("1234 5678"));
  assert.ok(!s.includes("dueno@negocio.cl"));
  assert.ok(!s.includes("abc.def"));
  assert.ok(s.length <= 240);
  assert.equal(limpiarError(new Error("fecha 2026-09-14 inválida")), "fecha 2026-09-14 inválida", "las fechas no se enmascaran");
});

test("registrarProcesos: una lectura + un upsert, acumula corridas y nunca lanza", async () => {
  const supa = crearSupaFalso((ll) => {
    if (ll.op === "select") return { data: [{ clave: "proceso:seguimientos", corridas: 7, detalle: { fallos_seguidos: 2, ultimo_estado: "fallo" } }] };
    return { data: null };
  });
  await registrarProcesos(
    [
      { nombre: "seguimientos", ok: false, errores: [{ clienteId: "c9", error: "HTTP 500" }] },
      { nombre: "tokens_instagram", ok: true },
    ],
    { supa, ahora: T0 },
  );
  assert.equal(supa.llamadas.length, 2);
  const up = supa.llamadas[1];
  assert.equal(up.op, "upsert");
  assert.deepEqual(up.opciones, { onConflict: "clave" });
  const seg = up.payload.find((f) => f.clave === "proceso:seguimientos");
  assert.equal(seg.corridas, 8);
  assert.equal(seg.detalle.fallos_seguidos, 3);
  assert.equal(up.payload.find((f) => f.clave === "proceso:tokens_instagram").corridas, 1);

  const rota = { from: () => { throw new Error("sin base"); } };
  await registrarProcesos([{ nombre: "x", ok: true }], { supa: rota });
});

test("registrarProcesos no escribe si la tabla no existe (migración 260 pendiente)", async () => {
  const supa = crearSupaFalso(() => ({ data: null, error: { message: "relation does not exist" } }));
  await registrarProcesos([{ nombre: "x", ok: true }], { supa });
  assert.equal(supa.llamadas.filter((l) => l.op === "upsert").length, 0);
});

test("correrPaso atrapa la excepción, la registra como fallo y deja seguir", async () => {
  const registro = [];
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await correrPaso("cierres", async () => { throw new Error("timeout de Gemini"); }, () => ({ ok: true }), registro);
    assert.equal(r, undefined);
    await correrPaso("adjuntos", async () => ({ n: 3 }), (x) => ({ ok: true, resumen: { n: x.n } }), registro);
  } finally {
    console.error = orig;
  }
  assert.equal(registro[0].ok, false);
  assert.match(registro[0].errores[0].error, /timeout/);
  assert.deepEqual(registro[1].resumen, { n: 3 });
  assert.ok(Number.isFinite(registro[1].duracionMs));
});

test("leerProcesos evalúa cada fila y tolera error de lectura", async () => {
  const supa = crearSupaFalso(() => ({
    data: [{ clave: "proceso:informe_semanal", ultimo_en: T0.toISOString(), detalle: { fallos_seguidos: 4, ultimo_error: "sin modelo", ultimo_estado: "fallo" } }],
  }));
  const ps = await leerProcesos(supa);
  assert.equal(ps[0].nombre, "informe_semanal");
  assert.equal(ps[0].estado, "fallando");
  const mala = crearSupaFalso(() => ({ data: null, error: { message: "x" } }));
  assert.equal(await leerProcesos(mala), null);
});
