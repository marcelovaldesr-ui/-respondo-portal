/**
 * TESTS FASE P3: Envío robusto, tiempo controlado, reintentos con failover,
 * idempotencia fuerte y kill switch en tiempo real.
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const TINO = "11111111-0000-4000-8000-00000000000a";
const CHIP_A = "chip-uuid-a000-00000000000a";
const CHIP_B = "chip-uuid-b000-00000000000b";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_envios_api: [{ cols: ["cliente_id", "clave"] }],
      ed_waha_numeros: [{ cols: ["sesion"] }],
    },
  },
);

let enviosRealizados = [];
let fallosInyectados = {};

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
  base.tablas.ed_envios_api = [];
  base.tablas.ed_waha_numeros = [
    {
      id: CHIP_A,
      cliente_id: KAMBAK,
      sesion: "sesion_a",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
    {
      id: CHIP_B,
      cliente_id: KAMBAK,
      sesion: "sesion_b",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: "2026-10-15",
    },
  ];
  base.tablas.ed_mensajes = [];
  base.tablas.ed_contactos = [];

  enviosRealizados = [];
  fallosInyectados = {};

  process.env.RESPONDO_POOL_SIMULADO = "1";
  delete process.env.WAHA_POOL_APAGADO;
  delete process.env.WAHA_POOL_SIMULAR_DELAY;
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
      if (fallosInyectados[sesion]) {
        return { ok: false, error: fallosInyectados[sesion] };
      }
      enviosRealizados.push({ sesion, destino, texto });
      return { ok: true, waId: `waha_msg_${Date.now()}_${Math.random()}` };
    },
  },
});

const { drenarColaWaha, procesarEnvio } = await import("../lib/kambakEnvios.ts");

beforeEach(() => {
  reiniciar();
});

const MEDIODIA = new Date("2026-10-15T15:00:00Z"); // 12:00 en Chile

let n = 0;
const promo = (to, extra = {}) => ({
  to,
  template: "sello_promo",
  language: "es",
  idempotencyKey: `idemp-p3-${++n}`,
  variables: ["Camila", "Café Central", "2x1", "Válido hoy", "31 oct"],
  ...extra,
});

test("P3: fallo transitorio aplica backoff, excluye el número que falló y reintenta con otro número (failover)", async () => {
  await procesarEnvio(KAMBAK, promo("+56911112222"), MEDIODIA);
  assert.equal(base.tablas.ed_envios_api.length, 1);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // Inyectar fallo transitorio en sesion_a
  fallosInyectados.sesion_a = "504 Gateway Timeout";

  // Pasada 1: chip_a intenta enviar y falla
  const res1 = await drenarColaWaha(MEDIODIA);
  assert.equal(res1.fallidos, 1);

  const envioPostFallo = base.tablas.ed_envios_api[0];
  assert.equal(envioPostFallo.estado, "en_cola");
  assert.equal(envioPostFallo.intentos, 1);
  assert.equal(envioPostFallo.numero_id, CHIP_A, "guarda que falló en chip A");
  assert.ok(envioPostFallo.proximo_intento_en);

  // Antes de proximo_intento_en -> no intenta
  const antes = new Date(MEDIODIA.getTime() + 60_000);
  const resAntes = await drenarColaWaha(antes);
  assert.equal(resAntes.enviados, 0);

  // Al llegar proximo_intento_en -> failover: se le asigna a sesion_b (excluyendo chip_a)
  const horaReintento = new Date(envioPostFallo.proximo_intento_en);
  const res2 = await drenarColaWaha(horaReintento);
  assert.equal(res2.enviados, 1);

  assert.equal(enviosRealizados.length, 1);
  assert.equal(enviosRealizados[0].sesion, "sesion_b", "salió por chip B gracias al failover");

  const envioExitoso = base.tablas.ed_envios_api[0];
  assert.equal(envioExitoso.estado, "enviado");
  assert.ok(envioExitoso.wamid);
});

test("P3: error transitorio repetido alcanza 3 intentos y se cierra definitivamente como fallido", async () => {
  await procesarEnvio(KAMBAK, promo("+56933334444"), MEDIODIA);

  // Fallo en ambas sesiones
  fallosInyectados.sesion_a = "500 Internal Server Error";
  fallosInyectados.sesion_b = "500 Internal Server Error";

  let t = new Date(MEDIODIA.getTime());

  // Intento 1
  await drenarColaWaha(t);
  assert.equal(base.tablas.ed_envios_api[0].intentos, 1);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // Intento 2
  t = new Date(Date.parse(base.tablas.ed_envios_api[0].proximo_intento_en) + 1000);
  await drenarColaWaha(t);
  assert.equal(base.tablas.ed_envios_api[0].intentos, 2);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // Intento 3 -> cierre definitivo
  t = new Date(Date.parse(base.tablas.ed_envios_api[0].proximo_intento_en) + 1000);
  const res3 = await drenarColaWaha(t);
  assert.equal(res3.fallidos, 1);

  const envioFinal = base.tablas.ed_envios_api[0];
  assert.equal(envioFinal.estado, "fallido");
  assert.equal(envioFinal.motivo, "max_intentos");
  assert.equal(envioFinal.intentos, 3);
});

test("P3: idempotencia fuerte - reclamos simultáneos no duplican envíos", async () => {
  await procesarEnvio(KAMBAK, promo("+56955556666"), MEDIODIA);
  assert.equal(base.tablas.ed_envios_api.length, 1);

  // Simular dos pasadas de cron ejecutándose en paralelo sobre la misma cola
  const [pasada1, pasada2] = await Promise.all([
    drenarColaWaha(MEDIODIA),
    drenarColaWaha(MEDIODIA),
  ]);

  const totalEnviados = pasada1.enviados + pasada2.enviados;
  assert.equal(totalEnviados, 1, "exactamente una pasada logró reclamar y enviar");
  assert.equal(enviosRealizados.length, 1, "solo se hizo un envío a WhatsApp");
  assert.equal(base.tablas.ed_envios_api[0].estado, "enviado");
});

test("P3: kill switch activado detiene el envío en tiempo real", async () => {
  await procesarEnvio(KAMBAK, promo("+56977778888"), MEDIODIA);

  process.env.WAHA_POOL_APAGADO = "1";
  const res = await drenarColaWaha(MEDIODIA);

  assert.equal(res.enviados, 0);
  assert.equal(enviosRealizados.length, 0);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");
});
