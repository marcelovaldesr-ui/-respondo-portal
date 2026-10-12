/**
 * TESTS FASE P11: Piloto por local (opt-in) y matriz de decisión de canal.
 * Matriz 3x3:
 *   Tenant: 'meta' | 'waha' | 'waha_opt_in'
 *   Petición: null/desconocido | 'waha' | 'meta'
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const TENANT_META = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_WAHA = "aaaaaaaa-0000-4000-8000-000000000002";
const TENANT_OPT_IN = "aaaaaaaa-0000-4000-8000-000000000003";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_clientes: [{ cols: ["id"] }],
    },
  },
);

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  delete process.env.WAHA_POOL_APAGADO;
  process.env.RESPONDO_ENVIOS_SIMULADOS = "1";

  base.tablas.ed_clientes = [
    { id: TENANT_META, nombre: "Cliente Meta", canal_marketing: "meta", activo: true, solo_mensajeria: true },
    { id: TENANT_WAHA, nombre: "Cliente Waha", canal_marketing: "waha", activo: true, solo_mensajeria: true },
    { id: TENANT_OPT_IN, nombre: "Cliente OptIn", canal_marketing: "waha_opt_in", activo: true, solo_mensajeria: true },
  ];
  base.tablas.ed_envios_api = [];
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/webhookSalida.ts"), {
  namedExports: {
    emitirEvento: async () => {},
  },
});
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    wahaPoolApagado: () => process.env.WAHA_POOL_APAGADO === "1",
    enviarTextoPool: async () => ({ ok: true }),
    existeEnWhatsApp: async () => ({ ok: true, exists: true }),
    iniciarTipeo: async () => true,
    pararTipeo: async () => true,
    wahaPoolConfigurado: () => true,
    poolSimulado: () => true,
    normalizeWaId: (raw) => (typeof raw === "string" ? raw : "id123"),
  },
});

const { procesarEnvio } = await import("../lib/kambakEnvios.ts");
const { canalMarketingDe } = await import("../lib/poolNumeros.ts");

test("FASE P11: Matriz completa de canal_marketing (tenant) x canalMarketing (petición)", async (t) => {
  beforeEach(() => {
    reiniciar();
  });

  await t.test("canalMarketingDe resuelve 'meta', 'waha' y 'waha_opt_in'", async () => {
    assert.equal(await canalMarketingDe(TENANT_META, base), "meta");
    assert.equal(await canalMarketingDe(TENANT_WAHA, base), "waha");
    assert.equal(await canalMarketingDe(TENANT_OPT_IN, base), "waha_opt_in");
  });

  const plantillaMarketing = {
    to: "+56911112222",
    template: "sello_promo",
    language: "es",
    variables: ["Cliente", "Local", "Promo 2x1", "Válido hoy", "31 oct"],
  };

  // --- TENANT META ---
  await t.test("Tenant 'meta' -> siempre sale por Meta", async () => {
    // 1. Sin campo en petición
    const r1 = await procesarEnvio(TENANT_META, { ...plantillaMarketing, idempotencyKey: "k-meta-1" });
    assert.equal(r1.status, 200);
    const f1 = base.tablas.ed_envios_api.find((f) => f.clave === "k-meta-1");
    assert.equal(f1.canal, "meta");

    // 2. Con canalMarketing: 'waha' (ignorado porque el tenant es 'meta')
    const r2 = await procesarEnvio(TENANT_META, { ...plantillaMarketing, idempotencyKey: "k-meta-2", canalMarketing: "waha" });
    assert.equal(r2.status, 200);
    const f2 = base.tablas.ed_envios_api.find((f) => f.clave === "k-meta-2");
    assert.equal(f2.canal, "meta");

    // 3. Con canalMarketing: 'meta'
    const r3 = await procesarEnvio(TENANT_META, { ...plantillaMarketing, idempotencyKey: "k-meta-3", canalMarketing: "meta" });
    assert.equal(r3.status, 200);
    const f3 = base.tablas.ed_envios_api.find((f) => f.clave === "k-meta-3");
    assert.equal(f3.canal, "meta");
  });

  // --- TENANT WAHA ---
  await t.test("Tenant 'waha' -> usa WAHA salvo que la petición pida 'meta'", async () => {
    // 1. Sin campo en petición -> WAHA (encolado)
    const r1 = await procesarEnvio(TENANT_WAHA, { ...plantillaMarketing, idempotencyKey: "k-waha-1" });
    assert.equal(r1.status, 200);
    assert.equal(r1.cuerpo.status, "queued");
    const f1 = base.tablas.ed_envios_api.find((f) => f.clave === "k-waha-1");
    assert.equal(f1.canal, "waha");

    // 2. Con canalMarketing: 'waha' -> WAHA
    const r2 = await procesarEnvio(TENANT_WAHA, { ...plantillaMarketing, idempotencyKey: "k-waha-2", canalMarketing: "waha" });
    assert.equal(r2.status, 200);
    assert.equal(r2.cuerpo.status, "queued");
    const f2 = base.tablas.ed_envios_api.find((f) => f.clave === "k-waha-2");
    assert.equal(f2.canal, "waha");

    // 3. Con canalMarketing: 'meta' -> Respeta y manda por Meta
    const r3 = await procesarEnvio(TENANT_WAHA, { ...plantillaMarketing, idempotencyKey: "k-waha-3", canalMarketing: "meta" });
    assert.equal(r3.status, 200);
    const f3 = base.tablas.ed_envios_api.find((f) => f.clave === "k-waha-3");
    assert.equal(f3.canal, "meta");
  });

  // --- TENANT WAHA_OPT_IN ---
  await t.test("Tenant 'waha_opt_in' -> usa WAHA SOLO si la petición trae canalMarketing: 'waha'", async () => {
    // 1. Sin campo en petición -> Sigue por Meta (retrocompatibilidad)
    const r1 = await procesarEnvio(TENANT_OPT_IN, { ...plantillaMarketing, idempotencyKey: "k-optin-1" });
    assert.equal(r1.status, 200);
    const f1 = base.tablas.ed_envios_api.find((f) => f.clave === "k-optin-1");
    assert.equal(f1.canal, "meta");

    // 2. Con canalMarketing: 'waha' -> Va al pool WAHA (encolado)
    const r2 = await procesarEnvio(TENANT_OPT_IN, { ...plantillaMarketing, idempotencyKey: "k-optin-2", canalMarketing: "waha" });
    assert.equal(r2.status, 200);
    assert.equal(r2.cuerpo.status, "queued");
    const f2 = base.tablas.ed_envios_api.find((f) => f.clave === "k-optin-2");
    assert.equal(f2.canal, "waha");

    // 3. Con canalMarketing: 'meta' o valor desconocido -> Sigue por Meta
    const r3 = await procesarEnvio(TENANT_OPT_IN, { ...plantillaMarketing, idempotencyKey: "k-optin-3", canalMarketing: "meta" });
    assert.equal(r3.status, 200);
    const f3 = base.tablas.ed_envios_api.find((f) => f.clave === "k-optin-3");
    assert.equal(f3.canal, "meta");

    const r4 = await procesarEnvio(TENANT_OPT_IN, { ...plantillaMarketing, idempotencyKey: "k-optin-4", canalMarketing: "invalido_xyz" });
    assert.equal(r4.status, 200);
    const f4 = base.tablas.ed_envios_api.find((f) => f.clave === "k-optin-4");
    assert.equal(f4.canal, "meta");
  });

  await t.test("Kill switch WAHA_POOL_APAGADO=1 fuerza Meta para todos los casos", async () => {
    process.env.WAHA_POOL_APAGADO = "1";

    const r = await procesarEnvio(TENANT_WAHA, { ...plantillaMarketing, idempotencyKey: "k-kill-1", canalMarketing: "waha" });
    assert.equal(r.status, 200);
    const f = base.tablas.ed_envios_api.find((f) => f.clave === "k-kill-1");
    assert.equal(f.canal, "meta");
  });
});
