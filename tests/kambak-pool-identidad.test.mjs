/**
 * TESTS FASE P1: Identidad correcta del remitente (LIDs de WhatsApp) y BAJA segura.
 * (lib/wahaPoolIdentidad.ts y lib/inboundWahaPool.ts)
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const NUM_ID = "11111111-0000-4000-8000-00000000000a";
const TINO = "22222222-0000-4000-8000-00000000000a";
const SESION = "kambak_chip_1";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_waha_numeros: [{ cols: ["sesion"] }],
      ed_waha_lids: [{ cols: ["sesion", "lid"] }],
      ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }],
    },
  },
);

let alertasHQ = [];
let enviosPool = [];

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
  base.tablas.ed_empleados = [
    { id: TINO, cliente_id: KAMBAK, rol: "tino", activo: true },
  ];
  base.tablas.ed_waha_numeros = [
    {
      id: NUM_ID,
      cliente_id: KAMBAK,
      sesion: SESION,
      estado: "activo",
      rol: "envio",
    },
  ];
  base.tablas.ed_waha_lids = [];
  base.tablas.ed_contactos = [];
  base.tablas.ed_mensajes = [];
  base.tablas.ed_envios_api = [];
  base.tablas.ed_eventos_salida = [];

  alertasHQ = [];
  enviosPool = [];
  process.env.WAHA_POOL_URL = "https://waha.internal";
  process.env.WAHA_POOL_API_KEY = "test-key";
  process.env.KAMBAK_WEBHOOK_URL = "https://www.kambak.cl/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = "kambak-secret-firma";
  delete process.env.RESPONDO_POOL_SIMULADO;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/hqBridge.ts"), {
  namedExports: {
    notificarHQ: (payload) => {
      alertasHQ.push(payload);
    },
  },
});
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    normalizeWaId: (raw) => (typeof raw === "string" ? raw : null),
    enviarTextoPool: async (sesion, destino, texto) => {
      enviosPool.push({ sesion, destino, texto });
      return { ok: true, waId: "sim.msg123" };
    },
    wahaPoolConfigurado: () => Boolean(process.env.WAHA_POOL_URL),
    poolSimulado: () => process.env.RESPONDO_POOL_SIMULADO === "1",
  },
});

const {
  resolverTelefonoEntrante,
  analizarIntencionBaja,
} = await import("../lib/wahaPoolIdentidad.ts");
const { manejarEntranteWahaPool } = await import("../lib/inboundWahaPool.ts");

beforeEach(() => {
  reiniciar();
});

test("P1: resolverTelefonoEntrante reconoce formato directo tradicional (@c.us y @s.whatsapp.net)", async () => {
  const p1 = { from: "56912345678@c.us" };
  const r1 = await resolverTelefonoEntrante(p1, SESION, base);
  assert.equal(r1.ok, true);
  assert.equal(r1.telefono, "56912345678");
  assert.equal(r1.metodo, "directo");

  const p2 = { from: "56987654321@s.whatsapp.net" };
  const r2 = await resolverTelefonoEntrante(p2, SESION, base);
  assert.equal(r2.ok, true);
  assert.equal(r2.telefono, "56987654321");
  assert.equal(r2.metodo, "directo");
});

test("P1: resolverTelefonoEntrante con LID extrae teléfono desde campos alternos del payload y guarda en caché", async () => {
  const payload = {
    from: "123456789012345@lid",
    _data: {
      key: {
        remoteJidAlt: "56911223344@c.us",
      },
    },
  };

  const res = await resolverTelefonoEntrante(payload, SESION, base);
  assert.equal(res.ok, true);
  assert.equal(res.telefono, "56911223344");
  assert.equal(res.metodo, "payload_alt");
  assert.equal(res.chatIdOriginal, "123456789012345@lid");

  // Verifica que se guardó en ed_waha_lids
  const row = base.tablas.ed_waha_lids.find((l) => l.lid === "123456789012345");
  assert.ok(row);
  assert.equal(row.telefono, "56911223344");
});

test("P1: resolverTelefonoEntrante con LID resuelve desde caché ed_waha_lids si ya existe", async () => {
  base.tablas.ed_waha_lids = [
    {
      sesion: SESION,
      lid: "9999999999",
      telefono: "56955667788",
    },
  ];

  const payload = { from: "9999999999@lid" };
  const res = await resolverTelefonoEntrante(payload, SESION, base);
  assert.equal(res.ok, true);
  assert.equal(res.telefono, "56955667788");
  assert.equal(res.metodo, "cache_lid");
});

test("P1: correlación 72h resuelve teléfono SOLO si hay un único candidato inequívoco", async () => {
  // Caso 1: exactamente 1 contacto en las últimas 72h
  base.tablas.ed_envios_api = [
    {
      cliente_id: KAMBAK,
      numero_id: NUM_ID,
      telefono_hash: "hash_unico_1",
      enviado_en: new Date().toISOString(),
    },
  ];
  base.tablas.ed_contactos = [
    {
      cliente_id: KAMBAK,
      chat_id: "56977889900",
      telefono: "+56977889900",
    },
  ];

  const payload = { from: "88888888@lid" };
  const res = await resolverTelefonoEntrante(payload, SESION, base);
  assert.equal(res.ok, true);
  assert.equal(res.telefono, "56977889900");
  assert.equal(res.metodo, "correlacion");

  // Caso 2: ambiguo con múltiples candidatos -> debe fallar cerrado
  reiniciar();
  base.tablas.ed_envios_api = [
    {
      cliente_id: KAMBAK,
      numero_id: NUM_ID,
      telefono_hash: "hash_1",
      enviado_en: new Date().toISOString(),
    },
    {
      cliente_id: KAMBAK,
      numero_id: NUM_ID,
      telefono_hash: "hash_2",
      enviado_en: new Date().toISOString(),
    },
  ];
  const resAmbiguo = await resolverTelefonoEntrante({ from: "88888888@lid" }, SESION, base);
  assert.equal(resAmbiguo.ok, false);
  assert.equal(resAmbiguo.resultado, "no_resuelto");
});

test("P1: REGLA DE SEGURIDAD - LID no resuelto con texto BAJA no registra baja, no responde y alerta a HQ", async () => {
  const payload = {
    event: "message",
    session: SESION,
    payload: {
      from: "7777777777@lid",
      body: "BAJA",
      id: "wamid_lid_test_1",
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "lid_no_resuelto");
  assert.ok(res.detalle.includes("baja_pendiente_revision"));

  // 1. Cero bajas registradas
  const contacto = base.tablas.ed_contactos.find((c) => c.no_contactar);
  assert.equal(contacto, undefined, "No debe registrar baja sobre nada");

  // 2. Cero confirmaciones enviadas automáticamente
  assert.equal(enviosPool.length, 0, "No debe responder automáticamente");

  // 3. Cero eventos contact.optout emitidos a Kambak
  const optoutEvent = base.tablas.ed_eventos_salida.find((e) => e.tipo === "contact.optout");
  assert.equal(optoutEvent, undefined, "No debe emitir optout a Kambak sin teléfono verificado");

  // 4. Mensaje guardado en bandeja con advertencia de sin_telefono
  const guardado = base.tablas.ed_mensajes[0];
  assert.ok(guardado);
  assert.ok(guardado.texto.includes("[sin_telefono: LID 7777777777]"));

  // 5. Alerta enviada a HQ requiriendo revisión manual
  assert.equal(alertasHQ.length, 1);
  assert.ok(alertasHQ[0].detalle.includes("Requiere revisión manual urgente"));
});

test("P1: análisis de intención de BAJA distingue comandos unívocos de frases ambiguas", () => {
  // Comandos claros
  assert.equal(analizarIntencionBaja("baja").esBaja, true);
  assert.equal(analizarIntencionBaja("BAJA.").esBaja, true);
  assert.equal(analizarIntencionBaja("dar de baja").esBaja, true);
  assert.equal(analizarIntencionBaja("¡darme de baja!").esBaja, true);
  assert.equal(analizarIntencionBaja("no más").esBaja, true);
  assert.equal(analizarIntencionBaja("no mas avisos").esBaja, true);
  assert.equal(analizarIntencionBaja("STOP").esBaja, true);
  assert.equal(analizarIntencionBaja("cancelar suscripción").esBaja, true);

  // Frases ambiguas / falsos positivos (contienen 'baja' dentro de un contexto no unívoco)
  const amb1 = analizarIntencionBaja("el precio tiene una baja importante");
  assert.equal(amb1.esBaja, false);
  assert.equal(amb1.posibleBaja, true);

  const amb2 = analizarIntencionBaja("hola estoy de baja médica");
  assert.equal(amb2.esBaja, false);
  assert.equal(amb2.posibleBaja, true);

  // Mensaje habitual
  const normal = analizarIntencionBaja("Hola buenas tardes, tienen abierto hoy?");
  assert.equal(normal.esBaja, false);
  assert.equal(normal.posibleBaja, false);
});

test("P1: confirmación de BAJA se envía al chat id original (conserva @lid si vino por ahí)", async () => {
  // Simular que el LID sí se resolvió por payload alt
  const payload = {
    event: "message",
    session: SESION,
    payload: {
      from: "5555555555@lid",
      body: "BAJA",
      id: "wamid_lid_ok_1",
      _data: {
        key: {
          remoteJidAlt: "56999887766@c.us",
        },
      },
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "baja");
  assert.equal(res.detalle, "56999887766");

  // Contacto marcado como no contactar en ed_contactos
  const contacto = base.tablas.ed_contactos.find((c) => c.chat_id === "56999887766");
  assert.ok(contacto?.etiquetas?.includes("no_contactar"));

  // Evento contact.optout emitido a Kambak con teléfono resuelto
  const ev = base.tablas.ed_eventos_salida.find((e) => e.tipo === "contact.optout");
  assert.ok(ev);
  assert.equal(ev.payload.phone, "+56999887766");

  // Confirmación enviada al chat id original para que le llegue al hilo de WhatsApp
  assert.equal(enviosPool.length, 1);
  assert.equal(enviosPool[0].destino, "5555555555@lid");
  assert.ok(enviosPool[0].texto.includes("no recibirás más avisos"));
});
