/**
 * TESTS FASE P2: Salud del pool v2 (distinguir WAHA caído de número caído,
 * backoff, deduplicación de alertas y detección sin capacidad).
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const NUM_1 = "11111111-0000-4000-8000-00000000000a";
const NUM_2 = "22222222-0000-4000-8000-00000000000a";
const NUM_BACKUP = "33333333-0000-4000-8000-00000000000a";

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
let alertasPush = [];
let sesionesWaha = {};

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
      id: NUM_1,
      cliente_id: KAMBAK,
      sesion: "chip_1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 5,
      fallos_seguidos: 0,
      ciclos_pausa: 0,
      calentamiento_desde: "2026-10-01",
    },
    {
      id: NUM_2,
      cliente_id: KAMBAK,
      sesion: "chip_2",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 10,
      fallos_seguidos: 0,
      ciclos_pausa: 0,
      calentamiento_desde: "2026-10-01",
    },
    {
      id: NUM_BACKUP,
      cliente_id: KAMBAK,
      sesion: "chip_backup",
      estado: "calentando",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      fallos_seguidos: 0,
      ciclos_pausa: 0,
      calentamiento_desde: "2026-10-05",
    },
  ];
  base.tablas.ed_waha_pool_estado = [
    {
      id: 1,
      pool_inalcanzable_desde: null,
      ultimo_chequeo_en: new Date().toISOString(),
      alerta_inalcanzable_en: null,
    },
  ];

  alertasHQ = [];
  alertasPush = [];
  sesionesWaha = {
    chip_1: { ok: true, status: "WORKING", tipo: "sesion" },
    chip_2: { ok: true, status: "WORKING", tipo: "sesion" },
    chip_backup: { ok: true, status: "WORKING", tipo: "sesion" },
  };

  process.env.WAHA_POOL_URL = "https://waha.internal";
  delete process.env.WAHA_POOL_APAGADO;
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
      return { ok: false, status: "UNKNOWN", tipo: "inalcanzable", error: "not found" };
    },
    wahaPoolApagado: () => process.env.WAHA_POOL_APAGADO === "1",
    wahaPoolConfigurado: () => Boolean(process.env.WAHA_POOL_URL),
    poolSimulado: () => process.env.RESPONDO_POOL_SIMULADO === "1",
  },
});

const {
  revisarSaludPool,
  reiniciarHistorialAlertas,
  alertarSinCapacidadSiCorresponde,
  actualizarEstadoSesion,
} = await import("../lib/poolSalud.ts");

beforeEach(() => {
  reiniciar();
  reiniciarHistorialAlertas();
});

test("P2: si todos los números dan 'inalcanzable', se preserva estado de números y se alerta servidor caído", async () => {
  sesionesWaha.chip_1 = { ok: false, status: "UNKNOWN", tipo: "inalcanzable", error: "ETIMEDOUT" };
  sesionesWaha.chip_2 = { ok: false, status: "UNKNOWN", tipo: "inalcanzable", error: "ETIMEDOUT" };
  sesionesWaha.chip_backup = { ok: false, status: "UNKNOWN", tipo: "inalcanzable", error: "ETIMEDOUT" };

  const res = await revisarSaludPool(base);
  assert.equal(res.inalcanzable, true);
  assert.equal(res.caidos, 0);
  assert.equal(res.bloqueados, 0);

  // Ningún número cambió a caído ni bloqueado
  const num1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  const num2 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_2);
  assert.equal(num1.estado, "activo");
  assert.equal(num2.estado, "activo");

  // Se registró en ed_waha_pool_estado
  const poolEstado = base.tablas.ed_waha_pool_estado[0];
  assert.ok(poolEstado.pool_inalcanzable_desde);

  // Alerta enviada a HQ
  assert.ok(alertasHQ.some((a) => a.detalle.includes("Servidor WAHA inalcanzable")));
});

test("P2: número individual inalcanzable aplica tolerancia (pasa a pausado solo al 2do intento)", async () => {
  // Chip 1 inalcanzable, Chip 2 sano (servidor alcanzable)
  sesionesWaha.chip_1 = { ok: false, status: "UNKNOWN", tipo: "inalcanzable", error: "502 Bad Gateway" };
  sesionesWaha.chip_2 = { ok: true, status: "WORKING", tipo: "sesion" };

  // Pasada 1: tolerancia
  const res1 = await revisarSaludPool(base);
  assert.equal(res1.pausados, 0);
  const num1Intento1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(num1Intento1.estado, "activo");
  assert.equal(num1Intento1.ultimo_error, "waha_inalcanzable_1");

  // Pasada 2: segunda confirmación -> pasa a 'pausado' con 15 min de enfriamiento
  const ahora2 = new Date("2026-10-12T14:00:00Z");
  const res2 = await revisarSaludPool(base, ahora2);
  assert.equal(res2.pausados, 1);
  const num1Intento2 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(num1Intento2.estado, "pausado");
  assert.equal(num1Intento2.ciclos_pausa, 1);
  assert.ok(num1Intento2.pausado_hasta);

  const tPausa = Date.parse(num1Intento2.pausado_hasta);
  assert.equal(tPausa - ahora2.getTime(), 15 * 60 * 1000);
});

test("P2: número pausado se recupera a 'activo' al expirar el enfriamiento si sesión vuelve a WORKING", async () => {
  const tPausa = new Date("2026-10-12T14:15:00Z");
  base.tablas.ed_waha_numeros[0].estado = "pausado";
  base.tablas.ed_waha_numeros[0].pausado_hasta = tPausa.toISOString();
  base.tablas.ed_waha_numeros[0].ciclos_pausa = 1;

  // Si aún no expira el tiempo -> sigue pausado
  const antes = new Date("2026-10-12T14:10:00Z");
  const resAntes = await revisarSaludPool(base, antes);
  assert.equal(resAntes.recuperados, 0);
  assert.equal(base.tablas.ed_waha_numeros[0].estado, "pausado");

  // Pasado el tiempo y sesión WORKING -> recupera a activo
  sesionesWaha.chip_1 = { ok: true, status: "WORKING", tipo: "sesion" };
  const despues = new Date("2026-10-12T14:16:00Z");
  const resDespues = await revisarSaludPool(base, despues);
  assert.equal(resDespues.recuperados, 1);

  const numRecuperado = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(numRecuperado.estado, "activo");
  assert.equal(numRecuperado.pausado_hasta, null);
  assert.equal(numRecuperado.ciclos_pausa, 0);

  // Alerta informativa de recuperación
  assert.ok(alertasHQ.some((a) => a.detalle.includes("RECUPERADO")));
});

test("P2: backoff escala a 1h, 6h y bloquea definitivamente al 3er ciclo sin recuperación", async () => {
  const tPausa = new Date("2026-10-12T14:00:00Z");
  base.tablas.ed_waha_numeros[0].estado = "pausado";
  base.tablas.ed_waha_numeros[0].pausado_hasta = tPausa.toISOString();
  base.tablas.ed_waha_numeros[0].ciclos_pausa = 2; // Ya estaba en ciclo 2

  // Sesión sigue caída tras expirar
  sesionesWaha.chip_1 = { ok: false, status: "STOPPED", tipo: "sesion" };
  const despues = new Date("2026-10-12T14:05:00Z");
  const res = await revisarSaludPool(base, despues);

  // Pasa a bloqueado (3 ciclos cumplidos)
  assert.equal(res.bloqueados, 1);
  const numBloqueado = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(numBloqueado.estado, "bloqueado");
});

test("P2: señal clara de ban o desconexión (UNPAIRED) bloquea inmediatamente", async () => {
  sesionesWaha.chip_1 = { ok: false, status: "UNPAIRED", tipo: "sesion", error: "account logged out" };

  const res = await revisarSaludPool(base);
  assert.equal(res.bloqueados, 1);
  const numBloqueado = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(numBloqueado.estado, "bloqueado");

  // El backup fue promovido a activo
  const backup = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_BACKUP);
  assert.equal(backup.estado, "activo");
});

test("P2: deduplicación de alertas evita spam de la misma incidencia en menos de 1 hora", async () => {
  sesionesWaha.chip_1 = { ok: false, status: "STOPPED", tipo: "sesion" };

  // Pasada 1 -> Alerta emitida
  const t1 = new Date("2026-10-12T14:00:00Z");
  await revisarSaludPool(base, t1);
  assert.equal(alertasHQ.length, 2); // 1 caido + 1 promovido

  // Pasada 2 a los 10 minutos -> No repite alerta del chip 1
  const t2 = new Date("2026-10-12T14:10:00Z");
  await revisarSaludPool(base, t2);
  assert.equal(alertasHQ.length, 2); // Sigue en 2
});

test("P2: alerta de falta de capacidad si quedan 0 números activos con cupo en horario hábil", async () => {
  // Poner todos en tope alcanzado para hoy
  const hoyStr = "2026-10-12";
  base.tablas.ed_waha_numeros[0].dia = hoyStr;
  base.tablas.ed_waha_numeros[0].enviados_hoy = 150;
  base.tablas.ed_waha_numeros[1].dia = hoyStr;
  base.tablas.ed_waha_numeros[1].enviados_hoy = 150;

  // 15:00 hora de Chile (horario hábil 09:00 - 21:00)
  // UTC 18:00 = 15:00 Chile (UTC-3)
  const ahoraHabil = new Date("2026-10-12T18:00:00Z");
  const alerto = await alertarSinCapacidadSiCorresponde(base.tablas.ed_waha_numeros, ahoraHabil);
  assert.equal(alerto, true);
  assert.ok(alertasHQ.some((a) => a.detalle.includes("Sin capacidad de envío en horario hábil")));

  // Madrugada de Chile (04:00 UTC = 01:00 Chile): fuera de horario -> no alerta
  alertasHQ = [];
  reiniciarHistorialAlertas();
  const ahoraMadrugada = new Date("2026-10-12T04:00:00Z");
  const alertoMadrugada = await alertarSinCapacidadSiCorresponde(base.tablas.ed_waha_numeros, ahoraMadrugada);
  assert.equal(alertoMadrugada, false);
});

test("P2: webhook session.status WORKING recupera número pausado a activo", async () => {
  base.tablas.ed_waha_numeros[0].estado = "pausado";
  base.tablas.ed_waha_numeros[0].pausado_hasta = "2026-10-12T15:00:00Z";
  base.tablas.ed_waha_numeros[0].ciclos_pausa = 1;

  const res = await actualizarEstadoSesion("chip_1", "WORKING", base);
  assert.equal(res.accion, "restaurado_activo");
  assert.equal(res.estado, "activo");

  const chip1 = base.tablas.ed_waha_numeros.find((n) => n.id === NUM_1);
  assert.equal(chip1.estado, "activo");
  assert.equal(chip1.pausado_hasta, null);
  assert.equal(chip1.ciclos_pausa, 0);
});
