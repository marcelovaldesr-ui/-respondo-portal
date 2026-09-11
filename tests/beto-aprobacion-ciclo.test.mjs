/**
 * BETO EN MODO APROBACIÓN — CICLO COMPLETO SIN ENVIAR NADA REAL (Fase 0).
 *
 * candidato → reja → juez (falso) → propuesta → /seguimientos (aprobar) →
 * programación → cron de envío (transporte falso) → resultado.
 *
 * Todo corre contra una base en memoria y un transporte que solo anota. Ningún
 * mensaje sale a ningún cliente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { generarSeguimientosCotizacion } from "../lib/generadorCotizacion.ts";
import { aprobarPropuesta, rechazarPropuesta, listarPropuestas } from "../lib/propuestasSeguimiento.ts";
import { procesarSeguimientos } from "../lib/seguimientos.ts";
import { bloqueoPorPropuesta, vigenciaAlAprobar } from "../lib/propuestasCore.ts";

// Viernes 11-sep-2026, 12:00 de Chile (UTC-3).
const AHORA = new Date("2026-09-11T15:00:00Z");
const diasAtras = (d) => new Date(AHORA.getTime() - d * 86_400_000).toISOString();

const esquema = {
  unicos: {
    // Índice parcial de la migración 297.
    ed_propuestas_seguimiento: [{ cols: ["cliente_id", "chat_id", "tipo"], donde: (f) => f.estado === "propuesto" }],
  },
  defaults: { ed_seguimientos: { enviado_en: null, respuesta_recibida: false }, ed_propuestas_seguimiento: { resuelto_en: null, resuelto_por: null } },
};

function escenario({ tope = 5, modo = "aprobacion" } = {}) {
  const contacto = (chat_id, extra = {}) => ({
    cliente_id: "c-imp", chat_id, nombre: "Ana", etapa: "cotizado", etiquetas: ["cotizacion"],
    ultimo_mensaje_en: diasAtras(5), ultimo_mensaje_rol: "empleado", ...extra,
  });
  const supa = crearBaseMemoria(
    {
      ed_clientes: [
        { id: "c-imp", nombre: "Impresora", cotizacion_seguimiento: true, cotizacion_tope_diario: tope, seguimiento_modo: modo, transporte: "cloud", activo: true },
        { id: "c-otro", nombre: "Otro", cotizacion_seguimiento: false, activo: true },
      ],
      ed_empleados: [
        { id: "e-beto", cliente_id: "c-imp", rol: "rita", activo: true },
        { id: "e-tino", cliente_id: "c-imp", rol: "tino", activo: true },
        { id: "e-otro", cliente_id: "c-otro", rol: "rita", activo: true },
      ],
      ed_contactos: [
        contacto("56900000001"), // A: abierta
        contacto("56900000002"), // B: el juez la frena
        contacto("56900000003"), // C: ya pagó
        contacto("56900000004", { etiquetas: ["cotizacion", "no_contactar"] }), // D
        contacto("56900000005", { ultimo_mensaje_rol: "cliente" }), // E: le toca al negocio
        // Mismo chat_id en OTRO negocio: nunca debe mezclarse.
        { ...contacto("56900000001"), cliente_id: "c-otro", nombre: "Pedro" },
      ],
      ed_pagos: [{ cliente_id: "c-imp", chat_id: "56900000003", estado: "pagado", creado_en: diasAtras(2) }],
      ed_seguimientos: [],
      ed_propuestas_seguimiento: [],
      ed_mensajes: [],
    },
    esquema,
  );
  const juicios = [];
  const juzgar = async (p) => {
    juicios.push(p.chatId);
    if (p.chatId === "56900000002") return { abierta: false, cotizado: "", motivo: "el cliente dijo que lo compró en otro lado", mensajes: [{}, {}, {}] };
    return { abierta: true, cotizado: "200 carpetas tamaño oficio", motivo: "cotización enviada sin respuesta", mensajes: [{}, {}, {}] };
  };
  const envios = [];
  // Mismo criterio que el cron: ventana abierta → texto; cerrada → plantilla.
  const transporte = ({ ventanaAbierta = false } = {}) => async (empleadoId, chatId, texto, extra) => {
    if (ventanaAbierta) {
      envios.push({ via: "texto", empleadoId, chatId, texto });
      return { ok: true, waId: "wamid.falso" };
    }
    if (!extra.params.length) return { ok: false, omitido: true, error: "ventana cerrada sin plantilla" };
    envios.push({ via: "plantilla", empleadoId, chatId, plantilla: extra.plantilla, params: extra.params });
    return { ok: true, waId: "wamid.falso" };
  };
  return { supa, juzgar, juicios, envios, transporte };
}

const OPC = (juzgar) => ({ juzgar, ahora: AHORA.getTime(), fechaLimite: Date.now() + 60_000 });

test("causa raíz reproducida: upsert con onConflict contra el índice PARCIAL → 42P10", async () => {
  const { supa } = escenario();
  const { error } = await supa
    .from("ed_propuestas_seguimiento")
    .upsert({ cliente_id: "c-imp", chat_id: "x", tipo: "cotizacion_sin_respuesta", estado: "propuesto" }, { onConflict: "cliente_id,chat_id,tipo" });
  assert.equal(error?.code, "42P10", "así fallaba TODA propuesta antes del arreglo");
});

test("ciclo completo: propone solo lo abierto, aprueba una vez, envía por plantilla, en horario", async () => {
  const { supa, juzgar, juicios, envios, transporte } = escenario();

  // 1) Generador: reja + juez.
  const g1 = await generarSeguimientosCotizacion(supa, OPC(juzgar));
  assert.deepEqual(g1.errores, []);
  assert.equal(g1.propuestos, 1);
  assert.equal(g1.frenadosPorJuez, 1);
  assert.equal(g1.programados, 0, "modo aprobación: nada se programa solo");
  assert.deepEqual(juicios.sort(), ["56900000001", "56900000002"], "C (pagó), D (no_contactar), E (cliente habló último) no llegan al juez");
  assert.equal(supa.tablas.ed_seguimientos.length, 0, "no hay NADA en la cola de envío");
  const props = supa.tablas.ed_propuestas_seguimiento;
  assert.equal(props.find((p) => p.chat_id === "56900000002").estado, "frenado");
  assert.ok(props.every((p) => p.cliente_id === "c-imp"));

  // 2) Segunda pasada 5 minutos después: sin volver a pagar al juez ni duplicar.
  const g2 = await generarSeguimientosCotizacion(supa, { ...OPC(juzgar), ahora: AHORA.getTime() + 300_000 });
  assert.equal(juicios.length, 2, "el juez no se vuelve a consultar");
  assert.equal(g2.yaDecididos, 2);
  assert.equal(props.filter((p) => p.estado === "propuesto").length, 1);

  // 3) /seguimientos muestra la propuesta del negocio correcto.
  const lista = await listarPropuestas({ clienteId: "c-imp", supa });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nombre, "Ana");
  assert.deepEqual(await listarPropuestas({ clienteId: "c-otro", supa }), [], "otro negocio no la ve");

  // 4) Otro negocio no puede aprobarla aunque adivine el id.
  const id = lista[0].id;
  const ajena = await aprobarPropuesta({ clienteId: "c-otro", propuestaId: id, negocio: "Otro", email: "x@otro.cl", supa, ahora: AHORA });
  assert.equal(ajena.ok, false);
  assert.equal(supa.tablas.ed_seguimientos.length, 0);

  // 5) Doble clic: exactamente UNA programación.
  const [r1, r2] = await Promise.all([
    aprobarPropuesta({ clienteId: "c-imp", propuestaId: id, negocio: "Impresora", email: "cecilia@imp.cl", supa, ahora: AHORA }),
    aprobarPropuesta({ clienteId: "c-imp", propuestaId: id, negocio: "Impresora", email: "cecilia@imp.cl", supa, ahora: AHORA }),
  ]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  assert.equal(supa.tablas.ed_seguimientos.length, 1);
  const seg = supa.tablas.ed_seguimientos[0];
  assert.equal(seg.empleado_id, "e-beto");
  assert.equal(seg.tipo, "cotizacion_sin_respuesta");
  assert.equal(seg.plantilla_meta, "cotizacion_pendiente");
  assert.deepEqual(seg.variables.params, ["Ana", "Impresora", "200 carpetas tamaño oficio"]);
  assert.match(seg.variables.texto, /200 carpetas tamaño oficio/);
  assert.equal(props.find((p) => p.id === id).resuelto_por, "cecilia@imp.cl");

  // 6) Cron de noche (23:00 de Chile): no sale nada.
  const noche = await procesarSeguimientos({ supa, ahora: new Date("2026-09-12T02:00:00Z"), enviar: transporte() });
  assert.equal(noche.enviados, 0);
  assert.equal(envios.length, 0);

  // 7) Cron en horario, ventana de 24 h cerrada → plantilla aprobada, una vez.
  const dia = await procesarSeguimientos({ supa, ahora: new Date(AHORA.getTime() + 600_000), enviar: transporte() });
  assert.equal(dia.enviados, 1);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].via, "plantilla");
  assert.equal(envios[0].plantilla, "cotizacion_pendiente");
  assert.ok(seg.enviado_en, "queda marcado como enviado");
  assert.equal(supa.tablas.ed_mensajes[0].empleado_id, "e-beto", "el mensaje queda en el hilo de Beto");

  // 8) Otra pasada: no se reenvía.
  await procesarSeguimientos({ supa, ahora: new Date(AHORA.getTime() + 900_000), enviar: transporte() });
  assert.equal(envios.length, 1);
});

test("no_contactar puesto DESPUÉS de aprobar: el cron lo descarta y no envía", async () => {
  const { supa, juzgar, envios, transporte } = escenario();
  await generarSeguimientosCotizacion(supa, OPC(juzgar));
  const prop = supa.tablas.ed_propuestas_seguimiento.find((p) => p.estado === "propuesto");
  assert.ok((await aprobarPropuesta({ clienteId: "c-imp", propuestaId: prop.id, negocio: "Impresora", email: "c@i.cl", supa, ahora: AHORA })).ok);
  supa.tablas.ed_contactos.find((c) => c.cliente_id === "c-imp" && c.chat_id === prop.chat_id).etiquetas.push("no_contactar");
  await procesarSeguimientos({ supa, ahora: new Date(AHORA.getTime() + 60_000), enviar: transporte({ ventanaAbierta: true }) });
  assert.equal(envios.length, 0);
  assert.equal(supa.tablas.ed_seguimientos[0].variables.descartado, "no_contactar");
});

test("si el cliente escribió después de la propuesta, aprobar NO programa y la retira como vencida", async () => {
  const { supa, juzgar } = escenario();
  await generarSeguimientosCotizacion(supa, OPC(juzgar));
  const prop = supa.tablas.ed_propuestas_seguimiento.find((p) => p.estado === "propuesto");
  Object.assign(supa.tablas.ed_contactos.find((c) => c.cliente_id === "c-imp" && c.chat_id === prop.chat_id), {
    ultimo_mensaje_rol: "cliente",
    ultimo_mensaje_en: new Date(Date.parse(prop.creado_en) + 3600_000).toISOString(),
  });
  const r = await aprobarPropuesta({ clienteId: "c-imp", propuestaId: prop.id, negocio: "Impresora", email: "c@i.cl", supa, ahora: AHORA });
  assert.equal(r.ok, false);
  assert.equal(r.retirar, true);
  assert.match(r.error, /escribió después/);
  assert.equal(prop.estado, "vencido");
  assert.equal(supa.tablas.ed_seguimientos.length, 0);
});

test("tope diario al aprobar: con el tope usado, sale mañana 10:00 de Chile y se avisa", async () => {
  const { supa, juzgar } = escenario({ tope: 1 });
  supa.tablas.ed_seguimientos.push({ id: "ya", empleado_id: "e-beto", tipo: "cotizacion_sin_respuesta", chat_id: "otro", programado_para: diasAtras(0.05), enviado_en: diasAtras(0.04), variables: {} });
  await generarSeguimientosCotizacion(supa, OPC(juzgar));
  const prop = supa.tablas.ed_propuestas_seguimiento.find((p) => p.estado === "propuesto");
  const r = await aprobarPropuesta({ clienteId: "c-imp", propuestaId: prop.id, negocio: "Impresora", email: "c@i.cl", supa, ahora: AHORA });
  assert.equal(r.ok, true);
  assert.equal(r.programadoPara, "2026-09-12T13:00:00.000Z");
  assert.match(r.aviso, /mañana a las 10:00/);
});

test("modo aprobación: con la lista llena (vivas = tope) el juez no se consulta", async () => {
  const { supa, juzgar, juicios } = escenario({ tope: 1 });
  await generarSeguimientosCotizacion(supa, OPC(juzgar));
  const antes = juicios.length;
  // Llega otro candidato nuevo.
  supa.tablas.ed_contactos.push({ cliente_id: "c-imp", chat_id: "56900000009", nombre: "Luis", etapa: "cotizado", etiquetas: ["cotizacion"], ultimo_mensaje_en: diasAtras(4), ultimo_mensaje_rol: "empleado" });
  await generarSeguimientosCotizacion(supa, { ...OPC(juzgar), ahora: AHORA.getTime() + 300_000 });
  assert.equal(juicios.length, antes, "la propuesta pendiente ocupa el único cupo de la lista");
});

test("rechazo: queda guardado y no reaparece mientras la conversación no cambie", async () => {
  const { supa, juzgar, juicios } = escenario();
  await generarSeguimientosCotizacion(supa, OPC(juzgar));
  const prop = supa.tablas.ed_propuestas_seguimiento.find((p) => p.estado === "propuesto");
  assert.ok((await rechazarPropuesta({ clienteId: "c-imp", propuestaId: prop.id, email: "c@i.cl", supa })).ok);
  const antes = juicios.length;
  const g = await generarSeguimientosCotizacion(supa, { ...OPC(juzgar), ahora: AHORA.getTime() + 3600_000 });
  assert.equal(juicios.length, antes);
  assert.equal(g.propuestos, 0);
});

test("fail-closed: si no se pueden leer los cobros pagados, no se juzga ni se propone", async () => {
  const { supa, juzgar, juicios } = escenario();
  const from = supa.from;
  supa.from = (t) => {
    if (t !== "ed_pagos") return from(t);
    const b = from("ed_pagos");
    b.then = (res) => Promise.resolve({ data: null, error: { message: "permission denied" } }).then(res);
    return b;
  };
  const g = await generarSeguimientosCotizacion(supa, OPC(juzgar));
  assert.equal(juicios.length, 0);
  assert.equal(g.propuestos, 0);
  assert.match(g.errores[0].error, /cobros pagados/);
});

test("juez sin veredicto (modelo caído): un error por negocio, sin repagar cada 5 min, se reintenta al día siguiente", async () => {
  const { supa } = escenario();
  let llamadas = 0;
  const juzgar = async () => { llamadas++; return { abierta: null, cotizado: "", motivo: "el juez no respondió: HTTP 503", mensajes: [] }; };
  const g = await generarSeguimientosCotizacion(supa, OPC(juzgar));
  assert.equal(g.errores.length, 1, "un solo error aunque fallen varios candidatos");
  assert.match(g.errores[0].error, /HTTP 503/);
  assert.equal(supa.tablas.ed_propuestas_seguimiento.filter((p) => p.estado === "propuesto").length, 0, "no es una propuesta");
  const antes = llamadas;
  await generarSeguimientosCotizacion(supa, { ...OPC(juzgar), ahora: AHORA.getTime() + 300_000 });
  assert.equal(llamadas, antes, "5 minutos después no se vuelve a pagar el mismo hilo");
});

test("reglas puras de memoria y vigencia", () => {
  const ahora = Date.parse("2026-09-11T15:00:00Z");
  assert.equal(bloqueoPorPropuesta(null, null, ahora).bloquea, false);
  assert.equal(bloqueoPorPropuesta({ estado: "propuesto", creado_en: "2026-09-10T00:00:00Z", resuelto_en: null }, null, ahora).bloquea, true);
  const frenado = { estado: "frenado", creado_en: "2026-09-10T00:00:00Z", resuelto_en: "2026-09-10T00:00:00Z" };
  assert.equal(bloqueoPorPropuesta(frenado, "2026-09-09T00:00:00Z", ahora).bloquea, true);
  assert.equal(bloqueoPorPropuesta(frenado, "2026-09-10T05:00:00Z", ahora).bloquea, false, "hubo conversación nueva: se reevalúa");
  assert.equal(bloqueoPorPropuesta({ estado: "vencido", creado_en: "2026-09-10T00:00:00Z", resuelto_en: "2026-09-10T00:00:00Z" }, null, ahora).bloquea, false);
  assert.equal(bloqueoPorPropuesta({ estado: "aprobado", creado_en: "2026-09-01T00:00:00Z", resuelto_en: "2026-09-01T00:00:00Z" }, "2026-09-10T00:00:00Z", ahora).bloquea, true);
  assert.equal(vigenciaAlAprobar({ etiquetas: ["pago_pendiente"], etapa: "cotizado", ultimo_mensaje_en: null, ultimo_mensaje_rol: null }, "2026-09-10T00:00:00Z").vigente, false);
  assert.equal(vigenciaAlAprobar({ etiquetas: [], etapa: "ganado", ultimo_mensaje_en: null, ultimo_mensaje_rol: null }, "2026-09-10T00:00:00Z").vigente, false);
  assert.equal(vigenciaAlAprobar({ etiquetas: [], etapa: "cotizado", ultimo_mensaje_en: "2026-09-09T00:00:00Z", ultimo_mensaje_rol: "cliente" }, "2026-09-10T00:00:00Z").vigente, true);
});

test("Fase 0: el cierre por silencio del embudo (perdido · sin_respuesta) no deja a Beto sin candidatos ni vence la aprobación", async () => {
  const { supa, juzgar } = escenario();
  // 10 días sin respuesta: el embudo ya la cerró y quitó la etiqueta.
  Object.assign(supa.tablas.ed_contactos[0], { etapa: "perdido", etapa_motivo: "sin_respuesta", etiquetas: [], ultimo_mensaje_en: diasAtras(10) });
  const g = await generarSeguimientosCotizacion(supa, OPC(juzgar));
  assert.ok(g.propuestos >= 1);
  const prop = supa.tablas.ed_propuestas_seguimiento.find((p) => p.chat_id === "56900000001" && p.estado === "propuesto");
  assert.ok(prop, "la cotización silenciosa se propone");
  const r = await aprobarPropuesta({ clienteId: "c-imp", propuestaId: prop.id, negocio: "Impresora", email: "c@i.cl", supa, ahora: AHORA });
  assert.equal(r.ok, true);
});
