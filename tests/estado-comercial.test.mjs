/**
 * ESTADO COMERCIAL DERIVADO (Fase 1): prioridad, atención, pago, Beto,
 * acciones contextuales y coherencia entre piezas.
 *
 * Todo sale de lib/estadoComercialCore.ts, que es puro: estas pruebas no tocan
 * la base. Si una regla cambia acá, cambia a la vez en Inicio y en la ficha.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAS_ANTIGUO,
  actividadReciente,
  atencionRequerida,
  canalDe,
  derivarEstadoComercial,
  estadoBeto,
  estadoPago,
  oportunidadAbierta,
  pagoDelCiclo,
  retomablePorBeto,
  siguienteAccion,
} from "../lib/estadoComercialCore.ts";
import { decidirCotizacion } from "../lib/generadorCotizacionCore.ts";
import { RESUMEN_AUDIO, RESUMEN_FALLO_CANAL, RESUMEN_FALLO_MODELO, clasificarDerivacion } from "../lib/derivacionesCore.ts";
import { etiquetaMotivoEtapa, MOTIVOS_PERDIDA, motivoCierrePorSilencio } from "../lib/etapasCore.ts";

const AHORA = Date.parse("2026-09-11T15:00:00.000Z");
const haceMin = (m) => new Date(AHORA - m * 60_000).toISOString();
const haceDias = (d) => new Date(AHORA - d * 86_400_000).toISOString();

function hechos(extra = {}) {
  return {
    chatId: "56911112222",
    nombre: "Cliente Prueba",
    telefono: "+56911112222",
    etapa: "nuevo",
    etapaMotivo: null,
    etapaEn: haceDias(10),
    etapaManual: false,
    etiquetas: [],
    ultimoMensajeEn: haceMin(30),
    ultimoMensajeRol: "empleado",
    primerMensajeEn: haceDias(10),
    totalMensajes: 12,
    modo: "bot",
    derivaciones: [],
    pagos: [],
    propuestas: [],
    seguimientos: [],
    citas: [],
    resultados: [],
    datos: null,
    ...extra,
  };
}

const DUENO = { ahora: AHORA, betoCotizaciones: false, tienePagoLink: true, puedeAprobarPagados: true, nombreTino: "Tino", nombreBeto: "Beto" };
const STAFF = { ...DUENO, puedeAprobarPagados: false };

// ─── Pago ───────────────────────────────────────────────────────────────────

test("pago: ganado NO implica pago confirmado", () => {
  const e = estadoPago(hechos({ etapa: "ganado", etapaMotivo: "pago_detectado" }));
  assert.equal(e.tipo, "sin_cobro");
});

test("pago: informado por el cliente gana sobre un cobro pendiente, y apunta a ese cobro", () => {
  const e = estadoPago(
    hechos({
      etapa: "ganado",
      etiquetas: ["cliente", "pago_por_confirmar"],
      pagos: [{ id: "p1", estado: "pendiente", monto: 45000, creadoEn: haceDias(2), pagadoEn: null }],
      resultados: [{ tipo: "venta_confirmada", creadoEn: haceDias(1), puntaje: null }],
    }),
  );
  assert.equal(e.tipo, "informado");
  assert.equal(e.pagoPendienteId, "p1");
  assert.equal(e.desde, haceDias(1));
});

test("pago: confirmado solo si el cobro pagado es de este ciclo", () => {
  const viejo = { id: "p0", estado: "pagado", monto: 10000, creadoEn: haceDias(200), pagadoEn: haceDias(199) };
  assert.equal(estadoPago(hechos({ etapa: "cotizado", etapaEn: haceDias(5), pagos: [viejo] })).tipo, "sin_cobro");
  const nuevo = { id: "p2", estado: "pagado", monto: 30000, creadoEn: haceDias(2), pagadoEn: haceDias(1) };
  const e = estadoPago(hechos({ etapa: "ganado", etapaEn: haceDias(1), pagos: [viejo, nuevo] }));
  assert.equal(e.tipo, "confirmado");
  assert.equal(e.monto, 30000);
});

test("pago: ganada a mano hoy con un cobro de hace 5 meses NO se ve como pagada", () => {
  const viejo = { id: "p0", estado: "pagado", monto: 10000, creadoEn: haceDias(151), pagadoEn: haceDias(150) };
  assert.equal(
    estadoPago(hechos({ etapa: "ganado", etapaManual: true, etapaMotivo: null, etapaEn: haceMin(5), pagos: [viejo] })).tipo,
    "sin_cobro",
  );
  // Confirmar el pago mueve a Ganado un instante DESPUÉS de pagado_en: cuenta.
  const recien = { id: "p1", estado: "pagado", monto: 20000, creadoEn: haceMin(3), pagadoEn: haceMin(2) };
  assert.equal(
    estadoPago(hechos({ etapa: "ganado", etapaMotivo: "pago_confirmado", etapaEn: new Date(Date.parse(recien.pagadoEn) + 800).toISOString(), pagos: [recien] })).tipo,
    "confirmado",
  );
  // Arrastrada a Ganado dos días después del pago: ya no es el mismo momento.
  assert.equal(estadoPago(hechos({ etapa: "ganado", etapaEn: haceDias(1), pagos: [{ ...recien, pagadoEn: haceDias(3) }] })).tipo, "sin_cobro");
  // Ciclo nuevo (vuelve a cotizar una hora después de pagar): el pago anterior queda fuera.
  assert.equal(estadoPago(hechos({ etapa: "cotizado", etapaMotivo: "nuevo_ciclo", etapaEn: haceMin(1), pagos: [recien] })).tipo, "sin_cobro");
  assert.equal(pagoDelCiclo(haceDias(1), "ganado", null), true);
});

test("pago: cobro pendiente, falta pago y anulados", () => {
  assert.equal(
    estadoPago(hechos({ pagos: [{ id: "p", estado: "pendiente", monto: 9000, creadoEn: haceDias(1), pagadoEn: null }] })).tipo,
    "cobro_pendiente",
  );
  assert.equal(estadoPago(hechos({ etiquetas: ["pago_pendiente"] })).tipo, "falta_pago");
  assert.equal(
    estadoPago(hechos({ pagos: [{ id: "p", estado: "anulado", monto: 9000, creadoEn: haceDias(1), pagadoEn: null }] })).tipo,
    "sin_cobro",
  );
});

// ─── Derivaciones ───────────────────────────────────────────────────────────

test("derivaciones: las que abre el sistema no se leen como duda del asistente", () => {
  assert.equal(clasificarDerivacion("incertidumbre", RESUMEN_FALLO_CANAL).clase, "problema_tecnico");
  assert.equal(clasificarDerivacion("incertidumbre", RESUMEN_FALLO_MODELO).clase, "problema_tecnico");
  assert.equal(clasificarDerivacion("incertidumbre", RESUMEN_AUDIO).label, "Mandó un audio");
  assert.equal(clasificarDerivacion("sentimiento_negativo", "x").clase, "cliente_molesto");
  assert.equal(clasificarDerivacion("pedido_explicito", null).clase, "pidio_persona");
  assert.equal(clasificarDerivacion("algo_nuevo", null).clase, "asistente_no_pudo");
});

// ─── Atención y prioridad ───────────────────────────────────────────────────

test("prioridad: molesto y pidió persona son urgentes; lo de >7 días va a antiguos", () => {
  const a = atencionRequerida(
    hechos({ modo: "humano", derivaciones: [{ trigger: "pedido_explicito", resumen: null, creadoEn: haceMin(20) }] }),
    DUENO,
  );
  assert.equal(a.grupo, "urgente");
  assert.equal(a.principal.label, "Pidió hablar con una persona");

  const vieja = atencionRequerida(
    hechos({ modo: "humano", derivaciones: [{ trigger: "incertidumbre", resumen: null, creadoEn: haceDias(DIAS_ANTIGUO + 34) }] }),
    DUENO,
  );
  assert.equal(vieja.grupo, "antiguo");
  assert.equal(vieja.principal.antiguo, true);
});

test("prioridad: un pendiente de hoy le gana a una derivación urgente de hace semanas", () => {
  const a = atencionRequerida(
    hechos({
      etapa: "ganado",
      etiquetas: ["pago_por_confirmar"],
      derivaciones: [{ trigger: "sentimiento_negativo", resumen: null, creadoEn: haceDias(20) }],
      resultados: [{ tipo: "venta_confirmada", creadoEn: haceMin(40), puntaje: null }],
    }),
    DUENO,
  );
  assert.equal(a.principal.motivo, "pago_por_confirmar");
  assert.equal(a.items.length, 2);
  assert.equal(a.items[1].motivo, "cliente_molesto");
});

test("atención: dos derivaciones de la misma clase son una fila, con la fecha más antigua", () => {
  const a = atencionRequerida(
    hechos({
      derivaciones: [
        { trigger: "incertidumbre", resumen: null, creadoEn: haceMin(10) },
        { trigger: "sin_resolver", resumen: null, creadoEn: haceMin(90) },
      ],
    }),
    DUENO,
  );
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].desde, haceMin(90));
});

test("atención: chat tomado por una persona con el cliente hablando último", () => {
  const h = hechos({ modo: "humano", ultimoMensajeRol: "cliente", ultimoMensajeEn: haceMin(50) });
  assert.equal(atencionRequerida(h, DUENO).principal.motivo, "cliente_espera");
  // Atendido por Tino: responde Tino, no hay nada que pedirle al negocio.
  assert.equal(atencionRequerida({ ...h, modo: "bot" }, DUENO).requiere, false);
  // Muy viejo: no se cuenta como alguien esperando.
  assert.equal(atencionRequerida({ ...h, ultimoMensajeEn: haceDias(45) }, DUENO).requiere, false);
  // Con derivación abierta, la derivación lo cubre: no se duplica.
  const conDerivacion = atencionRequerida(
    { ...h, derivaciones: [{ trigger: "incertidumbre", resumen: null, creadoEn: haceMin(50) }] },
    DUENO,
  );
  assert.deepEqual(conDerivacion.items.map((i) => i.motivo), ["asistente_no_pudo"]);
});

test("atención: «Ya lo atendí» saca al cliente que espera hasta que vuelva a escribir", () => {
  const h = hechos({ modo: "humano", ultimoMensajeRol: "cliente", ultimoMensajeEn: haceMin(50) });
  assert.equal(atencionRequerida({ ...h, atendidaEn: haceMin(10) }, DUENO).requiere, false);
  // Atendida ANTES del último mensaje: el mensaje nuevo sí espera.
  assert.equal(atencionRequerida({ ...h, atendidaEn: haceMin(90) }, DUENO).principal.motivo, "cliente_espera");
});

test("atención: sin señales, no requiere nada", () => {
  const a = atencionRequerida(hechos(), DUENO);
  assert.equal(a.requiere, false);
  assert.equal(a.principal, null);
});

test("atención: cita activa que ya terminó", () => {
  const a = atencionRequerida(
    hechos({ citas: [{ id: "c1", inicio: haceMin(180), fin: haceMin(120), estado: "confirmada" }] }),
    DUENO,
  );
  assert.equal(a.principal.motivo, "cita_por_cerrar");
});

// ─── Permisos de aprobación ─────────────────────────────────────────────────

test("propuesta de Beto: el dueño aprueba, el staff solo la ve", () => {
  const h = hechos({ etapa: "cotizado", propuestas: [{ estado: "propuesto", creadoEn: haceMin(30), resueltoEn: null, motivo: null }] });
  const dueno = siguienteAccion(h, DUENO);
  const staff = siguienteAccion(h, STAFF);
  assert.equal(dueno.tipo, "revisar_propuesta");
  assert.equal(dueno.puedeAprobar, true);
  assert.equal(staff.tipo, "revisar_propuesta");
  assert.equal(staff.puedeAprobar, false);
  assert.match(atencionRequerida(h, STAFF).principal.label, /dueño/);
});

// ─── Acciones contextuales ──────────────────────────────────────────────────

test("acción: una por motivo, determinista", () => {
  const pendiente = { id: "p9", estado: "pendiente", monto: 1000, creadoEn: haceDias(1), pagadoEn: null };
  const casos = [
    [hechos({ modo: "humano", derivaciones: [{ trigger: "sentimiento_negativo", resumen: null, creadoEn: haceMin(5) }] }), DUENO, "responder"],
    [hechos({ etapa: "ganado", etiquetas: ["pago_por_confirmar"], pagos: [pendiente] }), DUENO, "confirmar_pago"],
    [hechos({ etiquetas: ["pago_pendiente"] }), DUENO, "pedir_pago"],
    [hechos({ etiquetas: ["pago_pendiente"] }), { ...DUENO, tienePagoLink: false }, "responder"],
    [hechos({ modo: "humano", ultimoMensajeRol: "humano" }), DUENO, "devolver_a_tino"],
    [hechos({ etapa: "cotizado", ultimoMensajeEn: haceDias(6), ultimoMensajeRol: "empleado" }), DUENO, "retomar"],
    [hechos({ etapa: "cotizado", ultimoMensajeEn: haceDias(6), ultimoMensajeRol: "empleado" }), { ...DUENO, betoCotizaciones: true }, null],
    [hechos(), DUENO, null],
  ];
  for (const [h, ctx, esperado] of casos) {
    const a = siguienteAccion(h, ctx);
    assert.equal(a ? a.tipo : null, esperado, JSON.stringify({ etiquetas: h.etiquetas, modo: h.modo, etapa: h.etapa }));
  }
  const conPago = siguienteAccion(hechos({ etapa: "ganado", etiquetas: ["pago_por_confirmar"], pagos: [pendiente] }), DUENO);
  assert.equal(conPago.pagoId, "p9");
});

// ─── sin_respuesta + Beto ───────────────────────────────────────────────────

test("Beto: perdido por silencio es retomable; una pérdida explícita no", () => {
  assert.equal(retomablePorBeto({ etapa: "perdido", etapaMotivo: "sin_respuesta", etiquetas: [] }), true);
  for (const m of MOTIVOS_PERDIDA.filter((x) => x.explicita)) {
    assert.equal(retomablePorBeto({ etapa: "perdido", etapaMotivo: m.valor, etiquetas: [] }), false, m.valor);
  }
  assert.equal(retomablePorBeto({ etapa: "perdido", etapaMotivo: null, etiquetas: [] }), false);
  assert.equal(retomablePorBeto({ etapa: "cotizado", etapaMotivo: null, etiquetas: ["no_contactar"] }), false);
});

test("Beto: la regla de la ficha dice lo mismo que la reja del generador", () => {
  const etapas = ["nuevo", "interesado", "cotizado", "ganado", "perdido"];
  const motivos = [null, "sin_respuesta", "no_interesado", "eligio_competencia", "no_contactar", "pago_detectado"];
  const etiquetas = [[], ["cotizacion"], ["no_contactar"], ["cotizacion", "no_contactar"]];
  for (const etapa of etapas)
    for (const etapaMotivo of motivos)
      for (const et of etiquetas) {
        const ficha = retomablePorBeto({ etapa, etapaMotivo, etiquetas: et });
        // Candidato ideal en todo lo demás: 7 días de silencio, habló el negocio.
        const v = decidirCotizacion(
          { chatId: "x", etiquetas: et, etapa, etapaMotivo, ultimoMensajeEn: haceDias(7), ultimoRol: "empleado" },
          AHORA,
        );
        assert.equal(ficha, v.enviar, `${etapa}/${etapaMotivo}/${et.join("+")} → generador: ${v.enviar ? "sí" : v.motivo}`);
      }
});

test("Beto: estados visibles sin fingir actividad", () => {
  const perdidoSilencio = hechos({ etapa: "perdido", etapaMotivo: "sin_respuesta" });
  assert.equal(estadoBeto(perdidoSilencio, DUENO).tipo, "apagado");
  assert.equal(estadoBeto(perdidoSilencio, { ...DUENO, betoCotizaciones: true }).tipo, "sin_actividad");
  assert.equal(estadoBeto(hechos({ etapa: "perdido", etapaMotivo: "no_interesado" }), DUENO), null);

  const prop = (estado, dias) => ({ estado, creadoEn: haceDias(dias), resueltoEn: estado === "propuesto" ? null : haceDias(dias), motivo: "el cliente dijo que no" });
  assert.equal(estadoBeto(hechos({ etapa: "cotizado", propuestas: [prop("propuesto", 1)] }), DUENO).tipo, "esperando_aprobacion");
  assert.equal(estadoBeto(hechos({ etapa: "cotizado", propuestas: [prop("frenado", 1)] }), DUENO).tipo, "frenado");

  const seg = (extra) => ({ tipo: "cotizacion_sin_respuesta", programadoPara: haceDias(2), enviadoEn: null, descartado: null, respuestaRecibida: false, rol: "rita", ...extra });
  assert.equal(estadoBeto(hechos({ etapa: "cotizado", seguimientos: [seg()] }), DUENO).tipo, "programado");
  assert.equal(estadoBeto(hechos({ etapa: "cotizado", seguimientos: [seg({ enviadoEn: haceDias(1) })] }), DUENO).tipo, "enviado");
  const desc = estadoBeto(hechos({ etapa: "cotizado", seguimientos: [seg({ enviadoEn: haceDias(1), descartado: "no_contactar" })] }), DUENO);
  assert.equal(desc.tipo, "descartado");
  assert.equal(desc.motivo, "no_contactar");
});

test("cierre por silencio: repite una pérdida explícita previa si el cliente no volvió a escribir", () => {
  const explicita = { ultima_perdida: { motivo: "no_interesado", en: haceDias(10) } };
  assert.equal(motivoCierrePorSilencio(explicita, "empleado", haceDias(8)), "no_interesado");
  assert.equal(motivoCierrePorSilencio(explicita, "cliente", haceDias(9)), "sin_respuesta", "volvió a escribir: ciclo nuevo");
  assert.equal(motivoCierrePorSilencio({ ultima_perdida: { motivo: "sin_respuesta", en: haceDias(10) } }, "empleado", haceDias(8)), "sin_respuesta");
  assert.equal(motivoCierrePorSilencio(null, "empleado", haceDias(8)), "sin_respuesta");
  // Y lo que repite no es retomable por Beto.
  assert.equal(retomablePorBeto({ etapa: "perdido", etapaMotivo: motivoCierrePorSilencio(explicita, "empleado", haceDias(8)), etiquetas: [] }), false);
});

test("motivo de etapa: se muestra el de pérdida y el de pago informado", () => {
  assert.equal(etiquetaMotivoEtapa("perdido", "sin_respuesta"), "Sin respuesta");
  assert.equal(etiquetaMotivoEtapa("perdido", null), "Sin motivo registrado");
  assert.equal(etiquetaMotivoEtapa("ganado", "pago_detectado"), "Dijo que pagó");
  assert.equal(etiquetaMotivoEtapa("cotizado", null), null);
});

// ─── Oportunidades ──────────────────────────────────────────────────────────

test("oportunidad: cotización viva, sin respuesta, fría y cobro pendiente", () => {
  const cot = (dias, rol = "empleado") => hechos({ etapa: "cotizado", ultimoMensajeEn: haceDias(dias), ultimoMensajeRol: rol });
  assert.equal(oportunidadAbierta(cot(1), DUENO).tipo, "cotizacion_activa");
  assert.equal(oportunidadAbierta(cot(10, "cliente"), DUENO).tipo, "cotizacion_activa");
  assert.equal(oportunidadAbierta(cot(10), DUENO).tipo, "cotizacion_sin_respuesta");
  assert.equal(oportunidadAbierta(cot(40), DUENO), null);
  assert.equal(oportunidadAbierta(hechos({ etapa: "perdido", etapaMotivo: "sin_respuesta" }), DUENO), null);
  const cobro = oportunidadAbierta(
    hechos({ etapa: "ganado", pagos: [{ id: "p", estado: "pendiente", monto: 52000, creadoEn: haceDias(1), pagadoEn: null }] }),
    DUENO,
  );
  assert.equal(cobro.tipo, "cobro_pendiente");
  assert.equal(cobro.monto, 52000);
  // No hay montos inventados: una cotización no trae monto.
  assert.equal(oportunidadAbierta(cot(1), DUENO).monto, null);
});

// ─── Coherencia del estado completo ─────────────────────────────────────────

test("estado derivado coherente: ganado por pago informado", () => {
  const e = derivarEstadoComercial(
    hechos({
      etapa: "ganado",
      etapaMotivo: "pago_detectado",
      etiquetas: ["cliente", "pago_por_confirmar"],
      resultados: [{ tipo: "venta_confirmada", creadoEn: haceMin(90), puntaje: null }],
    }),
    DUENO,
  );
  assert.equal(e.etapaLabel, "Ganado");
  assert.equal(e.motivoEtapa, "Dijo que pagó");
  assert.equal(e.pago.tipo, "informado");
  assert.notEqual(e.pago.tipo, "confirmado");
  assert.equal(e.accion.tipo, "confirmar_pago");
  assert.equal(e.oportunidad, null);
  assert.equal(e.beto, null);
});

test("estado derivado coherente: reabierto conserva la pérdida anterior", () => {
  const e = derivarEstadoComercial(
    hechos({ etapa: "nuevo", etapaMotivo: "volvio_a_escribir", datos: { ultima_perdida: { motivo: "sin_respuesta", en: haceDias(3) } } }),
    DUENO,
  );
  assert.equal(e.motivoEtapa, "Volvió a escribir");
  assert.equal(e.perdidaAnterior.motivo, "sin_respuesta");
});

test("identidad y actividad", () => {
  assert.equal(canalDe("ig:123"), "instagram");
  assert.equal(canalDe("56911112222"), "whatsapp");
  const act = actividadReciente(
    hechos({
      pagos: [{ id: "p", estado: "pagado", monto: 12000, creadoEn: haceDias(3), pagadoEn: haceDias(2) }],
      resultados: [{ tipo: "cotizacion_enviada", creadoEn: haceDias(4), puntaje: null }],
      seguimientos: [{ tipo: "pedido_listo", programadoPara: haceDias(1), enviadoEn: haceDias(1), descartado: null, respuestaRecibida: false, rol: "tino" }],
    }),
  );
  assert.deepEqual(act.map((x) => x.label), ["Aviso de pedido listo", "Pago confirmado: $12.000", "Cobro enviado por $12.000", "Se envió una cotización"]);
});
