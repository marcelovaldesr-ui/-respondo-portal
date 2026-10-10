/**
 * WEBHOOK DE SALIDA HACIA KAMBAK + BAJA NATIVA.
 * Base en memoria; el destino de Kambak y Meta son testigos. No sale nada real.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";
const TINO_K = "11111111-0000-4000-8000-00000000000a";
const SECRETO = "secreto-de-prueba";

const base = crearBaseMemoria({}, {
  unicos: { ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }] },
});
let modeloLlamado = 0;
mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/gemini.ts"), { namedExports: { generarJSON: async () => { modeloLlamado++; return {}; } } });

const { emitirEvento, reiniciarPausaWebhook, procesarEventosPendientes, reencolarFallidos, firmarCuerpo, ESPERAS_MIN } =
  await import("../lib/webhookSalida.ts");
const { esMensajeDeBaja, registrarBaja } = await import("../lib/bajas.ts");
const { manejarEntranteMeta } = await import("../lib/inboundMeta.ts");
const { reiniciarCacheSoloMensajeria } = await import("../lib/soloMensajeria.ts");

let llamadas = [];
let respuestas = []; // status que devolverá Kambak, en orden
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true, transporte: "cloud", waba_phone_id: "PHONE_K", waba_token: "tok" },
    { id: OTRO, nombre: "Otro", activo: true, solo_mensajeria: false, transporte: "cloud", waba_phone_id: "PHONE_O", waba_token: "tok" },
  ];
  base.tablas.ed_empleados = [{ id: TINO_K, cliente_id: KAMBAK, rol: "tino", activo: true }];
  reiniciarCacheSoloMensajeria();
  reiniciarPausaWebhook();
  llamadas = [];
  respuestas = [];
  modeloLlamado = 0;
  process.env.KAMBAK_WEBHOOK_URL = "https://kambak.example/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = SECRETO;
  globalThis.fetch = async (u, init) => {
    llamadas.push({ url: String(u), headers: init.headers, cuerpo: init.body });
    const status = respuestas.length ? respuestas.shift() : 200;
    return new Response("{}", { status });
  };
});
test.after?.(() => { globalThis.fetch = fetchOriginal; });

const MIN = 60_000;

test("el evento va firmado con HMAC-SHA256 del cuerpo exacto", async () => {
  await emitirEvento(KAMBAK, "message.status", "status:w1:delivered", { message_id: "w1", status: "delivered" });
  assert.equal(llamadas.length, 1);
  const { headers, cuerpo } = llamadas[0];
  const esperado = "sha256=" + createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
  assert.equal(headers["X-Respondo-Signature"], esperado);
  assert.equal(headers["X-Respondo-Event"], "message.status");
  const j = JSON.parse(cuerpo);
  assert.equal(j.type, "message.status");
  assert.equal(j.data.status, "delivered");
  assert.equal(headers["X-Respondo-Delivery"], j.id);
  assert.equal(firmarCuerpo("x", SECRETO), "sha256=" + createHmac("sha256", SECRETO).update("x").digest("hex"));
  const fila = base.tablas.ed_eventos_salida[0];
  assert.equal(fila.estado, "enviado");
  assert.equal(fila.payload, null, "al entregarse no se conserva el contenido");
});

test("sin variables de entorno no se encola ni se envía nada", async () => {
  delete process.env.KAMBAK_WEBHOOK_SECRET;
  await emitirEvento(KAMBAK, "message.inbound", "inbound:1", { text: "hola" });
  assert.equal(llamadas.length, 0);
  assert.equal((base.tablas.ed_eventos_salida ?? []).length, 0);
  process.env.KAMBAK_WEBHOOK_SECRET = SECRETO;
  process.env.KAMBAK_WEBHOOK_URL = "http://inseguro.example/hook";
  await emitirEvento(KAMBAK, "message.inbound", "inbound:2", { text: "hola" });
  assert.equal(llamadas.length, 0, "solo https");
});

test("cuentas con asistente no emiten eventos", async () => {
  await emitirEvento(OTRO, "message.inbound", "inbound:3", { text: "hola" });
  assert.equal(llamadas.length, 0);
});

test("evento repetido (Meta reintenta) se entrega una sola vez", async () => {
  await emitirEvento(KAMBAK, "message.status", "status:w2:read", { status: "read" });
  await emitirEvento(KAMBAK, "message.status", "status:w2:read", { status: "read" });
  assert.equal(llamadas.length, 1);
});

test("si Kambak falla: reintentos con espera creciente y luego queda en fallidos", async () => {
  respuestas = new Array(20).fill(500);
  const t0 = new Date("2026-10-14T15:00:00Z");
  await emitirEvento(KAMBAK, "message.inbound", "inbound:9", { text: "hola" });
  let fila = base.tablas.ed_eventos_salida[0];
  assert.equal(fila.estado, "pendiente");
  assert.equal(fila.intentos, 1);
  assert.equal(llamadas.length, 1);

  // Antes de su turno no se toca.
  await procesarEventosPendientes(new Date(Date.now() - 10 * MIN));
  assert.equal(llamadas.length, 1);

  let ahora = Date.now();
  const proximos = [];
  for (let i = 0; i < ESPERAS_MIN.length; i++) {
    proximos.push(Date.parse(base.tablas.ed_eventos_salida[0].proximo_intento) - ahora);
    ahora = Date.parse(base.tablas.ed_eventos_salida[0].proximo_intento) + 1000;
    await procesarEventosPendientes(new Date(ahora));
  }
  fila = base.tablas.ed_eventos_salida[0];
  assert.equal(fila.estado, "fallido");
  assert.equal(fila.intentos, ESPERAS_MIN.length + 1);
  assert.equal(llamadas.length, ESPERAS_MIN.length + 1);
  for (let i = 1; i < proximos.length; i++) assert.ok(proximos[i] > proximos[i - 1], "la espera crece");
  assert.ok(fila.payload, "el fallido conserva su contenido para poder reenviarlo");
  void t0;

  // Desde la bandeja de fallidos se devuelve a la cola y esta vez llega.
  respuestas = [];
  assert.equal(await reencolarFallidos(KAMBAK), 1);
  await procesarEventosPendientes(new Date(Date.now() + MIN));
  assert.equal(base.tablas.ed_eventos_salida[0].estado, "enviado");
});

test("detección de BAJA: órdenes claras sí, frases largas o ambiguas no", () => {
  for (const si of ["BAJA", "baja", "Stop", "STOP.", "no más", "No mas!", "cancelar", "darme de baja", "Dar de baja", "unsubscribe", "no quiero recibir más avisos"]) {
    assert.equal(esMensajeDeBaja(si), true, si);
  }
  for (const no of ["hola", "quiero dar de baja mi tarjeta rota y pedir otra", "cancelar mi reserva del viernes", "gracias", "la baja de precio estuvo buena", "", null, "stop de buses"]) {
    assert.equal(esMensajeDeBaja(no), false, String(no));
  }
});

test("registrarBaja marca el contacto una sola vez", async () => {
  assert.equal(await registrarBaja(base, { clienteId: KAMBAK, chatId: "56911112222", nombre: "Ana" }), true);
  assert.equal(await registrarBaja(base, { clienteId: KAMBAK, chatId: "56911112222" }), false);
  const c = base.tablas.ed_contactos.find((x) => x.chat_id === "56911112222");
  assert.deepEqual(c.etiquetas.filter((e) => e === "no_contactar"), ["no_contactar"]);
});

function payloadEntrante(texto, wamid) {
  return {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PHONE_K" },
      contacts: [{ profile: { name: "Ana" }, wa_id: "56911112222" }],
      messages: [{ id: wamid, from: "56911112222", type: "text", text: { body: texto } }],
    } }] }],
  };
}

test("BAJA por WhatsApp: etiqueta, confirma, avisa a Kambak y no llama al modelo", async () => {
  const enviados = [];
  const r = await manejarEntranteMeta(payloadEntrante("BAJA", "wamid.B1"), {
    sinDebounce: true,
    enviar: async (para, texto) => { enviados.push({ para, texto }); return { ok: true, waId: "x" }; },
  });
  assert.ok(r.some((x) => x.accion === "cliente:solo_mensajeria" && x.detalle === "baja"), JSON.stringify(r));
  assert.equal(modeloLlamado, 0);
  const c = base.tablas.ed_contactos.find((x) => x.chat_id === "56911112222");
  assert.ok(c.etiquetas.includes("no_contactar"));
  assert.equal(enviados.length, 1, "una confirmación corta");
  assert.match(enviados[0].texto, /no recibirás más avisos/);
  const tipos = llamadas.map((l) => JSON.parse(l.cuerpo).type).sort();
  assert.deepEqual(tipos, ["contact.optout", "message.inbound"]);
  assert.equal(JSON.parse(llamadas.find((l) => l.headers["X-Respondo-Event"] === "contact.optout").cuerpo).data.phone, "+56911112222");
});

test("un mensaje normal a Kambak solo avisa message.inbound: sin baja, sin respuesta", async () => {
  const enviados = [];
  await manejarEntranteMeta(payloadEntrante("¿hasta qué hora abren?", "wamid.N1"), {
    sinDebounce: true,
    enviar: async (para, texto) => { enviados.push(texto); return { ok: true }; },
  });
  assert.equal(enviados.length, 0);
  assert.equal(modeloLlamado, 0);
  assert.deepEqual(llamadas.map((l) => l.headers["X-Respondo-Event"]), ["message.inbound"]);
  assert.ok(!(base.tablas.ed_contactos[0].etiquetas ?? []).includes("no_contactar"));
});

test("estado de un envío pedido por API llega a Kambak con su id; uno ajeno no", async () => {
  base.tablas.ed_envios_api = [{ id: "envio-1", cliente_id: KAMBAK, wamid: "wamid.S1" }];
  const ack = (id, status) => ({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "PHONE_K" },
    statuses: [{ id, status, ...(status === "failed" ? { errors: [{ code: 131026, title: "No entregable" }] } : {}) }],
  } }] }] });
  await manejarEntranteMeta(ack("wamid.S1", "delivered"), { sinDebounce: true });
  await manejarEntranteMeta(ack("wamid.S1", "failed"), { sinDebounce: true });
  await manejarEntranteMeta(ack("wamid.AJENO", "read"), { sinDebounce: true });
  const eventos = llamadas.map((l) => JSON.parse(l.cuerpo));
  assert.equal(eventos.length, 2);
  assert.equal(eventos[0].data.id, "envio-1");
  assert.equal(eventos[0].data.status, "delivered");
  assert.equal(eventos[1].data.status, "failed");
  assert.match(eventos[1].data.reason, /131026/);
});

test("si Kambak está caído, los eventos siguientes solo se encolan (no esperan uno por uno)", async () => {
  respuestas = [500];
  await emitirEvento(KAMBAK, "message.status", "status:a1:sent", { status: "sent" });
  assert.equal(llamadas.length, 1);
  await emitirEvento(KAMBAK, "message.status", "status:a2:sent", { status: "sent" });
  await emitirEvento(KAMBAK, "message.status", "status:a3:sent", { status: "sent" });
  assert.equal(llamadas.length, 1, "durante la pausa no se vuelve a llamar");
  assert.equal(base.tablas.ed_eventos_salida.length, 3);
  assert.equal(base.tablas.ed_eventos_salida.filter((f) => f.estado === "pendiente").length, 3);
  // El cron los recoge cuando les toca.
  const out = await procesarEventosPendientes(new Date(Date.now() + 2 * 60_000));
  assert.equal(out.entregados, 3);
});
