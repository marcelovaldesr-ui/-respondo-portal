/**
 * TESTS FASE P6: Eventos hacia Kambak en todos los resultados (H11).
 *
 * Cubre:
 *  - Cada resultado de envío emite exactamente un evento terminal hacia Kambak.
 *  - Estados terminales: sent, delivered, read, failed (opt_out, monthly_cap, not_on_whatsapp, max_intentos, expired, uncertain).
 *  - Payload NUNCA incluye referencias a canal, pool, chip, sesión ni waha.
 *  - Idempotencia: eventos repetidos con la misma clave no se duplican.
 *  - Validación del archivo de contrato docs/contrato-eventos-kambak.json.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const CLIENTE_K = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHIP_1 = "chip-1-0000-000000000001";

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

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });

const {
  drenarColaWaha,
  expirarColaWaha,
  reaperEnviosWaha,
} = await import("../lib/kambakEnvios.ts");

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [
    {
      id: CLIENTE_K,
      nombre: "Kambak",
      activo: true,
      solo_mensajeria: true,
      canal_marketing: "waha",
    },
  ];
  base.tablas.ed_empleados = [];
  base.tablas.ed_bajas = [];
  base.tablas.ed_envios_api = [];
  base.tablas.ed_eventos_salida = [];
  base.tablas.ed_waha_numeros = [
    {
      id: CHIP_1,
      cliente_id: CLIENTE_K,
      sesion: "chip_test",
      estado: "activo",
      rol: "envio",
      tope_diario: 100,
      enviados_hoy: 0,
      dia: "2026-10-12",
      proximo_envio_en: null,
      pausado_hasta: null,
    },
  ];

  process.env.RESPONDO_POOL_SIMULADO = "1";
  process.env.KAMBAK_WEBHOOK_URL = "https://kambak.cl/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = "secreto-prueba-1234567890";
  delete process.env.WAHA_POOL_APAGADO;
}

beforeEach(() => {
  reiniciar();
});

test("P6: contrato-eventos-kambak.json existe y contiene todos los eventos requeridos", () => {
  const rutaContrato = join(process.cwd(), "docs", "contrato-eventos-kambak.json");
  const raw = readFileSync(rutaContrato, "utf8");
  const contrato = JSON.parse(raw);

  assert.equal(contrato.version, "2.0.0");
  const evts = contrato.events;
  assert.ok(evts.message_status_sent);
  assert.ok(evts.message_status_delivered);
  assert.ok(evts.message_status_read);
  assert.ok(evts.message_status_failed_opt_out);
  assert.ok(evts.message_status_failed_monthly_cap);
  assert.ok(evts.message_status_failed_not_on_whatsapp);
  assert.ok(evts.message_status_failed_max_intentos);
  assert.ok(evts.message_status_failed_expired);
  assert.ok(evts.message_status_failed_cancelled);
  assert.ok(evts.message_status_failed_uncertain);
  assert.ok(evts.message_inbound);
  assert.ok(evts.contact_optout);

  // Verificar que NINGÚN evento exponga channel, sesion, chip ni waha
  for (const [key, ev] of Object.entries(evts)) {
    const jsonStr = JSON.stringify(ev.data).toLowerCase();
    assert.doesNotMatch(jsonStr, /waha/, `${key} no debe mencionar waha`);
    assert.doesNotMatch(jsonStr, /sesion/, `${key} no debe mencionar sesion`);
    assert.doesNotMatch(jsonStr, /chip/, `${key} no debe mencionar chip`);
    assert.doesNotMatch(jsonStr, /channel/, `${key} no debe contener channel`);
    assert.doesNotMatch(jsonStr, /canal/, `${key} no debe contener canal`);
  }
});

test("P6: envío exitoso por pool emite message.status sent con message_id y sin datos de pool", async () => {
  const ahora = new Date("2026-10-12T14:00:00Z");
  base.tablas.ed_envios_api = [
    {
      id: "env-sent-1",
      cliente_id: CLIENTE_K,
      clave: "k-sent-1",
      plantilla: "sello_promo",
      categoria: "marketing",
      telefono: "+56911223344",
      telefono_hash: "hash1",
      variables: ["Ana", "Café", "Promo", "Detalle", "Viernes"],
      canal: "waha",
      estado: "en_cola",
      programado_para: ahora.toISOString(),
      creado_en: ahora.toISOString(),
      actualizado_en: ahora.toISOString(),
    },
  ];

  await drenarColaWaha(ahora);

  const eventos = base.tablas.ed_eventos_salida.filter((e) => e.tipo === "message.status");
  assert.equal(eventos.length, 1);
  const ev = eventos[0];
  assert.equal(ev.payload.id, "env-sent-1");
  assert.equal(ev.payload.status, "sent");
  assert.ok(ev.payload.message_id);

  const str = JSON.stringify(ev.payload).toLowerCase();
  assert.doesNotMatch(str, /waha|sesion|chip|channel|canal/);
});

test("P6: descarte por baja (opted_out) en cola emite message.status failed con reason opt_out", async () => {
  const ahora = new Date("2026-10-12T14:00:00Z");
  base.tablas.ed_contactos = [
    { cliente_id: CLIENTE_K, chat_id: "+56911223344", etiquetas: ["no_contactar"] },
  ];
  base.tablas.ed_envios_api = [
    {
      id: "env-baja-1",
      cliente_id: CLIENTE_K,
      clave: "k-baja-1",
      plantilla: "sello_promo",
      categoria: "marketing",
      telefono: "+56911223344",
      telefono_hash: "hash1",
      variables: ["Ana", "Café", "Promo", "Detalle", "Viernes"],
      canal: "waha",
      estado: "en_cola",
      programado_para: ahora.toISOString(),
      creado_en: ahora.toISOString(),
      actualizado_en: ahora.toISOString(),
    },
  ];

  await drenarColaWaha(ahora);

  const ev = base.tablas.ed_eventos_salida.find((e) => e.clave === "status:env-baja-1:opt_out");
  assert.ok(ev, "Debe emitirse evento para baja");
  assert.equal(ev.payload.id, "env-baja-1");
  assert.equal(ev.payload.status, "failed");
  assert.equal(ev.payload.reason, "opt_out");
  assert.equal(ev.payload.error_code, "opt_out");
});

test("P6: descarte por falta de WhatsApp en el número emite status failed con reason not_on_whatsapp", async () => {
  const ahora = new Date("2026-10-12T14:00:00Z");
  // En modo simulado, números que NO empiezan con +569 o de formato raro dan existe=false si no tienen largo adecuado
  // '12345' da existe: false según existeEnWhatsApp
  base.tablas.ed_envios_api = [
    {
      id: "env-nowa-1",
      cliente_id: CLIENTE_K,
      clave: "k-nowa-1",
      plantilla: "sello_promo",
      categoria: "marketing",
      telefono: "12345",
      telefono_hash: "hash_nowa",
      variables: ["Ana", "Café", "Promo", "Detalle", "Viernes"],
      canal: "waha",
      estado: "en_cola",
      programado_para: ahora.toISOString(),
      creado_en: ahora.toISOString(),
      actualizado_en: ahora.toISOString(),
    },
  ];

  await drenarColaWaha(ahora);

  const ev = base.tablas.ed_eventos_salida.find((e) => e.clave === "status:env-nowa-1:not_on_whatsapp");
  assert.ok(ev, "Debe emitirse evento para contacto sin WhatsApp");
  assert.equal(ev.payload.status, "failed");
  assert.equal(ev.payload.reason, "not_on_whatsapp");
  assert.equal(ev.payload.error_code, "not_on_whatsapp");
});

test("P6: expiración de cola (>48h) y reaper por timeout emiten eventos terminales con código correspondiente", async () => {
  const ahora = new Date("2026-10-14T15:00:00Z");
  // 1) Fila que superó 48h en cola
  base.tablas.ed_envios_api = [
    {
      id: "env-exp-1",
      cliente_id: CLIENTE_K,
      canal: "waha",
      estado: "en_cola",
      programado_para: new Date("2026-10-12T10:00:00Z").toISOString(),
      creado_en: new Date("2026-10-12T10:00:00Z").toISOString(),
    },
    // 2) Fila atascada en enviando > 3 min sin wamid
    {
      id: "env-unc-1",
      cliente_id: CLIENTE_K,
      canal: "waha",
      estado: "enviando",
      wamid: null,
      actualizado_en: new Date(ahora.getTime() - 5 * 60 * 1000).toISOString(),
    },
  ];

  await expirarColaWaha(base, ahora);
  await reaperEnviosWaha(base, ahora);

  const evExp = base.tablas.ed_eventos_salida.find((e) => e.clave === "status:exp:env-exp-1");
  assert.ok(evExp);
  assert.equal(evExp.payload.status, "failed");
  assert.equal(evExp.payload.reason, "expired");

  const evUnc = base.tablas.ed_eventos_salida.find((e) => e.clave === "status:unc:env-unc-1");
  assert.ok(evUnc);
  assert.equal(evUnc.payload.status, "failed");
  assert.equal(evUnc.payload.reason, "uncertain");
});

test("P6: idempotencia: emisión repetida con la misma clave no duplica registros", async () => {
  const ahora = new Date("2026-10-14T15:00:00Z");
  base.tablas.ed_envios_api = [
    {
      id: "env-exp-dup",
      cliente_id: CLIENTE_K,
      canal: "waha",
      estado: "en_cola",
      programado_para: new Date("2026-10-12T10:00:00Z").toISOString(),
    },
  ];

  // Ejecutamos dos veces la expiración
  await expirarColaWaha(base, ahora);
  await expirarColaWaha(base, ahora);

  const total = base.tablas.ed_eventos_salida.filter((e) => e.clave === "status:exp:env-exp-dup");
  assert.equal(total.length, 1, "No debe duplicar eventos en ed_eventos_salida");
});
