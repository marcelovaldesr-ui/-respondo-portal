import assert from "node:assert/strict";
import test from "node:test";

import { codigoDeErrorMeta, esErrorDeVentana, explicarErrorMeta } from "../lib/erroresMeta.ts";

/**
 * Lo que ve Cecilia cuando un envío falla. Antes llegaba el JSON crudo de Meta
 * (auditoría 3-sep-2026); acá se asegura que cada código conocido diga QUÉ
 * HACER y que ningún camino vuelva a mostrar `HTTP 400: {"error":...}`.
 */

const GRAPH_131047 =
  'HTTP 400: {"error":{"message":"(#131047) Re-engagement message","type":"OAuthException","code":131047,"error_data":{"messaging_product":"whatsapp","details":"Message failed to send because more than 24 hours have passed since the customer last replied to this number."},"fbtrace_id":"AbC"}}';

test("saca el código de los tres formatos en que aparece", () => {
  assert.equal(codigoDeErrorMeta(GRAPH_131047), 131047);
  assert.equal(codigoDeErrorMeta("(#132001) Template name does not exist"), 132001);
  assert.equal(codigoDeErrorMeta("131026: Message undeliverable"), 131026);
  assert.equal(codigoDeErrorMeta("fetch failed"), null);
  assert.equal(codigoDeErrorMeta(""), null);
  assert.equal(codigoDeErrorMeta(undefined), null);
});

test("fuera de las 24 h: dice que use plantilla, y se reconoce como error de ventana", () => {
  const texto = explicarErrorMeta(GRAPH_131047);
  assert.match(texto, /24 h/);
  assert.match(texto, /plantilla/i);
  assert.equal(esErrorDeVentana(GRAPH_131047), true);
  assert.equal(esErrorDeVentana("HTTP 400: {\"error\":{\"code\":100}}"), false);
});

test("token vencido y número que no recibe: explican la acción, no el código", () => {
  assert.match(explicarErrorMeta('HTTP 401: {"error":{"code":190,"message":"Error validating access token"}}'), /volver a conectar/i);
  assert.match(explicarErrorMeta("131026: Message Undeliverable"), /no puede recibir/i);
  assert.match(explicarErrorMeta('HTTP 429: {"error":{"code":130429}}'), /limitando/i);
});

test("errores propios (WAHA ajeno, timeout, red) también se traducen", () => {
  assert.match(explicarErrorMeta("waha_pertenece_a_otro_cliente"), /NO salió/);
  assert.match(explicarErrorMeta("The operation was aborted due to timeout"), /tardó demasiado/i);
  assert.match(explicarErrorMeta("fetch failed"), /conectar/i);
  assert.match(explicarErrorMeta("HTTP 503: <html>bad gateway</html>"), /momentáneo/i);
});

test("NUNCA devuelve el JSON crudo: si no conoce el código, resume y sugiere qué hacer", () => {
  const raro = 'HTTP 400: {"error":{"message":"(#999999) Something odd","code":999999}}';
  const texto = explicarErrorMeta(raro, "archivo");
  assert.doesNotMatch(texto, /\{"error"/);
  assert.match(texto, /el archivo/);
  assert.match(texto, /Something odd/);
  assert.match(explicarErrorMeta(undefined, "cobro"), /el cobro/);
  assert.match(explicarErrorMeta("", "plantilla"), /la plantilla/);
});
