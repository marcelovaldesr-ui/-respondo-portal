/**
 * TESTS FASE P10: Cancelación de envíos en cola por prefijo o claves (POST /api/externo/mensajes/cancelar).
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { createHmac } from "node:crypto";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTRO_CLIENTE = "bbbbbbbb-0000-4000-8000-00000000000b";
const SECRETO = "secreto-kambak-test-123";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_integraciones: [{ cols: ["cliente_id"] }],
    },
  },
);

let eventosEmitidos = [];

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  eventosEmitidos = [];

  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true },
    { id: OTRO_CLIENTE, nombre: "Otro", activo: true, solo_mensajeria: true },
  ];
  base.tablas.ed_integraciones = [
    { id: "int-1", cliente_id: KAMBAK, activo: true, secreto: SECRETO },
    { id: "int-2", cliente_id: OTRO_CLIENTE, activo: true, secreto: "secreto-otro" },
  ];
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/webhookSalida.ts"), {
  namedExports: {
    emitirEvento: async (clienteId, tipo, clave, data) => {
      eventosEmitidos.push({ clienteId, tipo, clave, data });
    },
  },
});

const { POST } = await import("../app/api/externo/mensajes/cancelar/route.ts");

function firmarPeticion(bodyObj, secret = SECRETO) {
  const raw = JSON.stringify(bodyObj);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce-" + Math.random().toString(36).slice(2);
  const hmac = createHmac("sha256", secret).update(`${ts}.${nonce}.${raw}`).digest("hex");
  return new Request("http://localhost/api/externo/mensajes/cancelar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-respondo-ts": ts,
      "x-respondo-nonce": nonce,
      "x-respondo-firma": `sha256=${hmac}`,
    },
    body: raw,
  });
}

test("FASE P10: Cancelar envíos pendientes por campaña", async (t) => {
  beforeEach(() => {
    reiniciar();
  });

  await t.test("rechaza peticiones sin firma válida", async () => {
    const req = new Request("http://localhost/api/externo/mensajes/cancelar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clienteId: KAMBAK, prefijoIdempotencia: "campana-1" }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401);
  });

  await t.test("cancela solo filas en_cola del tenant que coincidan con el prefijo", async () => {
    base.tablas.ed_envios_api = [
      // Coinciden con prefijo y están en_cola
      { id: "e1", cliente_id: KAMBAK, clave: "campana-1-tel-1", canal: "waha", estado: "en_cola" },
      { id: "e2", cliente_id: KAMBAK, clave: "campana-1-tel-2", canal: "waha", estado: "en_cola" },
      // Mismo prefijo pero ya enviando o enviado -> NO deben cancelarse
      { id: "e3", cliente_id: KAMBAK, clave: "campana-1-tel-3", canal: "waha", estado: "enviando" },
      { id: "e4", cliente_id: KAMBAK, clave: "campana-1-tel-4", canal: "waha", estado: "sent" },
      // Otro prefijo -> NO debe cancelarse
      { id: "e5", cliente_id: KAMBAK, clave: "campana-2-tel-1", canal: "waha", estado: "en_cola" },
      // Mismo prefijo pero de OTRO tenant -> NUNCA debe cancelarse
      { id: "e6", cliente_id: OTRO_CLIENTE, clave: "campana-1-tel-9", canal: "waha", estado: "en_cola" },
    ];

    const req = firmarPeticion({
      clienteId: KAMBAK,
      prefijoIdempotencia: "campana-1",
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.cancelados, 2);

    // e1 y e2 deben estar fallidos con motivo cancelled
    const e1 = base.tablas.ed_envios_api.find((f) => f.id === "e1");
    const e2 = base.tablas.ed_envios_api.find((f) => f.id === "e2");
    assert.equal(e1.estado, "fallido");
    assert.equal(e1.motivo, "cancelled");
    assert.equal(e2.estado, "fallido");
    assert.equal(e2.motivo, "cancelled");

    // e3, e4, e5, e6 no se tocaron
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "e3").estado, "enviando");
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "e4").estado, "sent");
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "e5").estado, "en_cola");
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "e6").estado, "en_cola");

    // Eventos emitidos para e1 y e2
    assert.equal(eventosEmitidos.length, 2);
    assert.ok(eventosEmitidos.every((ev) => ev.data.status === "failed" && ev.data.reason === "cancelled"));
  });

  await t.test("idempotencia: cancelar de nuevo el mismo prefijo responde 0 cancelados", async () => {
    base.tablas.ed_envios_api = [
      { id: "e1", cliente_id: KAMBAK, clave: "campana-1-tel-1", canal: "waha", estado: "fallido", motivo: "cancelled" },
    ];

    const req = firmarPeticion({
      clienteId: KAMBAK,
      prefijoIdempotencia: "campana-1",
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.cancelados, 0);
  });

  await t.test("cancela por lista explícita de idempotencyKeys", async () => {
    base.tablas.ed_envios_api = [
      { id: "k1", cliente_id: KAMBAK, clave: "kambak-key-1", canal: "waha", estado: "en_cola" },
      { id: "k2", cliente_id: KAMBAK, clave: "kambak-key-2", canal: "waha", estado: "en_cola" },
      { id: "k3", cliente_id: KAMBAK, clave: "kambak-key-3", canal: "waha", estado: "en_cola" },
    ];

    const req = firmarPeticion({
      clienteId: KAMBAK,
      idempotencyKeys: ["kambak-key-1", "kambak-key-3"],
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.cancelados, 2);

    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "k1").estado, "fallido");
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "k2").estado, "en_cola");
    assert.equal(base.tablas.ed_envios_api.find((f) => f.id === "k3").estado, "fallido");
  });
});
