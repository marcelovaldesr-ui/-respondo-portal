/**
 * TESTS FASE 4: Salud del pool WAHA, rotación automática, alertas y chequeo de salud.
 * (lib/poolSalud.ts, lib/inboundWahaPool.ts, app/api/salud/route.ts)
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const NUM_ACTIVO = "11111111-0000-4000-8000-00000000000a";
const NUM_BACKUP = "22222222-0000-4000-8000-00000000000a";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_waha_numeros: [{ cols: ["sesion"] }],
    },
  },
);

let alertasPush = [];
let alertasHQ = [];
let sesionesWaha = {
  kambak_chip_1: { ok: true, status: "WORKING" },
  kambak_chip_backup: { ok: true, status: "WORKING" },
};

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [
    {
      id: KAMBAK,
      nombre: "Kambak",
      activo: true,
      solo_mensajeria: true,
      canal_marketing: "waha",
    },
  ];
  base.tablas.ed_waha_numeros = [
    {
      id: NUM_ACTIVO,
      cliente_id: KAMBAK,
      sesion: "kambak_chip_1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 10,
      fallos_seguidos: 0,
      calentamiento_desde: "2026-10-01",
    },
    {
      id: NUM_BACKUP,
      cliente_id: KAMBAK,
      sesion: "kambak_chip_backup",
      estado: "calentando",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      fallos_seguidos: 0,
      calentamiento_desde: "2026-10-05",
    },
  ];

  alertasPush = [];
  alertasHQ = [];
  sesionesWaha = {
    kambak_chip_1: { ok: true, status: "WORKING" },
    kambak_chip_backup: { ok: true, status: "WORKING" },
  };

  delete process.env.WAHA_POOL_APAGADO;
  delete process.env.WAHA_POOL_URL;
  delete process.env.RESPONDO_POOL_SIMULADO;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/push.ts"), {
  namedExports: {
    avisarACliente: async (clienteId, payload) => {
      alertasPush.push({ clienteId, payload });
    },
  },
});
mock.module(url("../lib/hqBridge.ts"), {
  namedExports: {
    notificarHQ: (payload) => {
      alertasHQ.push(payload);
    },
  },
});
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    estadoSesion: async (sesion) => {
      if (sesionesWaha[sesion]) return sesionesWaha[sesion];
      return { ok: false, status: "UNKNOWN", error: "not found" };
    },
    wahaPoolApagado: () => process.env.WAHA_POOL_APAGADO === "1",
    wahaPoolConfigurado: () => Boolean(process.env.WAHA_POOL_URL),
    poolSimulado: () => process.env.RESPONDO_POOL_SIMULADO === "1",
    normalizeWaId: (raw) => (typeof raw === "string" ? raw : null),
    enviarTextoPool: async () => ({ ok: true, waId: "sim.123" }),
  },
});

const {
  actualizarEstadoSesion,
  revisarSaludPool,
  chequearWahaPool,
} = await import("../lib/poolSalud.ts");
const { elegirNumero } = await import("../lib/poolNumeros.ts");
const { manejarEntranteWahaPool } = await import("../lib/inboundWahaPool.ts");

beforeEach(() => {
  reiniciar();
});

test("Fase 4: actualizarEstadoSesion marca caido, genera alertas y promueve candidato en calentando", async () => {
  const res = await actualizarEstadoSesion("kambak_chip_1", "STOPPED", base);
  assert.equal(res.accion, "marcado_caido");
  assert.equal(res.estado, "caido");

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_ACTIVO);
  assert.equal(chip1.estado, "caido");
  assert.equal(chip1.ultimo_error, "WAHA: STOPPED");

  // El chip en calentando fue promovido a activo
  const chipBackup = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_BACKUP);
  assert.equal(chipBackup.estado, "activo");

  // Se generaron alertas por el caído y por la promoción
  assert.equal(alertasPush.length, 2);
  assert.ok(alertasPush.some((a) => a.payload.cuerpo.includes("ALERTA WAHA: Número kambak_chip_1 quedó CAIDO")));
  assert.ok(alertasPush.some((a) => a.payload.cuerpo.includes("Número kambak_chip_backup promovido a ACTIVO")));

  assert.equal(alertasHQ.length, 2);
  assert.equal(alertasHQ[0].tipo, "error");
});

test("Fase 4: si una sesión en caido vuelve a WORKING, se restaura a activo", async () => {
  // Poner chip 1 en caído
  base.tablas.ed_waha_numeros[0].estado = "caido";
  base.tablas.ed_waha_numeros[0].ultimo_error = "WAHA: STOPPED";

  const res = await actualizarEstadoSesion("kambak_chip_1", "WORKING", base);
  assert.equal(res.accion, "restaurado_activo");
  assert.equal(res.estado, "activo");

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_ACTIVO);
  assert.equal(chip1.estado, "activo");
  assert.equal(chip1.ultimo_error, null);
});

test("Fase 4: revisarSaludPool detecta 3 fallos seguidos, bloquea número y promueve reemplazo", async () => {
  process.env.WAHA_POOL_URL = "https://waha.internal";
  base.tablas.ed_waha_numeros[0].fallos_seguidos = 3;

  const res = await revisarSaludPool(base);
  assert.equal(res.revisados, 2);
  assert.equal(res.bloqueados, 1);
  assert.equal(res.promovidos, 1);

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_ACTIVO);
  assert.equal(chip1.estado, "bloqueado");

  const chipBackup = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_BACKUP);
  assert.equal(chipBackup.estado, "activo");
});

test("Fase 4: revisarSaludPool detecta FAILED desde estadoSesion y marca caido", async () => {
  process.env.WAHA_POOL_URL = "https://waha.internal";
  sesionesWaha.kambak_chip_1 = { ok: false, status: "FAILED", error: "session unreachable" };

  const res = await revisarSaludPool(base);
  assert.equal(res.caidos, 1);
  assert.equal(res.promovidos, 1);

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_ACTIVO);
  assert.equal(chip1.estado, "caido");
});

test("Fase 4: elegirNumero salta números caídos o bloqueados y usa el promovido", async () => {
  // Inicialmente, chip 1 está activo y backup está en calentando
  const numInicial = await elegirNumero(KAMBAK, new Date(), base);
  assert.equal(numInicial.id, NUM_ACTIVO);

  // Cae chip 1 y se promueve backup
  await actualizarEstadoSesion("kambak_chip_1", "FAILED", base);

  // Ahora elegirNumero debe saltar chip 1 y elegir el backup recién promovido
  const numPosterior = await elegirNumero(KAMBAK, new Date(), base);
  assert.equal(numPosterior.id, NUM_BACKUP);
  assert.equal(numPosterior.estado, "activo");
});

test("Fase 4: webhook session.status invoca actualizarEstadoSesion", async () => {
  const payload = {
    event: "session.status",
    session: "kambak_chip_1",
    payload: { status: "STOPPED" },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "session_status");
  assert.ok(res.detalle.includes("kambak_chip_1:STOPPED:marcado_caido"));

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_ACTIVO);
  assert.equal(chip1.estado, "caido");
});

test("Fase 4: chequearWahaPool se omite si WAHA_POOL_URL no está configurada", async () => {
  delete process.env.WAHA_POOL_URL;
  const res = await chequearWahaPool(base);
  assert.equal(res.ok, true);
  assert.equal(res.detalle, "no configurado (omitido)");
});

test("Fase 4: chequearWahaPool responde ok si sesiones activas están sanas", async () => {
  process.env.WAHA_POOL_URL = "https://waha.internal";
  const res = await chequearWahaPool(base);
  assert.equal(res.ok, true);
  assert.ok(res.detalle.includes("número(s) sanos"));
});

test("Fase 4: chequearWahaPool responde degradado (ok=false) si un número activo está caído", async () => {
  process.env.WAHA_POOL_URL = "https://waha.internal";
  sesionesWaha.kambak_chip_1 = { ok: false, status: "STOPPED", error: "Connection closed" };

  const res = await chequearWahaPool(base);
  assert.equal(res.ok, false);
  assert.ok(res.detalle.includes("números con problemas"));
});
