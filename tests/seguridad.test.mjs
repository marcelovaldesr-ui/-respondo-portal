import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { firmaMetaValida, secretoValido } from "../lib/seguridad.ts";

test("los secretos sensibles fallan cerrados si falta configuración", () => {
  assert.equal(secretoValido(null, undefined), false);
  assert.equal(secretoValido("cualquiera", undefined), false);
});

test("la comparación de secreto solo acepta coincidencia exacta", () => {
  assert.equal(secretoValido("correcto", "correcto"), true);
  assert.equal(secretoValido("incorrecto", "correcto"), false);
  assert.equal(secretoValido("correcto-extra", "correcto"), false);
});

test("Meta rechaza payloads si falta el App Secret", () => {
  const anterior = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  try {
    assert.equal(firmaMetaValida("{}", null), false);
    assert.equal(firmaMetaValida("{}", "sha256=falso"), false);
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = anterior;
  }
});

test("Meta valida HMAC sobre el cuerpo crudo y detecta manipulación", () => {
  const anterior = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "secreto-de-prueba";
  try {
    const cuerpo = '{"entry":[1]}';
    const firma =
      "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(cuerpo).digest("hex");
    assert.equal(firmaMetaValida(cuerpo, firma), true);
    assert.equal(firmaMetaValida('{"entry":[2]}', firma), false);
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = anterior;
  }
});
