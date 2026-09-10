import assert from "node:assert/strict";
import test from "node:test";

import {
  armarPayload,
  hashear,
  idDeEvento,
  normalizarTelefono,
  toca_reintentar,
  verificar,
} from "../lib/ads/eventos.ts";

/**
 * Los eventos de conversión son lo único de Pauta que ESCRIBE en un sistema
 * ajeno. Un error acá no se ve en una pantalla: le enseña a Meta a buscar a la
 * gente equivocada y le cuesta plata al cliente durante semanas.
 *
 * Por eso lo que más se prueba es lo que NO debe pasar: duplicar una venta,
 * mandar un teléfono en claro, o mandar un evento que no se puede atribuir.
 */

const base = {
  clienteId: "cli-1",
  chatId: "56912345678",
  tipo: "Purchase",
  ocurridoEn: 1_780_000_000,
  ctwaClid: "ARAxYz_example",
  telefono: "+56 9 1234 5678",
  valor: 45000,
  moneda: "CLP",
};

test("⭐⭐ el mismo hecho da SIEMPRE el mismo id: reintentar no duplica la venta", () => {
  assert.equal(idDeEvento(base), idDeEvento({ ...base }));
});

test("⭐⭐ la MISMA venta por dos caminos distintos es UN solo evento", () => {
  // El caso real que esto evita: el barrido ve el cobro pagado en ed_pagos y
  // además el resultado venta_confirmada en ed_resultados, grabados con
  // segundos de diferencia. Los dos son Purchase del mismo chat. Si generaran
  // ids distintos, Meta contaría dos ventas donde hubo una.
  assert.equal(idDeEvento(base), idDeEvento({ ...base, ocurridoEn: base.ocurridoEn + 30 }));
  assert.equal(idDeEvento(base), idDeEvento({ ...base, ocurridoEn: base.ocurridoEn + 3600 }));
});

test("dos días distintos SÍ son dos eventos", () => {
  assert.notEqual(idDeEvento(base), idDeEvento({ ...base, ocurridoEn: base.ocurridoEn + 86_400 }));
});

test("hechos distintos dan ids distintos", () => {
  assert.notEqual(idDeEvento(base), idDeEvento({ ...base, tipo: "Lead" }));
  assert.notEqual(idDeEvento(base), idDeEvento({ ...base, chatId: "56999999999" }));
  assert.notEqual(idDeEvento(base), idDeEvento({ ...base, clienteId: "cli-2" }));
});

test("⭐⭐ el teléfono sale hasheado, nunca en claro", () => {
  const p = armarPayload(base, "waba-1");
  const crudo = JSON.stringify(p);

  assert.ok(!crudo.includes("56912345678") || crudo.indexOf("56912345678") === -1);
  assert.match(p.data[0].user_data.ph[0], /^[a-f0-9]{64}$/);
});

test("el mismo número escrito distinto da el mismo hash", () => {
  // Si no, la persona no se reconoce y el evento se pierde en silencio.
  assert.equal(normalizarTelefono("+56 9 1234 5678"), "56912345678");
  assert.equal(normalizarTelefono("56912345678"), "56912345678");
  assert.equal(
    hashear(normalizarTelefono("+56 9 1234 5678")),
    hashear(normalizarTelefono("56912345678")),
  );
});

test("un teléfono imposible no se manda como si fuera válido", () => {
  assert.equal(normalizarTelefono("123"), null);
  assert.equal(normalizarTelefono(""), null);
  assert.equal(normalizarTelefono(null), null);

  const p = armarPayload({ ...base, telefono: "123" }, "waba-1");
  assert.equal(p.data[0].user_data.ph, undefined);
});

test("⭐ los tres campos que hacen que Meta lo use para WhatsApp", () => {
  const e = armarPayload(base, "waba-1").data[0];
  assert.equal(e.action_source, "business_messaging");
  assert.equal(e.messaging_channel, "whatsapp");
  assert.equal(e.user_data.ctwa_clid, base.ctwaClid);
  assert.equal(e.user_data.whatsapp_business_account_id, "waba-1");
});

test("el monto solo viaja cuando existe y es positivo", () => {
  assert.equal(armarPayload(base, "w").data[0].custom_data.value, 45000);
  assert.equal(armarPayload(base, "w").data[0].custom_data.currency, "CLP");
  assert.equal(armarPayload({ ...base, valor: null }, "w").data[0].custom_data, undefined);
  assert.equal(armarPayload({ ...base, valor: 0 }, "w").data[0].custom_data, undefined);
});

test("⭐⭐ sin identificador del clic el evento NO se manda", () => {
  const v = verificar({ ...base, ctwaClid: "" });
  assert.equal(v.ok, false);
  assert.equal(v.codigo, "sin_clid");
  assert.match(v.motivo, /atribuir/);
});

test("una fecha o un monto inválidos frenan el envío", () => {
  assert.equal(verificar({ ...base, ocurridoEn: Number.NaN }).codigo, "sin_fecha");
  assert.equal(verificar({ ...base, valor: -1 }).codigo, "valor_invalido");
  assert.equal(verificar(base).ok, true);
});

test("los reintentos tienen techo y se van espaciando", () => {
  const ahora = 1_000_000_000_000;

  assert.equal(toca_reintentar({ estado: "enviado", intentos: 0, ultimoIntento: null }), false);
  assert.equal(toca_reintentar({ estado: "fallido", intentos: 0, ultimoIntento: null }), true);
  assert.equal(
    toca_reintentar({ estado: "fallido", intentos: 5, ultimoIntento: null, ahora }),
    false,
    "cinco intentos y se deja de insistir",
  );

  // Al primer fallo espera 5 minutos.
  assert.equal(
    toca_reintentar({ estado: "fallido", intentos: 1, ultimoIntento: ahora - 60_000, ahora }),
    false,
  );
  assert.equal(
    toca_reintentar({ estado: "fallido", intentos: 1, ultimoIntento: ahora - 6 * 60_000, ahora }),
    true,
  );
});
