/**
 * TESTS FASE P7: Rampa de calentamiento por días reales, tope configurable
 * y promoción condicional estricta.
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_waha_numeros: [{ cols: ["sesion"] }],
    },
  },
);

let alertasHQ = [];
let sesionesWaha = {};

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  alertasHQ = [];
  sesionesWaha = {
    "s-inmaduro": "WORKING",
    "s-fallos": "WORKING",
    "s-sin-ok": "WORKING",
    "s-caida": "STOPPED",
    "s-listo": "WORKING",
  };
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/push.ts"), {
  namedExports: {
    avisarACliente: async () => {},
  },
});
mock.module(url("../lib/hqBridge.ts"), {
  namedExports: {
    notificarHQ: async (payload) => {
      alertasHQ.push(payload);
    },
  },
});
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    estadoSesion: async (sesion) => sesionesWaha[sesion] || "STOPPED",
    wahaPoolApagado: () => false,
    wahaPoolConfigurado: () => true,
    poolSimulado: () => false,
  },
});

const { topeDelDia, topeMaximoConfigurado, RAMPA_CALENTAMIENTO } = await import("../lib/poolNumeros.ts");
const { promoverCalentando } = await import("../lib/poolSalud.ts");

test("FASE P7: Rampa de calentamiento por días reales y tope configurable", async (t) => {
  await t.test("rampa respeta días reales de calentamiento", () => {
    assert.deepEqual(RAMPA_CALENTAMIENTO, [20, 40, 60, 90, 120]);

    const chip = { calentamiento_desde: "2026-10-10", tope_diario: 150 };

    // Día 1
    assert.equal(topeDelDia(chip, new Date("2026-10-10T15:00:00Z")), 20);
    // Día 2
    assert.equal(topeDelDia(chip, new Date("2026-10-11T15:00:00Z")), 40);
    // Día 3
    assert.equal(topeDelDia(chip, new Date("2026-10-12T15:00:00Z")), 60);
    // Día 4
    assert.equal(topeDelDia(chip, new Date("2026-10-13T15:00:00Z")), 90);
    // Día 5
    assert.equal(topeDelDia(chip, new Date("2026-10-14T15:00:00Z")), 120);
    // Día 6 en adelante -> tope diario
    assert.equal(topeDelDia(chip, new Date("2026-10-15T15:00:00Z")), 150);
  });

  await t.test("respeta WAHA_POOL_TOPE_MAX configurable por env", () => {
    const origEnv = process.env.WAHA_POOL_TOPE_MAX;
    try {
      process.env.WAHA_POOL_TOPE_MAX = "80";
      assert.equal(topeMaximoConfigurado(), 80);

      const chip = { calentamiento_desde: null, tope_diario: 150 };
      // Sin calentamiento, acotado por env
      assert.equal(topeDelDia(chip, new Date()), 80);
    } finally {
      if (origEnv !== undefined) process.env.WAHA_POOL_TOPE_MAX = origEnv;
      else delete process.env.WAHA_POOL_TOPE_MAX;
    }
  });
});

test("FASE P7: Promoción condicional estricta de números en calentamiento", async (t) => {
  beforeEach(() => {
    reiniciar();
    base.tablas.ed_waha_numeros = [
      {
        id: "chip-inmaduro",
        cliente_id: KAMBAK,
        sesion: "s-inmaduro",
        estado: "calentando",
        rol: "envio",
        calentamiento_desde: "2026-10-08", // Solo 2 días
        fallos_seguidos: 0,
        ultimo_ok_en: "2026-10-09T10:00:00Z",
      },
      {
        id: "chip-con-fallos",
        cliente_id: KAMBAK,
        sesion: "s-fallos",
        estado: "calentando",
        rol: "envio",
        calentamiento_desde: "2026-10-01", // 9 días
        fallos_seguidos: 1, // Fallos > 0
        ultimo_ok_en: "2026-10-05T10:00:00Z",
      },
      {
        id: "chip-sin-ok",
        cliente_id: KAMBAK,
        sesion: "s-sin-ok",
        estado: "calentando",
        rol: "envio",
        calentamiento_desde: "2026-10-01",
        fallos_seguidos: 0,
        ultimo_ok_en: null, // Nunca ha tenido envío exitoso
      },
      {
        id: "chip-sesion-caida",
        cliente_id: KAMBAK,
        sesion: "s-caida",
        estado: "calentando",
        rol: "envio",
        calentamiento_desde: "2026-10-01",
        fallos_seguidos: 0,
        ultimo_ok_en: "2026-10-05T10:00:00Z",
      },
      {
        id: "chip-listo",
        cliente_id: KAMBAK,
        sesion: "s-listo",
        estado: "calentando",
        rol: "envio",
        calentamiento_desde: "2026-10-01", // 9 días
        fallos_seguidos: 0,
        ultimo_ok_en: "2026-10-08T10:00:00Z",
      },
    ];
    base.tablas.ed_envios_api = [
      { id: "e1", cliente_id: KAMBAK, sesion_waha: "s-listo", estado: "sent" },
      { id: "e2", cliente_id: KAMBAK, sesion_waha: "s-listo", estado: "sent" },
      { id: "e3", cliente_id: KAMBAK, sesion_waha: "s-listo", estado: "sent" },
    ];
  });

  await t.test("promueve solo al chip que cumple todas las condiciones", async () => {
    const ahora = new Date("2026-10-10T12:00:00Z");
    const promovido = await promoverCalentando(KAMBAK, base, ahora);

    assert.ok(promovido, "Debe promover a chip-listo");
    assert.equal(promovido.id, "chip-listo");
    assert.equal(promovido.estado, "activo");

    const chipEnBase = base.tablas.ed_waha_numeros.find((n) => n.id === "chip-listo");
    assert.equal(chipEnBase.estado, "activo");
  });

  await t.test("no promueve si no hay candidatos maduros o sanos", async () => {
    // Si solo queda el inmaduro o caido
    base.tablas.ed_waha_numeros = base.tablas.ed_waha_numeros.filter((n) => n.id === "chip-inmaduro");
    const ahora = new Date("2026-10-10T12:00:00Z");
    const res = await promoverCalentando(KAMBAK, base, ahora);
    assert.equal(res, null);
  });
});
