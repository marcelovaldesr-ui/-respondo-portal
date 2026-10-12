/**
 * TESTS FASE 3: Webhook de entrada del pool WAHA (acks, bajas y respuestas).
 * (lib/inboundWahaPool.ts y app/api/whatsapp/webhook-waha-pool/route.ts)
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const TINO_K = "11111111-0000-4000-8000-00000000000a";
const NUM_ID = "99999999-0000-4000-8000-00000000000a";
const SESION_CHIP = "kambak_chip_1";
const SECRETO = "secreto-waha-pool-test-1234567890";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_envios_api: [{ cols: ["cliente_id", "clave"] }],
      ed_waha_numeros: [{ cols: ["sesion"] }],
      ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }],
    },
    rpc: {
      ed_reclamar_webhook: (args) => {
        const id = args.p_evento_id;
        const previo = (base.tablas.ed_webhook_eventos ?? []).find((e) => e.evento_id === id);
        if (previo) {
          return {
            data: [{ evento_uuid: previo.id, procesar: false, estado_actual: previo.estado }],
            error: null,
          };
        }
        const nueva = {
          id: `wh-${Date.now()}-${Math.random()}`,
          evento_id: id,
          proveedor: args.p_proveedor,
          estado: "pendiente",
        };
        (base.tablas.ed_webhook_eventos ??= []).push(nueva);
        return {
          data: [{ evento_uuid: nueva.id, procesar: true, estado_actual: "pendiente" }],
          error: null,
        };
      },
    },
  },
);

let enviadosPool = [];

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
  base.tablas.ed_waha_numeros = [
    {
      id: NUM_ID,
      cliente_id: KAMBAK,
      sesion: SESION_CHIP,
      estado: "activo",
      rol: "envio",
      tope_diario: 150,
      enviados_hoy: 5,
    },
  ];
  base.tablas.ed_envios_api = [];
  base.tablas.ed_mensajes = [];
  base.tablas.ed_contactos = [];
  base.tablas.ed_eventos_salida = [];
  base.tablas.ed_webhook_eventos = [];
  enviadosPool = [];

  process.env.WAHA_POOL_WEBHOOK_SECRET = SECRETO;
  process.env.KAMBAK_WEBHOOK_URL = "https://www.kambak.cl/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = "kambak-secret-firma";
  process.env.RESPONDO_POOL_SIMULADO = "1";
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    normalizeWaId: (raw) => {
      if (!raw) return null;
      const s = typeof raw === "string" ? raw : (raw._serialized || raw.id || null);
      if (!s) return null;
      const i = s.lastIndexOf("_");
      return i >= 0 ? s.slice(i + 1) : s;
    },
    enviarTextoPool: async (sesion, destino, texto) => {
      enviadosPool.push({ sesion, destino, texto });
      return { ok: true, waId: `sim.${Date.now()}` };
    },
  },
});

const { manejarEntranteWahaPool } = await import("../lib/inboundWahaPool.ts");
const { procesarConInbox, idEventoWebhook } = await import("../lib/webhookInbox.ts");
const { secretoValido } = await import("../lib/seguridad.ts");

beforeEach(() => {
  reiniciar();
});

test("Fase 3: message.ack de DEVICE actualiza estado y emite message.status a Kambak", async () => {
  // Envío previo en ed_envios_api
  base.tablas.ed_envios_api = [
    {
      id: "envio-123",
      cliente_id: KAMBAK,
      wamid: "3EB0ABC999",
      estado: "enviado",
    },
  ];

  const payload = {
    event: "message.ack",
    session: SESION_CHIP,
    payload: {
      id: "true_56912345678@c.us_3EB0ABC999",
      ack: 3,
      ackName: "DEVICE",
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "ack_procesado");

  // Verifica que se emitió evento message.status hacia Kambak
  const evs = base.tablas.ed_eventos_salida ?? [];
  assert.equal(evs.length, 1);
  assert.equal(evs[0].tipo, "message.status");
  assert.equal(evs[0].payload.id, "envio-123");
  assert.equal(evs[0].payload.status, "delivered");
  assert.equal(evs[0].payload.message_id, "3EB0ABC999");
});

test("Fase 3: message.ack de ERROR marca fallido en ed_envios_api y emite status failed", async () => {
  base.tablas.ed_envios_api = [
    {
      id: "envio-err",
      cliente_id: KAMBAK,
      wamid: "3EB0FAIL111",
      estado: "enviado",
    },
  ];

  const payload = {
    event: "message.ack",
    session: SESION_CHIP,
    payload: {
      id: "true_56912345678@c.us_3EB0FAIL111",
      ack: -1,
      ackName: "ERROR",
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "ack_procesado");

  assert.equal(base.tablas.ed_envios_api[0].estado, "fallido");
  assert.equal(base.tablas.ed_envios_api[0].motivo, "ack_error");

  const evs = base.tablas.ed_eventos_salida;
  assert.equal(evs[0].tipo, "message.status");
  assert.equal(evs[0].payload.status, "failed");
});

test("Fase 3: mensaje normal entrante se guarda en bandeja y emite message.inbound sin llamar IA", async () => {
  const payload = {
    event: "message",
    session: SESION_CHIP,
    payload: {
      id: "false_56911223344@c.us_MSG1",
      from: "56911223344@c.us",
      fromMe: false,
      body: "Hola, ¿a qué hora abren?",
      notifyName: "Valentina",
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "cliente:solo_mensajeria");

  // Mensaje guardado en ed_mensajes para la bandeja
  const msgs = base.tablas.ed_mensajes;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].chat_id, "56911223344");
  assert.equal(msgs[0].texto, "Hola, ¿a qué hora abren?");
  assert.equal(msgs[0].rol, "cliente");

  // Contacto creado en ed_contactos
  const conts = base.tablas.ed_contactos;
  assert.equal(conts.length, 1);
  assert.equal(conts[0].nombre, "Valentina");

  // Evento emitido a Kambak
  const evs = base.tablas.ed_eventos_salida;
  assert.equal(evs.length, 1);
  assert.equal(evs[0].tipo, "message.inbound");
  assert.equal(evs[0].payload.from, "+56911223344");
  assert.equal(evs[0].payload.text, "Hola, ¿a qué hora abren?");
});

test("Fase 3: orden de BAJA marca contacto con no_contactar, emite optout y responde confirmación", async () => {
  const payload = {
    event: "message",
    session: SESION_CHIP,
    payload: {
      id: "false_56999887766@c.us_BAJA1",
      from: "56999887766@c.us",
      fromMe: false,
      body: "BAJA",
      notifyName: "Pedro",
    },
  };

  const res = await manejarEntranteWahaPool(payload, base);
  assert.equal(res.accion, "baja");

  // Contacto con etiqueta no_contactar
  const contacto = base.tablas.ed_contactos.find((c) => c.chat_id === "56999887766");
  assert.ok(contacto);
  assert.deepEqual(contacto.etiquetas, ["no_contactar"]);

  // Eventos emitidos a Kambak: message.inbound Y contact.optout
  const evs = base.tablas.ed_eventos_salida;
  const tipos = evs.map((e) => e.tipo);
  assert.ok(tipos.includes("message.inbound"));
  assert.ok(tipos.includes("contact.optout"));

  const optout = evs.find((e) => e.tipo === "contact.optout");
  assert.equal(optout.payload.phone, "+56999887766");
  assert.equal(optout.payload.source, "whatsapp_keyword");

  // Confirmación enviada de vuelta al celular
  assert.equal(enviadosPool.length, 1);
  assert.equal(enviadosPool[0].destino, "56999887766");
  assert.ok(enviadosPool[0].texto.includes("Listo, no recibirás más avisos"));

  // Repetir la BAJA no duplica el evento contact.optout
  await manejarEntranteWahaPool(payload, base);
  const optouts = base.tablas.ed_eventos_salida.filter((e) => e.tipo === "contact.optout");
  assert.equal(optouts.length, 1, "no se duplica el optout");
});

test("Fase 3: endpoint HTTP valida secreto k= y procesa con idempotencia", async () => {
  const body = JSON.stringify({
    event: "message",
    session: SESION_CHIP,
    payload: {
      id: "false_56933445566@c.us_X1",
      from: "56933445566@c.us",
      fromMe: false,
      body: "Hola",
    },
  });

  // Sin secreto o con secreto incorrecto falla
  assert.equal(secretoValido(null, SECRETO), false);
  assert.equal(secretoValido("invalido", SECRETO), false);
  assert.equal(secretoValido(SECRETO, SECRETO), true);

  const payload = JSON.parse(body);
  const eventoId = idEventoWebhook("waha", body);

  // Primera pasada: procesa
  const r1 = await procesarConInbox({
    proveedor: "waha",
    eventoId,
    payload,
    requestId: "req-1",
    manejar: (p) => manejarEntranteWahaPool(p, base),
  });
  assert.equal(r1.duplicado, false);
  assert.equal(r1.resultado.accion, "cliente:solo_mensajeria");

  // Segunda pasada con el mismo cuerpo idéntico: detecta duplicado y no repite
  const r2 = await procesarConInbox({
    proveedor: "waha",
    eventoId,
    payload,
    requestId: "req-2",
    manejar: (p) => manejarEntranteWahaPool(p, base),
  });
  assert.equal(r2.duplicado, true);
});
