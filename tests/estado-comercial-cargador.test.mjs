/**
 * ESTADO COMERCIAL — armado de hechos, panorama de Inicio (con base en memoria)
 * y las acciones nuevas de la Fase 1: pago recibido y motivo de pérdida.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { armarHechos, empleadoDelChat, modoDelChat } from "../lib/estadoComercialFilas.ts";
import { panoramaInicio } from "../lib/estadoComercial.ts";
import { registrarPagoRecibido } from "../lib/pagos.ts";
import { validarPagoRecibido } from "../lib/pagosCore.ts";
import { liberarEtapa, moverEtapa, recalcularEtapasEmbudo } from "../lib/embudo.ts";
import { datosConPerdidaAnterior } from "../lib/etapasCore.ts";

const AHORA = Date.now();
const haceMin = (m) => new Date(AHORA - m * 60_000).toISOString();
const haceDias = (d) => new Date(AHORA - d * 86_400_000).toISOString();

const EMPLEADOS = [
  { id: "tino1", rol: "tino", nombrePublico: "Tino" },
  { id: "beto1", rol: "rita", nombrePublico: "Beto" },
];
const CTX = { ahora: AHORA, betoCotizaciones: false, tienePagoLink: true, puedeAprobarPagados: true, nombreTino: "Tino", nombreBeto: "Beto" };

// ─── Armado ─────────────────────────────────────────────────────────────────

test("empleado y modo del chat: el criterio de la bandeja (RPC 293)", () => {
  const emps = [
    { id: "tino1", rol: "tino" },
    { id: "beto1", rol: "rita" },
    { id: "vera0", rol: "vera", activo: false },
  ];
  assert.equal(empleadoDelChat("beto1", emps), "beto1");
  assert.equal(empleadoDelChat(null, emps), "tino1");
  assert.equal(empleadoDelChat("vera0", emps), "tino1", "un empleado inactivo no se elige");
  assert.equal(empleadoDelChat("otro", [{ id: "b", rol: "rita" }, { id: "a", rol: "vera" }]), "a", "sin Tino: el primer activo");
  const estados = [{ empleado_id: "tino1", modo: "humano" }];
  // Último habló Beto y Beto no tiene fila: bot, aunque Tino esté en humano.
  assert.equal(modoDelChat(estados, empleadoDelChat("beto1", emps)), "bot");
  assert.equal(modoDelChat(estados, empleadoDelChat(null, emps)), "humano");
  assert.equal(modoDelChat([], "tino1"), "bot");
  assert.equal(modoDelChat([{ empleado_id: "tino1", modo: "raro" }], "tino1"), "bot");
  assert.equal(modoDelChat(estados, null), "bot");
});

test("armar hechos: descartados, citas activas y puntaje de encuesta", () => {
  const h = armarHechos({
    contactos: [{ chat_id: "569", etapa: "cotizado", etiquetas: ["cotizacion"], ultimo_mensaje_rol: "empleado" }],
    estados: [],
    derivaciones: [],
    pagos: [],
    resultados: [{ chat_id: "569", tipo: "encuesta_respondida", creado_en: haceDias(1), nota: { puntaje: 2 } }],
    propuestas: [],
    seguimientos: [
      { chat_id: "569", empleado_id: "beto1", tipo: "cotizacion_sin_respuesta", enviado_en: haceDias(2), variables: { descartado: "no_contactar" } },
    ],
    citas: [
      { chat_id: "569", id: "c1", inicio: haceDias(-1), fin: haceDias(-1), estado: "confirmada" },
      { chat_id: "569", id: "c2", inicio: haceDias(-2), fin: haceDias(-2), estado: "cancelada" },
    ],
    empleados: EMPLEADOS.map(({ id, rol }) => ({ id, rol })),
  }).get("569");
  assert.equal(h.seguimientos[0].descartado, "no_contactar");
  assert.equal(h.seguimientos[0].rol, "rita");
  assert.deepEqual(h.citas.map((c) => c.id), ["c1"]);
  assert.equal(h.resultados[0].puntaje, 2);
  assert.equal(h.etapa, "cotizado");
});

// ─── Panorama de Inicio ─────────────────────────────────────────────────────

function contacto(chat, extra = {}, cliente = "c1") {
  return {
    cliente_id: cliente,
    chat_id: chat,
    nombre: `Cliente ${chat}`,
    etapa: "nuevo",
    etapa_manual: false,
    etiquetas: [],
    ultimo_mensaje_en: haceMin(30),
    ultimo_mensaje_rol: "empleado",
    ultimo_empleado_id: "tino1",
    ...extra,
  };
}

function base(extraContactos = []) {
  return crearBaseMemoria({
    ed_contactos: [
      contacto("A"),
      contacto("B", { ultimo_mensaje_rol: "cliente", ultimo_mensaje_en: haceMin(40) }),
      contacto("C", { etapa: "ganado", etapa_motivo: "pago_detectado", etiquetas: ["cliente", "pago_por_confirmar"] }),
      contacto("D", { etapa: "cotizado", etiquetas: ["cotizacion"], ultimo_mensaje_en: haceDias(5) }),
      contacto("E"),
      contacto("F", { etapa: "ganado" }),
      // Mismo número en OTRO negocio: nunca puede aparecer.
      contacto("A", { etiquetas: ["pago_por_confirmar"] }, "c2"),
      ...extraContactos,
    ],
    ed_escalaciones: [
      { empleado_id: "tino1", chat_id: "A", trigger: "pedido_explicito", resumen: "x", creado_en: haceMin(15), atendida_en: null },
      { empleado_id: "tino1", chat_id: "E", trigger: "incertidumbre", resumen: "y", creado_en: haceDias(20), atendida_en: null },
      { empleado_id: "otro", chat_id: "A", trigger: "sentimiento_negativo", resumen: "ajena", creado_en: haceMin(5), atendida_en: null },
    ],
    ed_chat_estado: [
      { empleado_id: "tino1", chat_id: "A", modo: "humano" },
      { empleado_id: "tino1", chat_id: "B", modo: "humano" },
    ],
    ed_resultados: [{ empleado_id: "tino1", chat_id: "C", tipo: "venta_confirmada", creado_en: haceMin(90), nota: null }],
    ed_pagos: [{ id: "p1", cliente_id: "c1", chat_id: "F", estado: "pendiente", monto: 52000, creado_en: haceDias(1), pagado_en: null }],
    ed_propuestas_seguimiento: [],
    ed_seguimientos: [],
    ed_citas: [],
  });
}

test("panorama: agrupa por urgencia, separa lo antiguo, no mezcla negocios", async () => {
  const supa = base();
  const p = await panoramaInicio("c1", CTX, supa, { empleados: EMPLEADOS });

  const porChat = Object.fromEntries(p.atencion.map((f) => [f.chatId, f]));
  assert.equal(porChat.A.atencion.grupo, "urgente");
  assert.equal(porChat.B.atencion.principal.motivo, "cliente_espera");
  assert.equal(porChat.C.atencion.principal.motivo, "pago_por_confirmar");
  assert.equal(porChat.C.accion.tipo, "confirmar_pago");
  assert.equal(porChat.E.atencion.grupo, "antiguo");
  assert.deepEqual(p.conteoAtencion, { urgente: 1, hoy: 2, esta_semana: 0, pendiente: 0, antiguo: 1 });
  assert.equal(p.atencion[0].chatId, "A", "lo urgente primero");
  // La derivación de un empleado de otro negocio no cuenta (ni su «molesto»).
  assert.equal(porChat.A.atencion.items.some((i) => i.motivo === "cliente_molesto"), false);
  assert.equal(p.derivadas, 2);

  const opp = Object.fromEntries(p.oportunidades.map((o) => [o.chatId, o.oportunidad.tipo]));
  assert.deepEqual(opp, { F: "cobro_pendiente", D: "cotizacion_sin_respuesta" });
  assert.equal(p.oportunidades[0].chatId, "F", "un cobro enviado va antes que una cotización fría");
  assert.equal(p.completo, true);
});

test("panorama: el número de consultas NO crece con la cantidad de contactos", async () => {
  const pocos = base();
  await panoramaInicio("c1", CTX, pocos, { empleados: EMPLEADOS });
  const muchos = base(
    Array.from({ length: 150 }, (_, i) =>
      contacto(`X${i}`, { etapa: "cotizado", etiquetas: ["cotizacion"], ultimo_mensaje_en: haceDias(4) }),
    ),
  );
  const p = await panoramaInicio("c1", CTX, muchos, { empleados: EMPLEADOS });
  assert.equal(p.oportunidades.length, 152);
  assert.equal(muchos.llamadas.length, pocos.llamadas.length, `consultas: ${pocos.llamadas.length} vs ${muchos.llamadas.length}`);
  // 8 candidatos (incluye la cifra canónica de derivadas; sin la RPC en esta
  // base cae a su respaldo, +1) + ≤8 de hechos por cada 200 chats.
  assert.ok(pocos.llamadas.length <= 16, `demasiadas consultas: ${pocos.llamadas.length}`);
});

// ─── Pago recibido sin cobro previo ─────────────────────────────────────────

test("validar pago recibido", () => {
  assert.deepEqual(validarPagoRecibido({ monto: "45.000", concepto: "" }), { ok: true, monto: 45000, concepto: "Pago recibido" });
  assert.equal(validarPagoRecibido({ monto: "$12.500", concepto: " abono  50% " }).concepto, "abono 50%");
  assert.equal(validarPagoRecibido({ monto: "", concepto: "x" }).ok, false);
  assert.equal(validarPagoRecibido({ monto: "500", concepto: "x" }).ok, false);
  assert.equal(validarPagoRecibido({ monto: "99999999", concepto: "x" }).ok, false);
});

test("confirmar pago recibido: queda pagado, la conversación pasa a ganado y se va «Pago por confirmar»", async () => {
  const supa = crearBaseMemoria({
    ed_pagos: [],
    ed_contactos: [
      { cliente_id: "c1", chat_id: "569", etapa: "ganado", etapa_manual: false, etiquetas: ["cliente", "pago_por_confirmar"] },
      { cliente_id: "c2", chat_id: "569", etapa: "cotizado", etapa_manual: false, etiquetas: ["pago_por_confirmar"] },
    ],
  }, { defaults: { ed_pagos: { estado: "pendiente" } } }); // el default de la columna (sql/289)
  const r = await registrarPagoRecibido({ clienteId: "c1", empleadoId: "tino1", chatId: "569", monto: 45000, concepto: "Abono", creadoPor: "ana@neg.cl", supa });
  assert.equal(r.ok, true);
  const [pago] = supa.tablas.ed_pagos;
  assert.equal(pago.estado, "pagado");
  assert.equal(pago.monto, 45000);
  assert.ok(pago.pagado_en);
  const [mio, ajeno] = supa.tablas.ed_contactos;
  assert.deepEqual(mio.etiquetas, ["cliente"]);
  assert.deepEqual(ajeno.etiquetas, ["pago_por_confirmar"], "otro negocio con el mismo número no se toca");
});

test("pago recibido: un doble envío no duplica la plata", async () => {
  const supa = crearBaseMemoria({
    ed_empleados: [{ id: "tino1", cliente_id: "c1", rol: "tino" }],
    ed_pagos: [],
    ed_contactos: [{ cliente_id: "c1", chat_id: "569", etiquetas: ["pago_por_confirmar"], etapa: "cotizado" }],
  }, { defaults: { ed_pagos: { estado: "pendiente" } } });
  const args = { clienteId: "c1", empleadoId: "tino1", chatId: "569", monto: 45000, concepto: "Abono", creadoPor: "ana@neg.cl", supa };
  const a = await registrarPagoRecibido(args);
  const b = await registrarPagoRecibido(args);
  assert.equal(a.ok && b.ok, true);
  assert.equal(supa.tablas.ed_pagos.length, 1);
  // Otro monto sí es otro pago.
  await registrarPagoRecibido({ ...args, monto: 5000 });
  assert.equal(supa.tablas.ed_pagos.length, 2);
});

// ─── Motivo de pérdida ──────────────────────────────────────────────────────

function baseEmbudo(extra = {}) {
  return crearBaseMemoria({
    ed_contactos: [
      { cliente_id: "c1", chat_id: "569", etapa: "cotizado", etapa_manual: false, etapa_motivo: null, etiquetas: ["cotizacion"], datos: { campana: { titular: "Promo" } }, ...extra },
      { cliente_id: "c2", chat_id: "569", etapa: "cotizado", etapa_manual: false, etiquetas: [] },
    ],
    ed_integraciones: [],
  });
}

test("mover a perdido guarda el motivo; «no quiere que lo contacten» pone la etiqueta", async () => {
  const supa = baseEmbudo();
  assert.equal((await moverEtapa("c1", "569", "perdido", supa, { motivo: "no_contactar" })).ok, true);
  const [mio, ajeno] = supa.tablas.ed_contactos;
  assert.equal(mio.etapa, "perdido");
  assert.equal(mio.etapa_motivo, "no_contactar");
  assert.equal(mio.etapa_manual, true);
  assert.ok(mio.etiquetas.includes("no_contactar"));
  assert.equal(ajeno.etapa, "cotizado");
});

test("un motivo fuera del catálogo se rechaza", async () => {
  const supa = baseEmbudo();
  const r = await moverEtapa("c1", "569", "perdido", supa, { motivo: "me cayó mal" });
  assert.equal(r.ok, false);
  assert.equal(supa.tablas.ed_contactos[0].etapa, "cotizado");
});

test("salir de perdido conserva la pérdida anterior sin borrar la atribución", async () => {
  const supa = baseEmbudo({ etapa: "perdido", etapa_motivo: "sin_respuesta", etapa_en: haceDias(3) });
  await moverEtapa("c1", "569", "interesado", supa);
  const mio = supa.tablas.ed_contactos[0];
  assert.equal(mio.etapa, "interesado");
  assert.equal(mio.etapa_motivo, null);
  assert.deepEqual(mio.datos.ultima_perdida, { motivo: "sin_respuesta", en: haceDias(3) });
  assert.equal(mio.datos.campana.titular, "Promo");
  assert.deepEqual(datosConPerdidaAnterior(null, "x", null), { ultima_perdida: { motivo: "x", en: null } });
});

test("«que la maneje el asistente» sobre un «no le interesó»: el silencio no lo vuelve retomable", async () => {
  const supa = crearBaseMemoria({
    ed_contactos: [
      {
        cliente_id: "c1", chat_id: "569", nombre: "Ana", etapa: "perdido", etapa_manual: true, etapa_motivo: "no_interesado",
        etapa_en: haceDias(9), etiquetas: ["cotizacion"], datos: { campana: { titular: "Promo" } },
        ultimo_mensaje_en: haceDias(8), ultimo_mensaje_rol: "empleado", ultimo_mensaje_texto: "¿Te sirve?",
      },
    ],
    ed_empleados: [{ id: "tino1", cliente_id: "c1", rol: "tino" }],
    ed_resultados: [],
    ed_escalaciones: [],
    ed_integraciones: [],
    ed_integraciones_salida: [],
  });
  assert.equal((await liberarEtapa("c1", "569", supa)).ok, true);
  let c = supa.tablas.ed_contactos[0];
  assert.equal(c.etapa, "cotizado");
  assert.equal(c.etapa_manual, false);
  assert.equal(c.datos.ultima_perdida.motivo, "no_interesado");
  assert.equal(c.datos.campana.titular, "Promo");

  const orig = console.warn; console.warn = () => {};
  try {
    await recalcularEtapasEmbudo("c1", 14, supa);
  } finally {
    console.warn = orig;
  }
  c = supa.tablas.ed_contactos[0];
  assert.equal(c.etapa, "perdido");
  assert.equal(c.etapa_motivo, "no_interesado", "no se convierte en sin_respuesta");
});

// ─── Reabrir un perdido por silencio conserva el motivo ─────────────────────
import { reconciliarEstados } from "../lib/reconciliarEstados.ts";

test("perdido por silencio que vuelve a escribir: reabre a Nuevo y guarda por qué estaba perdido", async () => {
  const supa = crearBaseMemoria({
    ed_contactos: [
      {
        cliente_id: "c1", chat_id: "569", nombre: "Ana", etapa: "perdido", etapa_manual: false, etapa_motivo: "sin_respuesta",
        etapa_en: haceDias(3), etiquetas: [], datos: { campana: { titular: "Promo" } },
        ultimo_mensaje_en: haceMin(10), ultimo_mensaje_rol: "cliente",
      },
    ],
    ed_escalaciones: [],
    ed_empleados: [],
    ed_citas: [],
    ed_integraciones_salida: [],
  });
  const orig = console.error; console.error = () => {};
  try {
    await reconciliarEstados(supa);
  } finally {
    console.error = orig;
  }
  const c = supa.tablas.ed_contactos[0];
  assert.equal(c.etapa, "nuevo");
  assert.equal(c.etapa_motivo, "volvio_a_escribir");
  assert.deepEqual(c.datos.ultima_perdida, { motivo: "sin_respuesta", en: haceDias(3) });
  assert.equal(c.datos.campana.titular, "Promo");
});
