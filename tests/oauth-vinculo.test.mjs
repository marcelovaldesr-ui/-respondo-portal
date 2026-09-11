/**
 * CSRF DE OAUTH (Fase 0): un `state` válido pero pedido desde OTRO navegador
 * no conecta nada.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { estadoDeUrl, huellaEstado, vinculoValido } from "../lib/oauthVinculo.ts";

test("solo el navegador que inició la conexión puede completarla", () => {
  const stateAtacante = "eyJjbGllbnRlSWQiOiJhdGFjYW50ZSJ9.firma";
  const cookieDelAtacante = huellaEstado(stateAtacante);
  assert.equal(vinculoValido(stateAtacante, cookieDelAtacante), true, "el mismo navegador: sí");
  assert.equal(vinculoValido(stateAtacante, undefined), false, "la víctima no tiene la cookie: no");
  assert.equal(vinculoValido(stateAtacante, huellaEstado("otro-state-de-la-victima")), false);
  assert.equal(vinculoValido(null, cookieDelAtacante), false);
});

test("estadoDeUrl lee el state de la URL de autorización", () => {
  assert.equal(estadoDeUrl("https://www.instagram.com/oauth/authorize?client_id=1&state=abc.def"), "abc.def");
  assert.equal(estadoDeUrl("no es url"), null);
});
