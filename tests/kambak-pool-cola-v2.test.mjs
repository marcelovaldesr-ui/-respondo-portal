/**
 * TESTS FASE P4: Cola robusta, justicia round-robin entre locales, expiración (48h),
 * reaper (>3m), sin capacidad con fallback configurable y horario dinámico de Chile.
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const TINO = "11111111-0000-4000-8000-00000000000a";
const CHIP_A = "chip-a-0000-00000000000a";
const CHIP_B = "chip-b-0000-00000000000b";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_envios_api: [{ cols: ["cliente_id", "clave"] }],
      ed_waha_numeros: [{ cols: ["sesion"] }],
      ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }],
    },
  },
);

let enviosRealizados = [];
let eventosSalida = [];

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
  base.tablas.ed_empleados = [{ id: TINO, cliente_id: KAMBAK, rol: "tino", activo: true }];
  base.tablas.ed_envios_api = [
    // Se poblarán en cada test
  ];
  base.tablas.ed_waha_numeros = [
    {
      id: CHIP_A,
      cliente_id: KAMBAK,
      sesion: "chip_a",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
    {
      id: CHIP_B,
      cliente_id: KAMBAK,
      sesion: "chip_b",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
  ];
  base.tablas.ed_mensajes = [];
  base.tablas.ed_contactos = [];
  base.tablas.ed_eventos_salida = [];

  enviosRealizados = [];
  eventosSalida = [];

  process.env.RESPONDO_POOL_SIMULADO = "1";
  process.env.KAMBAK_WEBHOOK_URL = "https://www.kambak.cl/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = "test-secret";
  delete process.env.WAHA_POOL_APAGADO;
  delete process.env.WAHA_POOL_FALLBACK_META;
  delete process.env.WAHA_POOL_COLA_MAX_HORAS;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    wahaPoolApagado: () => process.env.WAHA_POOL_APAGADO === "1",
    poolSimulado: () => process.env.RESPONDO_POOL_SIMULADO === "1",
    existeEnWhatsApp: async () => ({ ok: true, existe: true }),
    iniciarTipeo: async () => ({ ok: true }),
    pararTipeo: async () => ({ ok: true }),
    enviarTextoPool: async (sesion, destino, texto) => {
      enviosRealizados.push({ sesion, destino, texto });
      return { ok: true, waId: `waha_out_${Date.now()}_${Math.random()}` };
    },
  },
});
mock.module(url("../lib/webhookSalida.ts"), {
  namedExports: {
    emitirEvento: async (clienteId, tipo, clave, payload) => {
      eventosSalida.push({ clienteId, tipo, clave, payload });
      return { ok: true };
    },
  },
});

const {
  drenarColaWaha,
  procesarEnvio,
  reaperEnviosWaha,
  expirarColaWaha,
  enHorarioPermitido,
  intercalarPorOrigenRef,
} = await import("../lib/kambakEnvios.ts");

beforeEach(() => {
  reiniciar();
});

const MEDIODIA = new Date("2026-10-15T15:00:00Z"); // 12:00 mediodía en Chile

let n = 0;
const promo = (to, extra = {}) => ({
  to,
  template: "sello_promo",
  language: "es",
  idempotencyKey: `idemp-p4-${++n}`,
  variables: ["Camila", "Café", "2x1", "Hoy", "31 oct"],
  ...extra,
});

test("P4: justicia round-robin entre locales evita que un local grande monopolice el pool", async () => {
  // Encolar 5 mensajes para local_a y 1 mensaje para local_b
  for (let i = 1; i <= 5; i++) {
    await procesarEnvio(KAMBAK, promo(`+5691000000${i}`, { origen_ref: "local_a" }), MEDIODIA);
  }
  await procesarEnvio(KAMBAK, promo("+56920000001", { origen_ref: "local_b" }), MEDIODIA);

  assert.equal(base.tablas.ed_envios_api.length, 6);

  // En la primera pasada con 2 chips disponibles, deben salir 1 de local_a y 1 de local_b
  const res = await drenarColaWaha(MEDIODIA);
  assert.equal(res.enviados, 2);

  const enviados = base.tablas.ed_envios_api.filter((e) => e.estado === "enviado");
  assert.equal(enviados.length, 2);

  const localesEnviados = enviados.map((e) => e.origen_ref);
  assert.ok(localesEnviados.includes("local_a"));
  assert.ok(localesEnviados.includes("local_b"), "local_b fue atendido en el primer turno por justicia");
});

test("P4: intercalarPorOrigenRef alterna equitativamente grupos de distinto tamaño", () => {
  const filas = [
    { id: "1", origen_ref: "A" },
    { id: "2", origen_ref: "A" },
    { id: "3", origen_ref: "A" },
    { id: "4", origen_ref: "B" },
    { id: "5", origen_ref: "B" },
    { id: "6", origen_ref: "C" },
  ];

  const intercaladas = intercalarPorOrigenRef(filas);
  const ordenRefs = intercaladas.map((f) => f.origen_ref);

  // Primer ciclo: A, B, C
  assert.equal(ordenRefs[0], "A");
  assert.equal(ordenRefs[1], "B");
  assert.equal(ordenRefs[2], "C");
  // Segundo ciclo: A, B
  assert.equal(ordenRefs[3], "A");
  assert.equal(ordenRefs[4], "B");
  // Tercer ciclo: A
  assert.equal(ordenRefs[5], "A");
});

test("P4: expiración (48h) marca como fallido 'expirado' avisos viejos en cola", async () => {
  // Aviso encolado hace 50 horas
  const hace50Horas = new Date(MEDIODIA.getTime() - 50 * 3600 * 1000);
  base.tablas.ed_envios_api.push({
    id: "env-expirado-1",
    cliente_id: KAMBAK,
    clave: "clave-exp-1",
    plantilla: "sello_promo",
    categoria: "marketing",
    canal: "waha",
    estado: "en_cola",
    programado_para: hace50Horas.toISOString(),
    creado_en: hace50Horas.toISOString(),
  });

  const expirados = await expirarColaWaha(base, MEDIODIA);
  assert.equal(expirados, 1);

  const fila = base.tablas.ed_envios_api.find((e) => e.id === "env-expirado-1");
  assert.equal(fila.estado, "fallido");
  assert.equal(fila.motivo, "expirado");
  assert.equal(fila.ultimo_error, "expirado");

  // Evento terminal message.status 'failed' (reason: expired)
  assert.ok(eventosSalida.some((e) => e.payload.status === "failed" && e.payload.reason === "expired"));
});

test("P4: reaper limpia envíos colgados >3m: recupera con wamid y marca estado_incierto sin wamid", async () => {
  const hace5Min = new Date(MEDIODIA.getTime() - 5 * 60 * 1000).toISOString();

  // Caso 1: se colgó pero alcanzó a tener wamid -> recuperado a enviado
  base.tablas.ed_envios_api.push({
    id: "env-reaper-ok",
    cliente_id: KAMBAK,
    clave: "clave-reaper-1",
    plantilla: "sello_promo",
    categoria: "marketing",
    canal: "waha",
    estado: "enviando",
    wamid: "wamid_exitoso_123",
    actualizado_en: hace5Min,
  });

  // Caso 2: se colgó sin wamid -> estado_incierto (preferimos perder que duplicar)
  base.tablas.ed_envios_api.push({
    id: "env-reaper-fail",
    cliente_id: KAMBAK,
    clave: "clave-reaper-2",
    plantilla: "sello_promo",
    categoria: "marketing",
    canal: "waha",
    estado: "enviando",
    wamid: null,
    actualizado_en: hace5Min,
  });

  const res = await reaperEnviosWaha(base, MEDIODIA);
  assert.equal(res.recuperados, 1);
  assert.equal(res.inciertos, 1);

  const filaOk = base.tablas.ed_envios_api.find((e) => e.id === "env-reaper-ok");
  assert.equal(filaOk.estado, "enviado");

  const filaIncierta = base.tablas.ed_envios_api.find((e) => e.id === "env-reaper-fail");
  assert.equal(filaIncierta.estado, "fallido");
  assert.equal(filaIncierta.motivo, "estado_incierto");
  assert.equal(filaIncierta.ultimo_error, "reaper_timeout_sin_wamid");

  // Evento emitido a Kambak por estado_incierto
  assert.ok(eventosSalida.some((e) => e.payload.status === "failed" && e.payload.reason === "uncertain"));
});

test("P4: fallback a Meta solo se activa con WAHA_POOL_FALLBACK_META=1", async () => {
  // Sin números en el pool
  base.tablas.ed_waha_numeros = [];

  await procesarEnvio(KAMBAK, promo("+56988889999"), MEDIODIA);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // Por defecto (WAHA_POOL_FALLBACK_META=0) -> no sale por Meta, espera en cola
  delete process.env.WAHA_POOL_FALLBACK_META;
  const resDefault = await drenarColaWaha(MEDIODIA);
  assert.equal(resDefault.enviados, 0);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // Con flag activado -> drena vía fallback
  process.env.WAHA_POOL_FALLBACK_META = "1";
  const resFallback = await drenarColaWaha(MEDIODIA);
  assert.equal(typeof resFallback.enviados, "number");
});

test("P4: horario hábil Chile respeta transiciones de horario de verano (DST) dinámicamente", () => {
  // En Chile (America/Santiago):
  // Invierno (UTC-4): entre abril y septiembre.
  // Verano (UTC-3): entre septiembre y abril.

  // 1) En invierno (ej: 15 de julio de 2026):
  // 13:00 UTC = 09:00 Chile (inicio horario hábil)
  const invierno9am = new Date("2026-07-15T13:00:00Z");
  assert.equal(enHorarioPermitido(invierno9am), true);

  // 12:59 UTC = 08:59 Chile (antes de horario hábil)
  const invierno859am = new Date("2026-07-15T12:59:00Z");
  assert.equal(enHorarioPermitido(invierno859am), false);

  // 2) En verano (ej: 15 de enero de 2026):
  // 12:00 UTC = 09:00 Chile (inicio horario hábil en verano UTC-3)
  const verano9am = new Date("2026-01-15T12:00:00Z");
  assert.equal(enHorarioPermitido(verano9am), true);

  // 11:59 UTC = 08:59 Chile (antes de horario hábil en verano)
  const verano859am = new Date("2026-01-15T11:59:00Z");
  assert.equal(enHorarioPermitido(verano859am), false);

  // 23:59 UTC = 20:59 Chile (dentro de horario)
  const verano2059 = new Date("2026-01-15T23:59:00Z");
  assert.equal(enHorarioPermitido(verano2059), true);

  // 00:00 UTC (16 de enero) = 21:00 Chile (cierre de horario)
  const verano2100 = new Date("2026-01-16T00:00:00Z");
  assert.equal(enHorarioPermitido(verano2100), false);
});
