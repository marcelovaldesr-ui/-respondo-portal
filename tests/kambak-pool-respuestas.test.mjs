/**
 * TESTS FASE P8: Respuestas de clientes al número del pool (H13).
 * Auto-respuesta opcional detrás de WAHA_POOL_AUTORESPUESTA=1, limitada a 1/24h,
 * nunca en grupos ni estados, y nunca sustituyendo a confirmación de BAJA.
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

let enviadosPool = [];

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  enviadosPool = [];
  delete process.env.WAHA_POOL_AUTORESPUESTA;

  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true },
  ];
  base.tablas.ed_waha_numeros = [
    { id: "num-1", cliente_id: KAMBAK, sesion: "chip_1", estado: "activo", rol: "envio" },
  ];
  base.tablas.ed_empleados = [
    { id: "tino-1", cliente_id: KAMBAK, nombre: "Tino", activo: true, rol: "asistente" },
  ];
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/webhookSalida.ts"), {
  namedExports: {
    emitirEvento: async () => {},
  },
});
mock.module(url("../lib/hqBridge.ts"), {
  namedExports: {
    notificarHQ: async () => {},
  },
});
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    normalizeWaId: (raw) => (typeof raw === "string" ? raw : "msg_123"),
    enviarTextoPool: async (sesion, chatId, texto) => {
      enviadosPool.push({ sesion, chatId, texto });
      return { ok: true, id: "msg_out_1" };
    },
    existeEnWhatsApp: async () => ({ ok: true, exists: true }),
    iniciarTipeo: async () => true,
    pararTipeo: async () => true,
    wahaPoolConfigurado: () => true,
    poolSimulado: () => false,
    wahaPoolApagado: () => false,
  },
});

import { createHash } from "node:crypto";
const { manejarEntranteWahaPool } = await import("../lib/inboundWahaPool.ts");

function huella(clienteId, tel) {
  return createHash("sha256").update(`${clienteId}:${tel}`).digest("hex");
}

test("FASE P8: Auto-respuesta a mensajes entrantes al pool", async (t) => {
  beforeEach(() => {
    reiniciar();
  });

  await t.test("desactivada por defecto (WAHA_POOL_AUTORESPUESTA no fijado)", async () => {
    const payload = {
      event: "message",
      session: "chip_1",
      payload: {
        id: "msg_in_1",
        from: "56911112222@c.us",
        body: "¿Hay mesas disponibles?",
      },
    };

    const res = await manejarEntranteWahaPool(payload, base);
    assert.equal(res.accion, "cliente:solo_mensajeria");
    assert.equal(res.autorespuesta, undefined);
    assert.equal(enviadosPool.length, 0, "No debe enviar auto-respuesta si el flag está apagado");
  });

  await t.test("con flag activo envía auto-respuesta personalizada con nombre del local", async () => {
    process.env.WAHA_POOL_AUTORESPUESTA = "1";

    const hash = huella(KAMBAK, "56911112222");
    base.tablas.ed_envios_api = [
      {
        id: "envio-previo-1",
        cliente_id: KAMBAK,
        telefono_hash: hash,
        origen_ref: "Pizzería Roma",
        creado_en: new Date(Date.now() - 3600000).toISOString(),
      },
    ];

    const payload = {
      event: "message",
      session: "chip_1",
      payload: {
        id: "msg_in_2",
        from: "56911112222@c.us",
        body: "Hola, ¿a qué hora abren?",
      },
    };

    const res = await manejarEntranteWahaPool(payload, base);
    assert.equal(res.accion, "cliente:solo_mensajeria");
    assert.equal(res.autorespuesta, true);
    assert.equal(enviadosPool.length, 1);
    assert.ok(
      enviadosPool[0].texto.includes("Pizzería Roma"),
      `Debe incluir el nombre del local: ${enviadosPool[0].texto}`,
    );
  });

  await t.test("rate limit estricto 1 vez cada 24 horas por contacto", async () => {
    process.env.WAHA_POOL_AUTORESPUESTA = "1";

    // Simular que ya se le respondió hace 2 horas
    base.tablas.ed_mensajes = [
      {
        id: "m-ant",
        chat_id: "56911112222",
        rol: "empleado",
        texto: "Este número solo envía avisos...",
        creado_en: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      },
    ];

    const payload = {
      event: "message",
      session: "chip_1",
      payload: {
        id: "msg_in_3",
        from: "56911112222@c.us",
        body: "Siguen ahí?",
      },
    };

    const res = await manejarEntranteWahaPool(payload, base);
    assert.equal(res.accion, "cliente:solo_mensajeria");
    assert.equal(res.autorespuesta, undefined);
    assert.equal(enviadosPool.length, 0, "No debe enviar auto-respuesta repetida dentro de 24h");
  });

  await t.test("mensajes de grupos (@g.us) nunca reciben auto-respuesta", async () => {
    process.env.WAHA_POOL_AUTORESPUESTA = "1";

    const payload = {
      event: "message",
      session: "chip_1",
      payload: {
        id: "msg_in_grupo",
        from: "123456789-987654@g.us",
        body: "Mensaje en un grupo",
      },
    };

    const res = await manejarEntranteWahaPool(payload, base);
    assert.equal(res.accion, "mensaje_ignorado");
    assert.equal(enviadosPool.length, 0);
  });

  await t.test("palabra clave BAJA recibe confirmación de baja y NUNCA auto-respuesta genérica", async () => {
    process.env.WAHA_POOL_AUTORESPUESTA = "1";

    const payload = {
      event: "message",
      session: "chip_1",
      payload: {
        id: "msg_in_baja",
        from: "56911112222@c.us",
        body: "BAJA",
      },
    };

    const res = await manejarEntranteWahaPool(payload, base);
    assert.equal(res.accion, "baja");
    assert.equal(enviadosPool.length, 1);
    assert.ok(
      enviadosPool[0].texto.includes("has sido dado de baja") ||
      enviadosPool[0].texto.includes("no recibirás más"),
      "Debe ser confirmación de baja exclusiva",
    );
    assert.ok(
      !enviadosPool[0].texto.includes("Este número solo envía avisos"),
      "Nunca debe enviar auto-respuesta genérica a una solicitud de baja",
    );
  });
});
