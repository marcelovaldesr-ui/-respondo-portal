/**
 * FEEDBACK VISIBLE AL CREAR BLOQUEO (cierre Antigravity, microfix 14-sep-2026).
 *
 * Antes: crearBloqueo() insertaba en ed_bloqueos, el trigger de la migración
 * 308 podía rechazarlo con ED001 (choca con una cita activa), y ese rechazo
 * solo quedaba en console.error — la pantalla se recargaba igual y el dueño
 * creía que el bloqueo había quedado creado.
 *
 * resultadoCrearBloqueo() (lib/agenda.ts) es la traducción pura del error de
 * la base al {ok, error} que ahora consume FormularioAgregar para mostrarlo
 * inline — vive en lib/agenda.ts (no en acciones.ts, que arrastra
 * sesión/Next.js/auditoría) para poder probarla directo, igual que el resto
 * de las funciones de ese archivo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resultadoCrearBloqueo } from "../lib/agenda.ts";

test("⭐ A) ED001: el dueño recibe el mensaje específico de choque con una cita", () => {
  const r = resultadoCrearBloqueo({ code: "ED001", message: "Ese rango ya tiene una cita activa; revisa antes de bloquearlo." });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /ya existe una cita agendada/);
});

test("⭐ B) un error distinto de ED001 NO muestra el mensaje de ED001 — muestra uno genérico", () => {
  for (const error of [{ code: "23505", message: "duplicate key" }, { code: undefined, message: "algo raro" }]) {
    const r = resultadoCrearBloqueo(error);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.error ?? "", /ya existe una cita agendada/, `code=${error.code}`);
    assert.ok(r.error && r.error.length > 0, `code=${error.code} debe traer igual un mensaje genérico`);
  }
});

test("⭐ C) insert exitoso: sin error, flujo normal — sin mensaje de error", () => {
  const r = resultadoCrearBloqueo(null);
  assert.deepEqual(r, { ok: true });
});

test("FormularioAgregar solo muestra el error cuando la acción devuelve ok:false — un void (crearServicio/crearProfesional) sigue limpiando el formulario como siempre", async () => {
  // Regresión de fuente, igual que el patrón de tests/mensaje-huerfano.test.mjs:
  // que el componente compartido no rompa a los otros dos formularios que ya
  // usan FormularioAgregar (crearServicio, crearProfesional) y que siguen
  // devolviendo void.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/FormularioAgregar.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(r && r\.ok === false\)/, "debe distinguir explícitamente ok:false de void/ok:true");
  assert.match(src, /ref\.current\?\.reset\(\)/, "el reset tras éxito no debe haberse perdido");
});
