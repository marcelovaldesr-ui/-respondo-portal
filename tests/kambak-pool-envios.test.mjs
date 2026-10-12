/**
 * TESTS FASE 2: Envío de marketing por el pool WAHA detrás del interruptor
 * (lib/kambakEnvios.ts → drenarColaWaha + procesarEnvio con canal_marketing).
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const TINO_K = "11111111-0000-4000-8000-00000000000a";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_envios_api: [{ cols: ["cliente_id", "clave"] }],
      ed_waha_numeros: [{ cols: ["sesion"] }],
    },
  },
);

let enviosMeta = [];

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
  base.tablas.ed_empleados = [{ id: TINO_K, cliente_id: KAMBAK, rol: "tino", activo: true }];
  base.tablas.ed_envios_api = [];
  base.tablas.ed_waha_numeros = [];
  base.tablas.ed_mensajes = [];
  base.tablas.ed_contactos = [];
  enviosMeta = [];

  process.env.RESPONDO_POOL_SIMULADO = "1";
  delete process.env.WAHA_POOL_APAGADO;
  delete process.env.RESPONDO_ENVIOS_SIMULADOS;
  delete process.env.RESPONDO_TOPE_MENSUAL_MARKETING;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/whatsapp.ts"), {
  namedExports: {
    configPorCliente: async (id) => ({ clienteId: id, phoneNumberId: "PH", token: "t" }),
    tinoDe: async (id) => (id === KAMBAK ? TINO_K : null),
    enviarPlantilla: async (_cfg, para, pl) => {
      enviosMeta.push({ para, ...pl });
      return { ok: true, waId: `meta.wamid.${enviosMeta.length}` };
    },
  },
});

const { procesarEnvio, drenarCola, drenarColaWaha } = await import("../lib/kambakEnvios.ts");
const { reiniciarCacheSoloMensajeria } = await import("../lib/soloMensajeria.ts");

beforeEach(() => {
  reiniciar();
  reiniciarCacheSoloMensajeria();
});

const MEDIODIA = new Date("2026-10-15T15:00:00Z"); // 12:00 en Chile
const MADRUGADA = new Date("2026-10-15T05:00:00Z"); // 02:00 en Chile

let n = 0;
const clave = () => `clave-pool-fase2-${++n}`;
const promo = (to, extra = {}) => ({
  to,
  template: "sello_promo",
  language: "es",
  idempotencyKey: clave(),
  variables: ["Camila", "Café Aroma", "2x1 en cafés", "Pide uno y llévate otro.", "el 31 de octubre"],
  ...extra,
});

test("Fase 2: con canal_marketing='meta', marketing sale directo por Meta (regresión)", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "meta";
  const r = await procesarEnvio(KAMBAK, promo("+56911110001"), MEDIODIA);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.status, "sent");
  assert.equal(enviosMeta.length, 1);
  assert.equal(base.tablas.ed_envios_api[0].canal, "meta");
});

test("Fase 2: utility y authentication siempre van por Meta aunque canal_marketing='waha'", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";

  const rUtil = await procesarEnvio(
    KAMBAK,
    {
      to: "+56911110002",
      template: "sello_premio_cerca",
      idempotencyKey: clave(),
      variables: ["Camila", "1 sello", "café gratis", "Café Aroma"],
    },
    MEDIODIA,
  );
  assert.equal(rUtil.status, 200);
  assert.equal(rUtil.cuerpo.status, "sent");
  assert.equal(enviosMeta.length, 1);
  assert.equal(base.tablas.ed_envios_api[0].canal, "meta");

  const rAuth = await procesarEnvio(
    KAMBAK,
    {
      to: "+56911110003",
      template: "sello_codigo",
      idempotencyKey: clave(),
      variables: ["654321"],
    },
    MEDIODIA,
  );
  assert.equal(rAuth.status, 200);
  assert.equal(rAuth.cuerpo.status, "sent");
  assert.equal(enviosMeta.length, 2);
  assert.equal(base.tablas.ed_envios_api[1].canal, "meta");
});

test("Fase 2: con canal_marketing='waha', marketing siempre queda 'queued' en cola para el pool", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";

  const r = await procesarEnvio(KAMBAK, promo("+56911110004"), MEDIODIA);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.status, "queued");
  assert.equal(enviosMeta.length, 0, "no salió por Meta");

  const fila = base.tablas.ed_envios_api[0];
  assert.equal(fila.estado, "en_cola");
  assert.equal(fila.canal, "waha");
  assert.equal(fila.telefono, "56911110004");
});

test("Fase 2: baja y tope mensual se respetan antes de encolar en WAHA", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";
  base.tablas.ed_contactos = [{ cliente_id: KAMBAK, chat_id: "56911110005", etiquetas: ["no_contactar"] }];

  const rBaja = await procesarEnvio(KAMBAK, promo("+56911110005"), MEDIODIA);
  assert.equal(rBaja.cuerpo.status, "skipped");
  assert.equal(rBaja.cuerpo.reason, "opted_out");

  // Tope mensual
  const toCap = "+56911110006";
  for (let i = 0; i < 4; i++) {
    await procesarEnvio(KAMBAK, promo(toCap), MEDIODIA);
  }
  const quinto = await procesarEnvio(KAMBAK, promo(toCap), MEDIODIA);
  assert.equal(quinto.cuerpo.status, "skipped");
  assert.equal(quinto.cuerpo.reason, "monthly_cap");
});

test("Fase 2: drenarColaWaha fuera de horario (madrugada) no envía nada", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";
  await procesarEnvio(KAMBAK, promo("+56911110007"), MADRUGADA);

  const out = await drenarColaWaha(MADRUGADA);
  assert.equal(out.enviados, 0);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");
});

test("Fase 2: contacto sin WhatsApp se marca 'omitido' con motivo 'sin_whatsapp' y no cuenta cupo", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";
  base.tablas.ed_waha_numeros = [
    {
      id: "chip-1",
      cliente_id: KAMBAK,
      sesion: "s1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
  ];

  // En modo simulado números con 569 y 8 dígitos existen; otros no
  // Usamos el override directo de la tabla de envío con un número no-chileno forzado
  await procesarEnvio(KAMBAK, promo("+56911110008"), MEDIODIA);
  base.tablas.ed_envios_api[0].telefono = "12345"; // número inválido que en simulado da existe=false

  const out = await drenarColaWaha(MEDIODIA);
  assert.equal(out.omitidos, 1);
  assert.equal(base.tablas.ed_envios_api[0].estado, "omitido");
  assert.equal(base.tablas.ed_envios_api[0].motivo, "sin_whatsapp");
  assert.equal(base.tablas.ed_waha_numeros[0].enviados_hoy, 0, "no gasta cupo del chip");
});

test("Fase 2: campaña de 50 destinatarios sale repartida entre 2 números simulados respetando pausas y 1 por pasada", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";
  base.tablas.ed_waha_numeros = [
    {
      id: "chip-a",
      cliente_id: KAMBAK,
      sesion: "sesion-a",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
    {
      id: "chip-b",
      cliente_id: KAMBAK,
      sesion: "sesion-b",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
  ];

  // Encolar 50 destinatarios
  for (let i = 1; i <= 50; i++) {
    const cel = `+5692000${String(i).padStart(4, "0")}`;
    const r = await procesarEnvio(KAMBAK, promo(cel), MEDIODIA);
    assert.equal(r.cuerpo.status, "queued");
  }
  assert.equal(base.tablas.ed_envios_api.length, 50);

  // Pasada 1 del cron: exactamente 1 por número (máx 2 envíos)
  let t = new Date(MEDIODIA.getTime());
  const pasada1 = await drenarColaWaha(t);
  assert.equal(pasada1.enviados, 2, "máximo 1 envío por número por pasada");
  assert.equal(base.tablas.ed_waha_numeros[0].enviados_hoy, 1);
  assert.equal(base.tablas.ed_waha_numeros[1].enviados_hoy, 1);

  // Inmediatamente sin avanzar el reloj: ambos están en pausa (proximo_envio_en en el futuro)
  const pasadaInmediata = await drenarColaWaha(t);
  assert.equal(pasadaInmediata.enviados, 0, "en pausa no envía");

  // Drenar el resto avanzando el tiempo entre pasadas (simula corridas del cron cada 2 minutos)
  let totalEnviados = 2;
  while (totalEnviados < 50) {
    t = new Date(t.getTime() + 190_000); // 190 segundos (supera la pausa máxima de 180s)
    const res = await drenarColaWaha(t);
    totalEnviados += res.enviados;
    if (res.enviados === 0) break;
  }

  assert.equal(totalEnviados, 50, "los 50 mensajes salieron");
  assert.equal(base.tablas.ed_waha_numeros[0].enviados_hoy, 25, "reparto parejo en chip A");
  assert.equal(base.tablas.ed_waha_numeros[1].enviados_hoy, 25, "reparto parejo en chip B");

  // Verificar que quedaron registrados en la conversación (bandeja de Kambak)
  const msgs = base.tablas.ed_mensajes;
  assert.equal(msgs.length, 50);
  assert.ok(msgs[0].texto.includes("Responde BAJA"));
  assert.equal(msgs[0].rol, "empleado");
});

test("Fase 2: si se activa el kill switch (WAHA_POOL_APAGADO=1), la cola sale por Meta", async () => {
  base.tablas.ed_clientes[0].canal_marketing = "waha";

  // Encolar con WAHA activo
  await procesarEnvio(KAMBAK, promo("+56911110099"), MEDIODIA);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");
  assert.equal(base.tablas.ed_envios_api[0].canal, "waha");

  // Encender kill switch
  process.env.WAHA_POOL_APAGADO = "1";

  // drenarCola (el drenador normal de Meta) debe tomar la fila y despacharla por Meta
  const outMeta = await drenarCola(MEDIODIA);
  assert.equal(outMeta.enviados, 1);
  assert.equal(enviosMeta.length, 1);
  assert.equal(enviosMeta[0].para, "56911110099");
  assert.equal(base.tablas.ed_envios_api[0].estado, "enviado");
});
