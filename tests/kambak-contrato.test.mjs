/**
 * CONTRATO KAMBAK → PORTAL, extremo a extremo (sin Meta).
 * Firma los pedidos EXACTAMENTE como lo hace lib/respondo.js del repo de Kambak
 * (cabecera x-respondo-firma = "sha256=" + HMAC-SHA256("ts.nonce.cuerpo")) y los pasa por la
 * autenticación real de /api/externo/* y por el envío. Si algún lado cambia el formato de la
 * firma, este test falla antes de que Kambak reciba 401 en producción.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const SECRETO = "s".repeat(64);
const base = crearBaseMemoria({}, { unicos: { ed_envios_api: [{ cols: ["cliente_id", "clave"] }] } });
mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/whatsapp.ts"), {
  namedExports: {
    configPorCliente: async () => null,
    tinoDe: async () => null,
    enviarPlantilla: async () => ({ ok: true, waId: "wamid.x" }),
  },
});
process.env.RESPONDO_ENVIOS_SIMULADOS = "1";
const { autenticarExterno } = await import("../lib/externo.ts");
const { procesarEnvio } = await import("../lib/kambakEnvios.ts");
const { reiniciarCacheSoloMensajeria } = await import("../lib/soloMensajeria.ts");

beforeEach(() => {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [{ id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true }];
  base.tablas.ed_integraciones = [{ cliente_id: KAMBAK, secreto: SECRETO, activo: true, eventos: [] }];
  reiniciarCacheSoloMensajeria();
});

// Réplica del firmado de Kambak (lib/respondo.js › signHeaders).
function firmarComoKambak(raw, secreto, ts = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(12).toString("hex")) {
  return {
    "x-respondo-ts": ts,
    "x-respondo-nonce": nonce,
    "x-respondo-firma": "sha256=" + createHmac("sha256", secreto).update(`${ts}.${nonce}.${raw}`).digest("hex"),
  };
}
const pedido = (raw, headers) =>
  new Request("https://portal.example/api/externo/mensajes", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw,
  });
const cuerpo = (clave) => JSON.stringify({
  clienteId: KAMBAK, to: "+56912345678", template: "sello_promo", language: "es",
  variables: ["Camila", "Café Aroma", "2x1", "Pide uno.", "el 31 de octubre"], idempotencyKey: clave,
});

test("un pedido firmado como Kambak lo hace es aceptado y sale", async () => {
  const raw = cuerpo("kambak-0123456789abcdef0123456789abcdef");
  const a = await autenticarExterno(pedido(raw, firmarComoKambak(raw, SECRETO)));
  assert.equal(a.ok, true);
  const r = await procesarEnvio(a.clienteId, a.cuerpo, new Date("2026-10-14T15:00:00Z"));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.status, "sent");
});

test("sin el prefijo sha256=, con otro secreto, o con el cuerpo alterado: 401", async () => {
  const raw = cuerpo("kambak-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const h = firmarComoKambak(raw, SECRETO);
  const sinPrefijo = { ...h, "x-respondo-firma": h["x-respondo-firma"].replace("sha256=", "") };
  assert.equal((await autenticarExterno(pedido(raw, sinPrefijo))).ok, false);
  assert.equal((await autenticarExterno(pedido(raw, firmarComoKambak(raw, "otro-secreto")))).ok, false);
  assert.equal((await autenticarExterno(pedido(raw + " ", h))).ok, false);
});

test("el mismo nonce no se puede reutilizar", async () => {
  const raw = cuerpo("kambak-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const h = firmarComoKambak(raw, SECRETO);
  assert.equal((await autenticarExterno(pedido(raw, h))).ok, true);
  assert.equal((await autenticarExterno(pedido(raw, h))).ok, false);
});
