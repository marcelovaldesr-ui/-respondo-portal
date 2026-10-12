/**
 * TESTS FASE P9: Visibilidad operativa y señales de calidad (H14).
 *  - Tasa de fallo > 20% con >= 20 envíos pausa número preventivamente.
 *  - Tasa de BAJA > 3% con >= 30 envíos alerta a HQ.
 *  - Resumen diario a las 21:30 Chile throttled 1 vez al día.
 *  - chequearWahaPool en /api/salud reporta activos y cola.
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
      ed_waha_pool_estado: [{ cols: ["id"] }],
    },
  },
);

let alertasHQ = [];

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  alertasHQ = [];

  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true },
  ];
  base.tablas.ed_waha_numeros = [
    {
      id: "num-1",
      cliente_id: KAMBAK,
      sesion: "chip_1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 10,
    },
    {
      id: "num-2",
      cliente_id: KAMBAK,
      sesion: "chip_2",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 5,
    },
  ];
  base.tablas.ed_waha_pool_estado = [
    { id: 1, ultimo_chequeo_en: new Date().toISOString() },
  ];
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
    estadoSesion: async () => ({ ok: true, status: "WORKING" }),
    wahaPoolConfigurado: () => true,
    wahaPoolApagado: () => false,
    poolSimulado: () => false,
  },
});

const {
  verificarCalidadPool,
  emitirResumenDiarioPool,
  chequearWahaPool,
} = await import("../lib/poolSalud.ts");

test("FASE P9: Señales de calidad del pool (tasa de fallo y tasa de BAJA)", async (t) => {
  beforeEach(() => {
    reiniciar();
  });

  await t.test("tasa de fallo > 20% con >= 20 envíos en 24h pausa preventivamente al número", async () => {
    const ahora = new Date("2026-10-12T15:00:00Z");
    const tMenos1h = new Date(ahora.getTime() - 3600000).toISOString();

    // 25 envíos en total para chip_1: 6 fallidos (24% de fallo)
    const envios = [];
    for (let i = 0; i < 19; i++) {
      envios.push({ id: `e-ok-${i}`, sesion_waha: "chip_1", estado: "sent", creado_en: tMenos1h });
    }
    for (let i = 0; i < 6; i++) {
      envios.push({ id: `e-fail-${i}`, sesion_waha: "chip_1", estado: "fallido", motivo: "network", creado_en: tMenos1h });
    }
    base.tablas.ed_envios_api = envios;

    const res = await verificarCalidadPool(base, ahora);
    assert.deepEqual(res.numerosPausadosPorCalidad, ["chip_1"]);

    const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === "num-1");
    assert.equal(chip1.estado, "pausado");
    assert.ok(chip1.ultimo_error.includes("Tasa de fallo elevada en 24h"));
    assert.ok(chip1.pausado_hasta);
    assert.ok(alertasHQ.some((a) => a.detalle.includes("chip_1 PAUSADO")));
  });

  await t.test("tasa de BAJA > 3% con >= 30 envíos por campaña emite alerta a HQ", async () => {
    const ahora = new Date("2026-10-12T15:00:00Z");
    const tMenos1h = new Date(ahora.getTime() - 3600000).toISOString();

    // 50 envíos para la campaña "promo_pizza": 3 bajas (6% de bajas)
    const envios = [];
    for (let i = 0; i < 47; i++) {
      envios.push({ id: `e-mkt-${i}`, canal: "waha", origen_ref: "promo_pizza", estado: "sent", creado_en: tMenos1h });
    }
    for (let i = 0; i < 3; i++) {
      envios.push({ id: `e-baja-${i}`, canal: "waha", origen_ref: "promo_pizza", estado: "fallido", motivo: "opt_out", creado_en: tMenos1h });
    }
    base.tablas.ed_envios_api = envios;

    const res = await verificarCalidadPool(base, ahora);
    assert.deepEqual(res.alertasCampanasBaja, ["promo_pizza"]);
    assert.ok(alertasHQ.some((a) => a.detalle.includes('Tasa de BAJA > 3% en campaña "promo_pizza"')));
  });
});

test("FASE P9: Resumen diario y métricas en chequearWahaPool", async (t) => {
  beforeEach(() => {
    reiniciar();
  });

  await t.test("emitirResumenDiarioPool respeta horario 21:30 Chile y emite resumen completo", async () => {
    // 21:35 en Chile (2026-10-12T21:35:00-03:00 -> 2026-10-13T00:35:00Z)
    const ahora2135 = new Date("2026-10-13T00:35:00Z");

    base.tablas.ed_envios_api = [
      { id: "e1", canal: "waha", estado: "sent", creado_en: ahora2135.toISOString() },
      { id: "e2", canal: "waha", estado: "delivered", creado_en: ahora2135.toISOString() },
      { id: "e3", canal: "waha", estado: "fallido", motivo: "opt_out", creado_en: ahora2135.toISOString() },
      { id: "e4", canal: "waha", estado: "en_cola", creado_en: ahora2135.toISOString() },
    ];
    base.tablas.ed_contactos = [
      { id: "c1", cliente_id: KAMBAK, no_contactar: true, actualizado_en: ahora2135.toISOString() },
    ];

    const emitido = await emitirResumenDiarioPool(base, ahora2135);
    assert.equal(emitido, true);

    const alertaResumen = alertasHQ.find((a) => a.detalle.includes("RESUMEN DIARIO POOL WAHA"));
    assert.ok(alertaResumen, "Debe haber emitido resumen diario a HQ");
    assert.ok(alertaResumen.detalle.includes("Total procesados: 4"));
    assert.ok(alertaResumen.detalle.includes("En cola / pendientes: 1"));

    // Segunda pasada el mismo día no lo repite
    const emitido2 = await emitirResumenDiarioPool(base, new Date("2026-10-13T00:40:00Z"));
    assert.equal(emitido2, false);
  });

  await t.test("chequearWahaPool reporta activos y métricas de cola", async () => {
    process.env.WAHA_POOL_URL = "https://waha.internal";

    base.tablas.ed_envios_api = [
      { id: "eq1", canal: "waha", estado: "en_cola", creado_en: "2026-10-12T10:00:00Z" },
      { id: "eq2", canal: "waha", estado: "en_cola", creado_en: "2026-10-12T11:00:00Z" },
    ];

    const res = await chequearWahaPool(base);
    assert.equal(res.ok, true);
    assert.ok(res.detalle.includes("2 número(s) sanos"));
    assert.ok(res.detalle.includes("2 en cola"));
    assert.ok(res.detalle.includes("2026-10-12T10:00:00Z"));
  });
});
