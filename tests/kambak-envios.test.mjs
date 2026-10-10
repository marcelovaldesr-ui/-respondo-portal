/**
 * API DE ENVÍO PARA KAMBAK (/api/externo/mensajes → lib/kambakEnvios.ts).
 * Base en memoria; Meta reemplazado por un testigo. No sale ningún mensaje real.
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";
const TINO_K = "11111111-0000-4000-8000-00000000000a";

const base = crearBaseMemoria(
  {},
  { unicos: { ed_envios_api: [{ cols: ["cliente_id", "clave"] }] } },
);
let envios = [];
let sinConfig = false;

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true },
    { id: OTRO, nombre: "Otro", activo: true, solo_mensajeria: false },
  ];
  base.tablas.ed_empleados = [{ id: TINO_K, cliente_id: KAMBAK, rol: "tino", activo: true }];
  envios = [];
  sinConfig = false;
  delete process.env.RESPONDO_ENVIOS_SIMULADOS;
  delete process.env.RESPONDO_TOPE_MENSUAL_MARKETING;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/whatsapp.ts"), {
  namedExports: {
    configPorCliente: async (id) => (sinConfig ? null : { clienteId: id, phoneNumberId: "PH", token: "t" }),
    tinoDe: async (id) => (id === KAMBAK ? TINO_K : null),
    enviarPlantilla: async (cfg, para, pl) => {
      envios.push({ para, ...pl });
      return { ok: true, waId: `wamid.${envios.length}` };
    },
  },
});

const { procesarEnvio, drenarCola, normalizarCelularCL, proximaVentana, enHorarioPermitido, mesChile } =
  await import("../lib/kambakEnvios.ts");
const { PLANTILLAS_KAMBAK, validarPlantillaKambak } = await import("../lib/plantillasKambak.ts");
const { reiniciarCacheSoloMensajeria } = await import("../lib/soloMensajeria.ts");

beforeEach(() => { reiniciar(); reiniciarCacheSoloMensajeria(); });

const MEDIODIA = new Date("2026-10-14T15:00:00Z"); // 12:00 en Chile
const MADRUGADA = new Date("2026-10-14T05:00:00Z"); // 02:00 en Chile

let n = 0;
const clave = () => `clave-prueba-${++n}`;
const promo = (to, extra = {}) => ({
  to, template: "sello_promo", language: "es", idempotencyKey: clave(),
  variables: ["Camila", "Café Aroma", "2x1 en cafés", "Pide uno y llévate otro.", "el 31 de octubre"],
  ...extra,
});

test("número inválido → 422 y no sale nada", async () => {
  for (const malo of ["12345", "+56 2 2345 6789", "56812345678", "+5691234567", 56912345678, null]) {
    const r = await procesarEnvio(KAMBAK, promo(malo), MEDIODIA);
    assert.equal(r.status, 422, String(malo));
  }
  assert.equal(envios.length, 0);
});

test("acepta formatos habituales del mismo celular", () => {
  for (const ok of ["+56912345678", "56912345678", "+56 9 1234 5678", "+56-9-1234-5678"]) {
    assert.equal(normalizarCelularCL(ok), "56912345678");
  }
});

test("plantilla no registrada o variables mal → 422", async () => {
  let r = await procesarEnvio(KAMBAK, promo("+56911110001", { template: "moto_lista" }), MEDIODIA);
  assert.equal(r.status, 422);
  r = await procesarEnvio(KAMBAK, promo("+56911110001", { template: "constructor" }), MEDIODIA);
  assert.equal(r.status, 422);
  r = await procesarEnvio(KAMBAK, promo("+56911110001", { variables: ["solo uno"] }), MEDIODIA);
  assert.equal(r.status, 422);
  r = await procesarEnvio(KAMBAK, promo("+56911110001", { variables: ["", "a", "b", "c", "d"] }), MEDIODIA);
  assert.equal(r.status, 422);
  r = await procesarEnvio(KAMBAK, promo("+56911110001", { language: "en" }), MEDIODIA);
  assert.equal(r.status, 422);
  r = await procesarEnvio(KAMBAK, promo("+56911110001", { idempotencyKey: "x" }), MEDIODIA);
  assert.equal(r.status, 400);
  assert.equal(envios.length, 0);
});

test("una cuenta que no es de solo mensajería no puede usar esta API", async () => {
  const r = await procesarEnvio(OTRO, promo("+56911110002"), MEDIODIA);
  assert.equal(r.status, 403);
  assert.equal(envios.length, 0);
});

test("envío normal: sale una vez, queda registrado sin datos personales y aparece en la bandeja", async () => {
  const r = await procesarEnvio(KAMBAK, promo("+56 9 1111 0003"), MEDIODIA);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.status, "sent");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].para, "56911110003");
  assert.equal(envios[0].nombre, "sello_promo");
  assert.equal(envios[0].params[0], "Camila");

  const fila = base.tablas.ed_envios_api[0];
  assert.equal(fila.estado, "enviado");
  assert.equal(fila.telefono, null, "el teléfono no se guarda tras enviar");
  assert.equal(fila.variables, null, "las variables no se guardan tras enviar");
  assert.equal(fila.wamid, "wamid.1");
  assert.ok(!JSON.stringify(fila).includes("56911110003"));

  const msg = base.tablas.ed_mensajes.find((m) => m.chat_id === "56911110003");
  assert.ok(msg?.texto.includes("Responde BAJA"), "la bandeja ve lo que recibió la persona");
});

test("idempotencia: la misma clave no vuelve a enviar", async () => {
  const cuerpo = promo("+56911110004");
  const a = await procesarEnvio(KAMBAK, cuerpo, MEDIODIA);
  const b = await procesarEnvio(KAMBAK, { ...cuerpo }, MEDIODIA);
  assert.equal(envios.length, 1);
  assert.equal(b.cuerpo.duplicate, true);
  assert.equal(b.cuerpo.id, a.cuerpo.id);
});

test("número dado de baja: se omite; el código de verificación sí sale", async () => {
  base.tablas.ed_contactos = [{ cliente_id: KAMBAK, chat_id: "56911110005", etiquetas: ["no_contactar"] }];
  const r = await procesarEnvio(KAMBAK, promo("+56911110005"), MEDIODIA);
  assert.equal(r.cuerpo.status, "skipped");
  assert.equal(r.cuerpo.reason, "opted_out");
  const u = await procesarEnvio(KAMBAK, {
    to: "+56911110005", template: "sello_premio_cerca", idempotencyKey: clave(),
    variables: ["Camila", "2", "café gratis", "Café Aroma"],
  }, MEDIODIA);
  assert.equal(u.cuerpo.reason, "opted_out", "utility también respeta la baja");
  assert.equal(envios.length, 0);

  const c = await procesarEnvio(KAMBAK, {
    to: "+56911110005", template: "sello_codigo", idempotencyKey: clave(), variables: ["482913"],
  }, MADRUGADA);
  assert.equal(c.cuerpo.status, "sent", "el código sale aunque haya baja y sea de noche");
  assert.equal(envios[0].params[0], "482913");
  assert.equal(envios[0].botonUrl, "482913", "el código va también en el botón");
  const msg = base.tablas.ed_mensajes.find((m) => m.chat_id === "56911110005");
  assert.ok(!msg.texto.includes("482913"), "el código no queda en la conversación");
});

test("tope mensual por número: marketing se corta, utility no", async () => {
  const to = "+56911110006";
  for (let i = 0; i < 4; i++) {
    assert.equal((await procesarEnvio(KAMBAK, promo(to), MEDIODIA)).cuerpo.status, "sent");
  }
  const quinto = await procesarEnvio(KAMBAK, promo(to), MEDIODIA);
  assert.equal(quinto.cuerpo.status, "skipped");
  assert.equal(quinto.cuerpo.reason, "monthly_cap");
  assert.equal(envios.length, 4);

  const util = await procesarEnvio(KAMBAK, {
    to, template: "sello_premio_cerca", idempotencyKey: clave(),
    variables: ["Camila", "1", "café gratis", "Café Aroma"],
  }, MEDIODIA);
  assert.equal(util.cuerpo.status, "sent");

  // Otro número y el mes siguiente parten de cero.
  assert.equal((await procesarEnvio(KAMBAK, promo("+56911110007"), MEDIODIA)).cuerpo.status, "sent");
  assert.equal((await procesarEnvio(KAMBAK, promo(to), new Date("2026-11-03T15:00:00Z"))).cuerpo.status, "sent");
});

test("el tope es configurable por variable de entorno", async () => {
  process.env.RESPONDO_TOPE_MENSUAL_MARKETING = "1";
  const to = "+56911110008";
  assert.equal((await procesarEnvio(KAMBAK, promo(to), MEDIODIA)).cuerpo.status, "sent");
  assert.equal((await procesarEnvio(KAMBAK, promo(to), MEDIODIA)).cuerpo.reason, "monthly_cap");
});

test("fuera de horario queda en cola; a las 9:00 sale una sola vez", async () => {
  const to = "+56911110009";
  const r = await procesarEnvio(KAMBAK, promo(to), MADRUGADA);
  assert.equal(r.cuerpo.status, "queued");
  assert.equal(envios.length, 0);
  assert.equal(base.tablas.ed_envios_api[0].estado, "en_cola");

  // De madrugada el cron no lo suelta.
  await drenarCola(MADRUGADA);
  assert.equal(envios.length, 0);

  const nueve = proximaVentana(MADRUGADA);
  assert.equal(enHorarioPermitido(nueve), true);
  assert.equal(enHorarioPermitido(new Date(nueve.getTime() - 15 * 60_000)), false);

  const out = await drenarCola(nueve);
  assert.equal(out.enviados, 1);
  assert.equal(envios.length, 1);
  assert.equal(base.tablas.ed_envios_api[0].telefono, null);
  await drenarCola(nueve);
  assert.equal(envios.length, 1, "no se repite");
});

test("si entre el pedido y la mañana el número dijo BAJA, la cola no lo envía", async () => {
  const to = "+56911110010";
  await procesarEnvio(KAMBAK, promo(to), MADRUGADA);
  base.tablas.ed_contactos = [{ cliente_id: KAMBAK, chat_id: "56911110010", etiquetas: ["no_contactar"] }];
  const out = await drenarCola(proximaVentana(MADRUGADA));
  assert.equal(out.omitidos, 1);
  assert.equal(envios.length, 0);
  assert.equal(base.tablas.ed_envios_api[0].motivo, "opted_out");
});

test("horario: 21:00 en Chile ya no sale y 9:00 sí", () => {
  assert.equal(enHorarioPermitido(new Date("2026-10-14T11:59:00Z")), false); // 08:59
  assert.equal(enHorarioPermitido(new Date("2026-10-14T12:00:00Z")), true); // 09:00
  assert.equal(enHorarioPermitido(new Date("2026-10-15T00:00:00Z")), false); // 21:00
  assert.equal(mesChile(new Date("2026-11-01T01:00:00Z")), "2026-10"); // aún 31-oct en Chile
});

test("modo simulado: hace todo menos llamar a Meta", async () => {
  process.env.RESPONDO_ENVIOS_SIMULADOS = "1";
  sinConfig = true;
  const r = await procesarEnvio(KAMBAK, promo("+56911110011"), MEDIODIA);
  assert.equal(r.cuerpo.status, "sent");
  assert.equal(envios.length, 0);
  assert.match(base.tablas.ed_envios_api[0].wamid, /^sim\./);
});

test("sin WhatsApp configurado (y sin simulación) → 503 y no deja registro", async () => {
  sinConfig = true;
  const r = await procesarEnvio(KAMBAK, promo("+56911110012"), MEDIODIA);
  assert.equal(r.status, 503);
  assert.equal((base.tablas.ed_envios_api ?? []).length, 0);
});

test("catálogo de Kambak: nombres, categorías y orden de variables acordados", () => {
  const esperado = {
    sello_premio_cerca: ["utility", ["nombre", "faltan", "premio", "local"]],
    sello_promo: ["marketing", ["nombre", "local", "titulo", "detalle", "hasta"]],
    sello_evento: ["marketing", ["nombre", "local", "titulo", "detalle", "fecha"]],
    sello_rescate: ["marketing", ["nombre", "local", "detalle"]],
    sello_cerca: ["marketing", ["nombre", "local", "sellos", "meta"]],
    sello_codigo: ["authentication", ["codigo"]],
  };
  assert.deepEqual(Object.keys(PLANTILLAS_KAMBAK).sort(), Object.keys(esperado).sort());
  for (const [nombre, [cat, vars]] of Object.entries(esperado)) {
    const p = PLANTILLAS_KAMBAK[nombre];
    assert.equal(p.categoria, cat, nombre);
    assert.equal(p.variables.length, vars.length, nombre);
    assert.deepEqual(validarPlantillaKambak(p), [], nombre);
  }
});

test("códigos de verificación: tope por número para que nadie inunde a una persona", async () => {
  const to = "+56911110013";
  const estados = [];
  for (let i = 0; i < 7; i++) {
    const r = await procesarEnvio(KAMBAK, { to, template: "sello_codigo", idempotencyKey: clave(), variables: ["123456"] }, MEDIODIA);
    estados.push(r.status);
  }
  assert.deepEqual(estados, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal(envios.length, 5);
});
