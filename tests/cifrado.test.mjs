import assert from "node:assert/strict";
import test from "node:test";

// La clave se deriva de este secreto: sin él, cifrar() lanza.
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba-no-es-la-real";

import { cifrar, descifrar, pareceCifrado } from "../lib/cifrado.ts";

const TOKEN = "EAAG1234567890abcdefGHIJKLMNOPqrstuvwxyz";

test("lo cifrado se recupera igual", () => {
  const c = cifrar(TOKEN, "waba-token");
  assert.notEqual(c, TOKEN);
  assert.equal(descifrar(c, "waba-token"), TOKEN);
});

test("dos cifrados del mismo texto son distintos", () => {
  // Si dieran igual, cualquiera con acceso a la base podría ver qué clientes
  // comparten token con solo comparar las filas.
  assert.notEqual(cifrar(TOKEN, "waba-token"), cifrar(TOKEN, "waba-token"));
});

test("un propósito NO puede descifrar lo del otro", () => {
  // Es la razón de existir de la separación por propósito: que el token de
  // WhatsApp de un cliente no se pueda leer con la clave del calendario.
  const c = cifrar(TOKEN, "waba-token");
  assert.equal(descifrar(c, "gcal-refresh"), null);
});

test("un valor manipulado devuelve null, no basura", () => {
  const c = cifrar(TOKEN, "waba-token");
  const [iv, tag, datos] = c.split(".");
  const alterado = `${iv}.${tag}.${datos.slice(0, -2)}XY`;
  assert.equal(descifrar(alterado, "waba-token"), null);
});

test("nunca lanza con entradas malas", () => {
  for (const malo of ["", "no-es-cifrado", "a.b", "....", "a.b.c.d"]) {
    assert.equal(descifrar(malo, "waba-token"), null);
  }
});

test("reconoce un token de Meta en claro como NO cifrado", () => {
  // Es lo que decide, durante la transición, si hay que descifrar o si el
  // valor todavía está en texto plano.
  assert.equal(pareceCifrado(TOKEN), false);
  assert.equal(pareceCifrado("EAAG.abc"), false);
  assert.equal(pareceCifrado(null), false);
  assert.equal(pareceCifrado(undefined), false);
  assert.equal(pareceCifrado(""), false);
  assert.equal(pareceCifrado(cifrar(TOKEN, "waba-token")), true);
});

test("soporta textos largos y con acentos", () => {
  const largo = "ñÁÉÍÓÚ ".repeat(500);
  assert.equal(descifrar(cifrar(largo, "gcal-refresh"), "gcal-refresh"), largo);
});
