/**
 * COPIA DE EVENTOS HACIA BRAINROOT (3-nov-2026).
 * BrainRoot es un SEGUNDO destino de los eventos de Kambak, con cola propia.
 * Lo que se prueba acá: que llega firmado, que no cambia nada de lo que recibe
 * kambak.cl, y que si uno de los dos falla el otro ni se entera.
 * Base en memoria; Kambak, BrainRoot y Meta son testigos. No sale nada real.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";
const TINO_K = "11111111-0000-4000-8000-00000000000a";
const SECRETO_K = "secreto-kambak";
const SECRETO_BR = "secreto-brainroot";
const URL_K = "https://kambak.example/api/hooks/respondo";
const URL_BR = "https://brainroot-eight.vercel.app/api/integrations/respondo/webhook";

const base = crearBaseMemoria({}, {
  unicos: {
    ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }],
    ed_eventos_brainroot: [{ cols: ["cliente_id", "clave"] }],
  },
});
let dbActual = base;
mock.module(url("../lib/db.ts"), { namedExports: { db: () => dbActual } });
mock.module(url("../lib/gemini.ts"), { namedExports: { generarJSON: async () => ({}) } });

const {
  emitirEvento, emitirBrainroot, reiniciarPausaWebhook, reiniciarPausaBrainroot,
  procesarEventosPendientes, procesarEventosBrainroot, ESPERAS_MIN,
} = await import("../lib/webhookSalida.ts");
const { manejarEntranteMeta } = await import("../lib/inboundMeta.ts");
const { reiniciarCacheSoloMensajeria } = await import("../lib/soloMensajeria.ts");

let llamadas = [];
let respuestas = {}; // por destino: lista de status en orden
const fetchOriginal = globalThis.fetch;
const destino = (u) => (String(u).startsWith(URL_BR) ? "br" : String(u).startsWith(URL_K) ? "k" : "otro");

beforeEach(() => {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  dbActual = base;
  base.tablas.ed_clientes = [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true, transporte: "cloud", waba_phone_id: "PHONE_K", waba_token: "tok" },
    { id: OTRO, nombre: "Otro", activo: true, solo_mensajeria: false, transporte: "cloud", waba_phone_id: "PHONE_O", waba_token: "tok" },
  ];
  base.tablas.ed_empleados = [{ id: TINO_K, cliente_id: KAMBAK, rol: "tino", activo: true }];
  reiniciarCacheSoloMensajeria();
  reiniciarPausaWebhook();
  reiniciarPausaBrainroot();
  llamadas = [];
  respuestas = { k: [], br: [] };
  process.env.KAMBAK_WEBHOOK_URL = URL_K;
  process.env.KAMBAK_WEBHOOK_SECRET = SECRETO_K;
  process.env.BRAINROOT_WEBHOOK_SECRET = SECRETO_BR;
  delete process.env.BRAINROOT_WEBHOOK_URL;
  globalThis.fetch = async (u, init) => {
    const d = destino(u);
    llamadas.push({ d, url: String(u), headers: init.headers, cuerpo: init.body });
    const lista = respuestas[d] ?? [];
    const status = lista.length ? lista.shift() : 200;
    return new Response("{}", { status });
  };
});
test.after?.(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.BRAINROOT_WEBHOOK_SECRET;
});

const de = (d) => llamadas.filter((l) => l.d === d);
const MIN = 60_000;

test("cada evento de Kambak llega también a BrainRoot, firmado con su propio secreto y el mismo sobre", async () => {
  await emitirEvento(KAMBAK, "message.status", "status:w1:delivered", { message_id: "w1", status: "delivered" });
  assert.equal(de("k").length, 1);
  assert.equal(de("br").length, 1);
  const { headers, cuerpo, url: u } = de("br")[0];
  assert.equal(u, URL_BR, "URL por defecto");
  assert.equal(headers["X-Respondo-Signature"], "sha256=" + createHmac("sha256", SECRETO_BR).update(cuerpo).digest("hex"));
  assert.equal(headers["X-Respondo-Event"], "message.status");
  const j = JSON.parse(cuerpo);
  assert.deepEqual(Object.keys(j).sort(), ["created_at", "data", "id", "type"]);
  assert.equal(headers["X-Respondo-Delivery"], j.id);
  assert.equal(j.data.status, "delivered");
  // Kambak sigue firmado con SU secreto.
  const k = de("k")[0];
  assert.equal(k.headers["X-Respondo-Signature"], "sha256=" + createHmac("sha256", SECRETO_K).update(k.cuerpo).digest("hex"));
  assert.equal(base.tablas.ed_eventos_brainroot[0].estado, "enviado");
  assert.equal(base.tablas.ed_eventos_brainroot[0].payload, null);
});

test("sin BRAINROOT_WEBHOOK_SECRET no se manda nada a BrainRoot y Kambak sigue igual", async () => {
  delete process.env.BRAINROOT_WEBHOOK_SECRET;
  await emitirEvento(KAMBAK, "message.inbound", "inbound:1", { text: "hola" });
  assert.equal(de("br").length, 0);
  assert.equal((base.tablas.ed_eventos_brainroot ?? []).length, 0);
  assert.equal(de("k").length, 1);
});

test("la copia a BrainRoot no depende de que kambak.cl esté configurado", async () => {
  delete process.env.KAMBAK_WEBHOOK_SECRET;
  await emitirEvento(KAMBAK, "message.inbound", "inbound:2", { text: "hola" });
  assert.equal(de("k").length, 0);
  assert.equal(de("br").length, 1);
});

test("BRAINROOT_WEBHOOK_URL reemplaza la dirección; http no se acepta", async () => {
  process.env.BRAINROOT_WEBHOOK_URL = "http://inseguro.example/hook";
  await emitirEvento(KAMBAK, "message.inbound", "inbound:3", { text: "hola" });
  assert.equal(llamadas.filter((l) => l.url.startsWith("http://")).length, 0);
});

test("cuentas con asistente no mandan nada a BrainRoot", async () => {
  await emitirEvento(OTRO, "message.inbound", "inbound:4", { text: "hola" });
  await emitirBrainroot(OTRO, "message.outbound", "outbound:4", { text: "hola" });
  assert.equal(llamadas.length, 0);
});

test("evento repetido (Meta reintenta) llega una sola vez a BrainRoot", async () => {
  await emitirEvento(KAMBAK, "message.status", "status:w2:read", { status: "read" });
  await emitirEvento(KAMBAK, "message.status", "status:w2:read", { status: "read" });
  assert.equal(de("br").length, 1);
  assert.equal(de("k").length, 1);
});

test("si BrainRoot falla, Kambak recibe igual y no se atrasa; BrainRoot reintenta con su propia cola", async () => {
  respuestas.br = new Array(20).fill(500);
  await emitirEvento(KAMBAK, "message.inbound", "inbound:9", { text: "hola" });
  await emitirEvento(KAMBAK, "message.inbound", "inbound:10", { text: "chao" });
  assert.equal(de("k").length, 2, "Kambak recibe los dos al tiro");
  assert.equal(de("br").length, 1, "BrainRoot caído: el segundo solo se encola (pausa)");
  assert.ok(base.tablas.ed_eventos_salida.every((f) => f.estado === "enviado"));
  assert.equal(base.tablas.ed_eventos_brainroot.filter((f) => f.estado === "pendiente").length, 2);

  // El cron de Kambak no toca la cola de BrainRoot.
  const k = await procesarEventosPendientes(new Date(Date.now() + 2 * MIN));
  assert.equal(k.revisados, 0);
  assert.equal(de("br").length, 1);

  // El cron de BrainRoot sí, con la misma escalera de esperas, hasta fallidos.
  let ahora = Date.now() + 2 * MIN;
  for (let i = 0; i < ESPERAS_MIN.length + 2; i++) {
    await procesarEventosBrainroot(new Date(ahora));
    const prox = Math.max(...base.tablas.ed_eventos_brainroot.map((f) => Date.parse(f.proximo_intento)));
    ahora = prox + 1000;
  }
  assert.ok(base.tablas.ed_eventos_brainroot.every((f) => f.estado === "fallido"));

  // Cuando BrainRoot vuelve, lo nuevo llega.
  respuestas.br = [];
  reiniciarPausaBrainroot();
  await emitirEvento(KAMBAK, "message.inbound", "inbound:11", { text: "volví" });
  assert.equal(base.tablas.ed_eventos_brainroot.find((f) => f.clave === "inbound:11").estado, "enviado");
});

test("si Kambak falla, BrainRoot recibe igual", async () => {
  respuestas.k = [500];
  await emitirEvento(KAMBAK, "message.inbound", "inbound:12", { text: "hola" });
  assert.equal(de("br").length, 1);
  assert.equal(base.tablas.ed_eventos_brainroot[0].estado, "enviado");
  assert.equal(base.tablas.ed_eventos_salida[0].estado, "pendiente");
});

test("sin la migración 329: un intento directo, sin romper nada y con id estable", async () => {
  // db que responde "tabla inexistente" solo para ed_eventos_brainroot.
  dbActual = new Proxy(base, {
    get(obj, prop) {
      if (prop !== "from") return obj[prop];
      return (tabla) => {
        if (tabla !== "ed_eventos_brainroot") return obj.from(tabla);
        const err = { data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } };
        const encadenable = { select: () => encadenable, single: async () => err, insert: () => encadenable, then: (r) => r(err) };
        return encadenable;
      };
    },
  });
  await emitirEvento(KAMBAK, "message.inbound", "inbound:13", { text: "hola" });
  await emitirEvento(KAMBAK, "message.inbound", "inbound:13", { text: "hola" });
  assert.equal(de("k").length, 1, "Kambak no se ve afectado");
  assert.equal(de("br").length, 2, "sin cola no hay deduplicación local…");
  assert.equal(JSON.parse(de("br")[0].cuerpo).id, JSON.parse(de("br")[1].cuerpo).id, "…pero el id es el mismo, así BrainRoot lo ignora");
});

function payloadEntrante({ texto, wamid, referral }) {
  return {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "PHONE_K" },
      contacts: [{ profile: { name: "Ana Pérez" }, wa_id: "56911112222" }],
      messages: [{ id: wamid, from: "56911112222", timestamp: "1762218000", type: "text", text: { body: texto }, ...(referral ? { referral } : {}) }],
    } }] }],
  };
}

test("message.inbound: BrainRoot recibe nombre, timestamp y referral tal cual; kambak.cl recibe lo de siempre", async () => {
  const referral = { source_id: "120201", source_type: "ad", headline: "Tarjeta de sellos", ctwa_clid: "clid-1", source_url: "https://fb.me/x" };
  await manejarEntranteMeta(payloadEntrante({ texto: "quiero info", wamid: "wamid.R1", referral }), {
    sinDebounce: true,
    enviar: async () => ({ ok: true }),
  });
  const br = JSON.parse(de("br")[0].cuerpo);
  assert.equal(br.type, "message.inbound");
  assert.equal(br.data.name, "Ana Pérez");
  assert.equal(br.data.timestamp, 1762218000);
  assert.deepEqual(br.data.referral, referral);
  assert.equal(br.data.from, "+56911112222");
  assert.equal(br.data.text, "quiero info");
  const k = JSON.parse(de("k")[0].cuerpo);
  assert.deepEqual(Object.keys(k.data).sort(), ["from", "message_id", "text", "type"], "kambak.cl no cambia");
});

test("message.inbound sin anuncio: no inventa referral", async () => {
  await manejarEntranteMeta(payloadEntrante({ texto: "hola", wamid: "wamid.R2" }), { sinDebounce: true, enviar: async () => ({ ok: true }) });
  const br = JSON.parse(de("br")[0].cuerpo);
  assert.equal("referral" in br.data, false);
});

test("lo que la persona escribe desde el celular (eco de Coexistencia) va SOLO a BrainRoot como message.outbound", async () => {
  const eco = {
    entry: [{ changes: [{ field: "smb_message_echoes", value: {
      metadata: { phone_number_id: "PHONE_K" },
      message_echoes: [{ id: "wamid.E1", from: "56985761941", to: "56911112222", timestamp: "1762218100", type: "text", text: { body: "Hola Ana, te cuento" } }],
    } }] }],
  };
  const r = await manejarEntranteMeta(eco, { sinDebounce: true, enviar: async () => ({ ok: true }) });
  assert.ok(r.some((x) => x.accion === "toma_humana"), JSON.stringify(r));
  assert.equal(de("k").length, 0, "kambak.cl no recibe ecos");
  assert.equal(de("br").length, 1);
  const j = JSON.parse(de("br")[0].cuerpo);
  assert.equal(j.type, "message.outbound");
  assert.deepEqual(j.data, { to: "+56911112222", type: "text", text: "Hola Ana, te cuento", message_id: "wamid.E1", timestamp: 1762218100 });

  // Meta repite el eco: no se duplica.
  await manejarEntranteMeta(eco, { sinDebounce: true, enviar: async () => ({ ok: true }) });
  assert.equal(de("br").length, 1);
});
