import assert from "node:assert/strict";
import test from "node:test";

import { armarPayload, idDeEvento, respuestaParaGuardar, toca_reintentar, verificar } from "../lib/ads/eventos.ts";

/**
 * Los eventos de conversión son lo único de Pauta que ESCRIBE en un sistema
 * ajeno. Un error acá no se ve en una pantalla: le enseña a Meta a buscar a la
 * gente equivocada y le cuesta plata al cliente durante semanas.
 *
 * Lo que más se prueba es lo que NO debe pasar: duplicar un evento (Meta no
 * deduplica), mandar datos personales, o mandar algo que no se puede atribuir.
 */

const lead = {
  clienteId: "cli-1",
  chatId: "56912345678",
  tipo: "QualifiedLead",
  ocurridoEn: 1_794_430_000,
  ctwaClid: "ARAxYz_example",
};
const compra = { ...lead, tipo: "Purchase", valor: 450000, moneda: "CLP", ventaId: "venta-1" };

test("⭐⭐ un lead es UNO por conversación, sin importar cuándo se detecte", () => {
  assert.equal(idDeEvento(lead), idDeEvento({ ...lead, ocurridoEn: lead.ocurridoEn + 30 * 86_400 }));
  assert.equal(
    idDeEvento({ ...lead, tipo: "LeadSubmitted" }),
    idDeEvento({ ...lead, tipo: "LeadSubmitted", ocurridoEn: 1 }),
  );
});

test("⭐⭐ Purchase es uno por VENTA: la misma venta reintentada no duplica, otra venta sí suma", () => {
  assert.equal(idDeEvento(compra), idDeEvento({ ...compra, ocurridoEn: compra.ocurridoEn + 999 }));
  assert.notEqual(idDeEvento(compra), idDeEvento({ ...compra, ventaId: "venta-2" }));
});

test("tipos, chats y negocios distintos dan ids distintos", () => {
  assert.notEqual(idDeEvento(lead), idDeEvento({ ...lead, tipo: "LeadSubmitted" }));
  assert.notEqual(idDeEvento(lead), idDeEvento({ ...lead, chatId: "56999999999" }));
  assert.notEqual(idDeEvento(lead), idDeEvento({ ...lead, clienteId: "cli-2" }));
});

test("⭐⭐ el payload es exactamente el de la spec de Meta y NO lleva datos personales", () => {
  const p = armarPayload(lead, "1359379696296010");
  assert.deepEqual(p, {
    data: [
      {
        event_name: "QualifiedLead",
        event_time: 1_794_430_000,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: { whatsapp_business_account_id: "1359379696296010", ctwa_clid: "ARAxYz_example" },
        custom_data: { currency: "CLP", value: 0 },
      },
    ],
  });
  const crudo = JSON.stringify(p);
  assert.ok(!crudo.includes("56912345678"), "el teléfono no viaja");
  assert.ok(!crudo.includes('"ph"'), "ni siquiera hasheado");
});

test("Purchase lleva el monto neto en CLP, entero", () => {
  const e = armarPayload({ ...compra, valor: 450000.4 }, "w").data[0];
  assert.equal(e.event_name, "Purchase");
  assert.deepEqual(e.custom_data, { currency: "CLP", value: 450000 });
});

test("partner_agent y test_event_code van arriba solo si se configuraron", () => {
  const sin = armarPayload(lead, "w");
  assert.equal(sin.partner_agent, undefined);
  assert.equal(sin.test_event_code, undefined);
  const con = armarPayload(lead, "w", { testEventCode: "TEST123", partnerAgent: "respondo" });
  assert.equal(con.test_event_code, "TEST123");
  assert.equal(con.partner_agent, "respondo");
});

test("⭐⭐ sin identificador del clic el evento NO se manda", () => {
  const v = verificar({ ...lead, ctwaClid: "" });
  assert.equal(v.ok, false);
  assert.equal(v.codigo, "sin_clid");
});

test("una compra sin venta o sin monto no se manda", () => {
  assert.equal(verificar({ ...compra, ventaId: null }).codigo, "sin_venta");
  assert.equal(verificar({ ...compra, valor: 0 }).codigo, "valor_invalido");
  assert.equal(verificar({ ...compra, valor: -1 }).codigo, "valor_invalido");
  assert.equal(verificar(compra).ok, true);
  assert.equal(verificar({ ...lead, ocurridoEn: Number.NaN }).codigo, "sin_fecha");
  assert.equal(verificar(lead).ok, true, "un lead no necesita monto");
});

test("la respuesta de Meta se guarda sin nada que parezca un token y recortada", () => {
  const r = respuestaParaGuardar({ events_received: 1, access_token: "EAAx", fbtrace_id: "abc" });
  assert.deepEqual(r, { events_received: 1, fbtrace_id: "abc" });
  const largo = respuestaParaGuardar({ x: "a".repeat(5000) });
  assert.ok(String(largo.recortado).length <= 2000);
});

test("los reintentos tienen techo y se van espaciando", () => {
  const ahora = 1_000_000_000_000;
  assert.equal(toca_reintentar({ estado: "enviado", intentos: 0, ultimoIntento: null }), false);
  assert.equal(toca_reintentar({ estado: "fallido", intentos: 0, ultimoIntento: null }), true);
  assert.equal(toca_reintentar({ estado: "fallido", intentos: 5, ultimoIntento: null, ahora }), false);
  assert.equal(toca_reintentar({ estado: "fallido", intentos: 1, ultimoIntento: ahora - 60_000, ahora }), false);
  assert.equal(toca_reintentar({ estado: "fallido", intentos: 1, ultimoIntento: ahora - 6 * 60_000, ahora }), true);
});
