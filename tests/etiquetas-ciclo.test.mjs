import assert from "node:assert/strict";
import test from "node:test";

import {
  ETIQUETAS_ABIERTAS,
  alAgregar,
  conEtiqueta,
  etiquetasTrasAtencion,
  etiquetasTrasCierre,
  sinEtiqueta,
  tieneAbiertas,
} from "../lib/etiquetasCiclo.ts";

/**
 * «No tiene sentido que diga "cotización" pero se cerró la venta.» Estas
 * reglas son las que quitan las etiquetas de estado abierto cuando el estado
 * termina, y dejan las que describen un hecho.
 */

test("ganado: se van las abiertas y aparece «cliente»", () => {
  const r = etiquetasTrasCierre(["cotizacion", "posible_comprador", "agendado"], "ganado");
  assert.deepEqual(r, ["agendado", "cliente"]);
});

test("ganado: «Falta pago» también se va (ya pagó)", () => {
  assert.deepEqual(etiquetasTrasCierre(["pago_pendiente"], "ganado"), ["cliente"]);
});

test("ganado: «cliente_nuevo» se convierte en «cliente»", () => {
  assert.deepEqual(etiquetasTrasCierre(["cliente_nuevo", "cotizacion"], "ganado"), ["cliente"]);
});

test("alAgregar: un reclamo nuevo borra «resuelto»; «resuelto» cierra el reclamo", () => {
  assert.deepEqual(alAgregar(["resuelto", "cliente"], ["reclamo"]), ["cliente", "reclamo"]);
  assert.deepEqual(alAgregar(["reclamo", "necesita_atencion"], ["resuelto"]), ["resuelto"]);
});

test("alAgregar: «cliente» reemplaza a «cliente_nuevo»; sin cambios = misma referencia", () => {
  assert.deepEqual(alAgregar(["cliente_nuevo"], ["cliente"]), ["cliente"]);
  const e = ["cotizacion"];
  assert.equal(alAgregar(e, ["cotizacion"]), e);
  assert.equal(alAgregar(e, []), e);
});

test("ganado: no duplica «cliente» si ya estaba", () => {
  assert.deepEqual(etiquetasTrasCierre(["cliente", "cotizacion"], "ganado"), ["cliente"]);
});

test("perdido: se van las abiertas, NO se agrega «cliente»", () => {
  const r = etiquetasTrasCierre(["cotizacion", "reclamo", "necesita_atencion"], "perdido");
  assert.deepEqual(r, ["reclamo"]);
});

test("etapa intermedia: no toca nada (misma referencia)", () => {
  const e = ["cotizacion", "posible_comprador"];
  assert.equal(etiquetasTrasCierre(e, "cotizado"), e);
  assert.equal(etiquetasTrasCierre(e, "nuevo"), e);
});

test("sin cambios reales devuelve la MISMA referencia (para no escribir de más)", () => {
  const e = ["reclamo", "cliente"];
  assert.equal(etiquetasTrasCierre(e, "ganado"), e);
  assert.equal(etiquetasTrasCierre(e, "perdido"), e);
});

test("«reclamo» y «agendado» son hechos: sobreviven al cierre", () => {
  assert.deepEqual(etiquetasTrasCierre(["reclamo", "agendado", "cotizacion"], "perdido"), [
    "reclamo",
    "agendado",
  ]);
});

test("atendida: solo se va «necesita_atencion»; «reclamo» se queda", () => {
  assert.deepEqual(etiquetasTrasAtencion(["reclamo", "necesita_atencion", "cotizacion"]), [
    "reclamo",
    "cotizacion",
  ]);
  const sin = ["reclamo"];
  assert.equal(etiquetasTrasAtencion(sin), sin);
});

test("tieneAbiertas detecta cualquiera de las cuatro", () => {
  for (const a of ETIQUETAS_ABIERTAS) assert.equal(tieneAbiertas(["x", a]), true);
  assert.equal(tieneAbiertas(["reclamo", "cliente"]), false);
});

test("conEtiqueta / sinEtiqueta son idempotentes y devuelven la misma referencia si no cambian", () => {
  const e = ["a"];
  assert.equal(conEtiqueta(e, "a"), e);
  assert.deepEqual(conEtiqueta(e, "b"), ["a", "b"]);
  assert.equal(sinEtiqueta(e, "b"), e);
  assert.deepEqual(sinEtiqueta(["a", "b"], "b"), ["a"]);
});
