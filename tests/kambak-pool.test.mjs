/**
 * TESTS FASE 1: Cimientos del grupo de números WAHA para Kambak (lib/wahaPool.ts y lib/poolNumeros.ts).
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const CLIENTE_K = "aaaaaaaa-0000-4000-8000-00000000000a";

const base = crearBaseMemoria(
  {},
  { unicos: { ed_waha_numeros: [{ cols: ["sesion"] }] } },
);

function reiniciarBase() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_waha_numeros = [];
  delete process.env.RESPONDO_POOL_SIMULADO;
  delete process.env.WAHA_POOL_URL;
  delete process.env.WAHA_POOL_API_KEY;
  delete process.env.WAHA_POOL_APAGADO;
}

const {
  aDestinoPool,
  normalizeWaId,
  enviarTextoPool,
  existeEnWhatsApp,
  estadoSesion,
  iniciarTipeo,
  pararTipeo,
  poolSimulado,
  wahaPoolConfigurado,
  wahaPoolApagado,
} = await import("../lib/wahaPool.ts");

const {
  topeDelDia,
  enviadosEfectivosHoy,
  elegirNumero,
  registrarEnvio,
  registrarFallo,
  registrarExito,
  fechaChile,
} = await import("../lib/poolNumeros.ts");

beforeEach(() => {
  reiniciarBase();
});

test("wahaPool: formateo de destino y normalización de waId", () => {
  assert.equal(aDestinoPool("+56912345678"), "56912345678@c.us");
  assert.equal(aDestinoPool("56912345678"), "56912345678@c.us");
  assert.equal(aDestinoPool("56912345678@c.us"), "56912345678@c.us");
  assert.equal(aDestinoPool("123456@lid"), "123456@lid");
  assert.equal(aDestinoPool("56912345678@s.whatsapp.net"), "56912345678@c.us");

  assert.equal(normalizeWaId("true_56912345678@c.us_3EB0ABC123"), "3EB0ABC123");
  assert.equal(normalizeWaId("false_123456@lid_ABC999"), "ABC999");
  assert.equal(normalizeWaId("SIMPLEID"), "SIMPLEID");
  assert.equal(normalizeWaId({ id: "false_chat_XYZ" }), "XYZ");
  assert.equal(normalizeWaId(null), null);
});

test("wahaPool: modo simulado genera IDs válidos y no falla", async () => {
  process.env.RESPONDO_POOL_SIMULADO = "1";
  assert.equal(poolSimulado(), true);

  const rEnvio = await enviarTextoPool("sesion1", "+56912345678", "Hola test");
  assert.equal(rEnvio.ok, true);
  assert.match(rEnvio.waId, /^sim\./);

  const rExiste = await existeEnWhatsApp("sesion1", "+56912345678");
  assert.equal(rExiste.ok, true);
  assert.equal(rExiste.existe, true);

  const rNoExiste = await existeEnWhatsApp("sesion1", "12345");
  assert.equal(rNoExiste.ok, true);
  assert.equal(rNoExiste.existe, false);

  const rEstado = await estadoSesion("sesion1");
  assert.equal(rEstado.ok, true);
  assert.equal(rEstado.status, "WORKING");

  assert.equal((await iniciarTipeo("sesion1", "+56912345678")).ok, true);
  assert.equal((await pararTipeo("sesion1", "+56912345678")).ok, true);
});

test("wahaPool: sin configuración ni simulación retorna error limpio", async () => {
  assert.equal(wahaPoolConfigurado(), false);
  const rEnvio = await enviarTextoPool("sesion1", "+56912345678", "Hola");
  assert.equal(rEnvio.ok, false);
  assert.match(rEnvio.error, /Falta WAHA_POOL_URL/);

  const rExiste = await existeEnWhatsApp("sesion1", "+56912345678");
  assert.equal(rExiste.ok, false);

  const rEstado = await estadoSesion("sesion1");
  assert.equal(rEstado.ok, false);
});

test("wahaPool: kill switch WAHA_POOL_APAGADO", () => {
  assert.equal(wahaPoolApagado(), false);
  process.env.WAHA_POOL_APAGADO = "1";
  assert.equal(wahaPoolApagado(), true);
});

test("poolNumeros: topeDelDia respeta rampa de calentamiento", () => {
  const hoy = new Date("2026-10-15T12:00:00Z");

  // Sin calentamiento_desde: tope_diario directo
  assert.equal(topeDelDia({ tope_diario: 150 }), 150);
  assert.equal(topeDelDia({ tope_diario: 80 }), 80);

  // Día 1 (mismo día): 20
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-15", tope_diario: 150 }, hoy), 20);
  // Día 2: 40
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-14", tope_diario: 150 }, hoy), 40);
  // Día 3: 60
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-13", tope_diario: 150 }, hoy), 60);
  // Día 4: 90
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-12", tope_diario: 150 }, hoy), 90);
  // Día 5: 120
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-11", tope_diario: 150 }, hoy), 120);
  // Día 6 en adelante: tope_diario completo
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-10", tope_diario: 150 }, hoy), 150);
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-01", tope_diario: 150 }, hoy), 150);

  // Si tope_diario es menor que el paso de la rampa, manda tope_diario
  assert.equal(topeDelDia({ calentamiento_desde: "2026-10-11", tope_diario: 50 }, hoy), 50);
});

test("poolNumeros: enviadosEfectivosHoy reinicia si el día cambió", () => {
  const ahora = new Date("2026-10-15T15:00:00Z");
  const hoyStr = fechaChile(ahora);

  assert.equal(enviadosEfectivosHoy({ dia: hoyStr, enviados_hoy: 12 }, ahora), 12);
  assert.equal(enviadosEfectivosHoy({ dia: "2026-10-14", enviados_hoy: 50 }, ahora), 0);
  assert.equal(enviadosEfectivosHoy({ dia: null, enviados_hoy: 10 }, ahora), 0);
});

test("poolNumeros: elegirNumero filtra por estado activo y rol envio", async () => {
  const ahora = new Date("2026-10-15T15:00:00Z");
  const hoyStr = fechaChile(ahora);

  base.tablas.ed_waha_numeros = [
    {
      id: "num-calentando",
      cliente_id: CLIENTE_K,
      sesion: "s1",
      estado: "calentando",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: hoyStr,
    },
    {
      id: "num-pausado",
      cliente_id: CLIENTE_K,
      sesion: "s2",
      estado: "pausado",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: hoyStr,
    },
    {
      id: "num-respuesta",
      cliente_id: CLIENTE_K,
      sesion: "s3",
      estado: "activo",
      rol: "respuesta",
      tope_diario: 150,
      enviados_hoy: 0,
      dia: hoyStr,
    },
  ];

  const elegido = await elegirNumero(CLIENTE_K, ahora, base);
  assert.equal(elegido, null, "ningún número activo para envío");
});

test("poolNumeros: elegirNumero respeta pausas y topes, y rota por menor enviado", async () => {
  const ahora = new Date("2026-10-15T15:00:00Z");
  const hoyStr = fechaChile(ahora);

  base.tablas.ed_waha_numeros = [
    {
      id: "num-en-pausa",
      cliente_id: CLIENTE_K,
      sesion: "s-pausa",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 1,
      dia: hoyStr,
      proximo_envio_en: new Date(ahora.getTime() + 60_000).toISOString(), // pausa en el futuro
    },
    {
      id: "num-tope-lleno",
      cliente_id: CLIENTE_K,
      sesion: "s-lleno",
      estado: "activo",
      rol: "envio",
      tope_diario: 10,
      enviados_hoy: 10,
      dia: hoyStr,
    },
    {
      id: "num-disponible-1",
      cliente_id: CLIENTE_K,
      sesion: "s-disp-1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 5,
      dia: hoyStr,
      ultimo_envio_en: "2026-10-15T14:50:00Z",
    },
    {
      id: "num-disponible-2",
      cliente_id: CLIENTE_K,
      sesion: "s-disp-2",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 2,
      dia: hoyStr,
      ultimo_envio_en: "2026-10-15T14:55:00Z",
    },
  ];

  const elegido = await elegirNumero(CLIENTE_K, ahora, base);
  assert.ok(elegido);
  assert.equal(elegido.id, "num-disponible-2", "elige el de menos envíos hoy (2 vs 5)");
});

test("poolNumeros: registrarEnvio actualiza contador, fecha y pausa", async () => {
  const ahora = new Date("2026-10-15T15:00:00Z");
  const hoyStr = fechaChile(ahora);

  base.tablas.ed_waha_numeros = [
    {
      id: "num-1",
      cliente_id: CLIENTE_K,
      sesion: "s1",
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 3,
      dia: hoyStr,
      fallos_seguidos: 2,
    },
  ];

  const res = await registrarEnvio("num-1", ahora, { pausaSegundos: 90 }, base);
  assert.ok(res);
  assert.equal(res.enviados_hoy, 4);
  assert.equal(res.dia, hoyStr);
  assert.equal(res.ultimo_envio_en, ahora.toISOString());
  assert.equal(res.fallos_seguidos, 0, "éxito resetea fallos");
  assert.equal(
    res.proximo_envio_en,
    new Date(ahora.getTime() + 90_000).toISOString(),
    "pausa fijada",
  );
});

test("poolNumeros: registrarFallo bloquea al 3er fallo consecutivo o desconexión", async () => {
  base.tablas.ed_waha_numeros = [
    {
      id: "num-fallas",
      cliente_id: CLIENTE_K,
      sesion: "s-fallas",
      estado: "activo",
      rol: "envio",
      fallos_seguidos: 1,
    },
  ];

  let r = await registrarFallo("num-fallas", "Error temporal 1", base);
  assert.equal(r.fallos, 2);
  assert.equal(r.estado, "activo");

  r = await registrarFallo("num-fallas", "Error temporal 2", base);
  assert.equal(r.fallos, 3);
  assert.equal(r.estado, "bloqueado", "3er fallo bloquea el número");

  // Error explícito de WhatsApp logged out bloquea de inmediato
  base.tablas.ed_waha_numeros[0].estado = "activo";
  base.tablas.ed_waha_numeros[0].fallos_seguidos = 0;
  r = await registrarFallo("num-fallas", "WhatsApp logged out / session terminated", base);
  assert.equal(r.estado, "bloqueado");

  // Registrar éxito limpia fallos
  await registrarExito("num-fallas", base);
  assert.equal(base.tablas.ed_waha_numeros[0].fallos_seguidos, 0);
  assert.equal(base.tablas.ed_waha_numeros[0].ultimo_error, null);
});
