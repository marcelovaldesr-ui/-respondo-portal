import assert from "node:assert/strict";
import test from "node:test";

import {
  clavePersona,
  pct,
  resumirFidelizacion,
} from "../lib/fidelizacionCore.ts";

/**
 * Panel de fidelización.
 *
 * Estos números se los muestra el portal a la gerencia del cliente para
 * decidir si sigue pagando. Un error acá no rompe nada visible: produce un
 * número creíble y falso, que es la peor falla posible en un panel. Por eso se
 * prueban sobre todo los DENOMINADORES, que es donde se miente sin querer.
 */

const AHORA = Date.parse("2026-08-26T12:00:00Z");
const dias = (n) => new Date(AHORA + n * 86400_000).toISOString();

function cita(p = {}) {
  return {
    chatId: "56990000001",
    telefono: null,
    estado: "completada",
    origen: "whatsapp",
    empleadoId: null,
    creadoEn: dias(-1),
    ...p,
  };
}

test("una persona es la misma aunque el teléfono venga escrito distinto", () => {
  assert.equal(clavePersona({ chatId: "56985761941", telefono: null }), "56985761941");
  assert.equal(clavePersona({ chatId: null, telefono: "+56 9 8576 1941" }), "56985761941");
  assert.equal(
    clavePersona({ chatId: "56985761941", telefono: "otro" }),
    "56985761941",
    "el chat_id manda sobre el teléfono escrito a mano",
  );
});

test("una cita sin manera de identificar a nadie se excluye, no se inventa", () => {
  // Contarla como persona nueva bajaría la tasa de retorno; contarla como
  // repetida la subiría. Las dos cosas son mentira.
  assert.equal(clavePersona({ chatId: null, telefono: null }), null);
  assert.equal(clavePersona({ chatId: "  ", telefono: "123" }), null, "un fijo corto no sirve");
});

test("un porcentaje sin denominador es 0 y no NaN", () => {
  assert.equal(pct(0, 0), 0);
  assert.equal(pct(3, 4), 75);
});

test("el empleado que la creó manda sobre el canal de origen", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [
      cita({ origen: "portal", empleadoId: "emp-1" }), // la cargó el bot desde el portal
      cita({ origen: "whatsapp", empleadoId: null }),
      cita({ origen: "web", empleadoId: null }),
      cita({ origen: "portal", empleadoId: null }), // esta sí la tecleó una persona
      cita({ origen: "importada", empleadoId: null }),
    ],
    citasAnio: [],
    seguimientos: [],
  });
  assert.equal(r.porAsistente, 2);
  assert.equal(r.porEnlace, 1);
  assert.equal(r.porEquipo, 2, "portal a mano e importada son trabajo humano");
  assert.equal(r.porcentajeSinIntervencion, 60);
});

test("la inasistencia se mide sobre las horas que ya pasaron", () => {
  // Con el total como denominador, agendar más bajaría el % de inasistencia
  // sin que nadie faltara menos. El panel premiaría algo que no ocurrió.
  const r = resumirFidelizacion({
    citasPeriodo: [
      cita({ estado: "completada" }),
      cita({ estado: "completada" }),
      cita({ estado: "completada" }),
      cita({ estado: "no_show" }),
      cita({ estado: "agendada" }), // es la semana que viene
      cita({ estado: "agendada" }),
      cita({ estado: "cancelada" }), // avisó: no es lo mismo que no aparecer
    ],
    citasAnio: [],
    seguimientos: [],
  });
  assert.equal(r.citas, 7);
  assert.equal(r.porcentajeNoShow, 25, "1 de 4 cerradas, no 1 de 7");
  assert.equal(r.canceladas, 1);
});

test("sin horas cerradas la inasistencia es 0, no una división por cero", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [cita({ estado: "agendada" })],
    citasAnio: [],
    seguimientos: [],
  });
  assert.equal(r.porcentajeNoShow, 0);
});

test("vuelve una PERSONA, no una cita", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [],
    citasAnio: [
      cita({ chatId: "a" }),
      cita({ chatId: "a" }),
      cita({ chatId: "a" }), // tres visitas, un solo cliente que vuelve
      cita({ chatId: "b" }),
      cita({ chatId: "c" }),
      cita({ chatId: "c" }),
      cita({ chatId: null, telefono: null }), // no se puede atribuir
    ],
    seguimientos: [],
  });
  assert.equal(r.personasAtendidas, 3);
  assert.equal(r.personasQueVolvieron, 2);
  assert.equal(r.tasaRetorno, 67);
});

test("el retorno solo cuenta la atención que se cumplió", () => {
  // Alguien que agendó dos veces y no llegó ninguna no es un cliente fiel.
  const r = resumirFidelizacion({
    citasPeriodo: [],
    citasAnio: [
      cita({ chatId: "a", estado: "completada" }),
      cita({ chatId: "a", estado: "no_show" }),
      cita({ chatId: "b", estado: "cancelada" }),
      cita({ chatId: "b", estado: "cancelada" }),
    ],
    seguimientos: [],
  });
  assert.equal(r.personasAtendidas, 1, "b nunca se atendió");
  assert.equal(r.personasQueVolvieron, 0);
});

test("reactivado es el que AGENDA después del mensaje, no el que contesta", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [],
    citasAnio: [
      // Ana: le llegó el mensaje y reservó tres días después. Cuenta.
      cita({ chatId: "ana", creadoEn: dias(-7) }),
      // Beto: contestó pero no reservó nunca. No cuenta.
      // Cata: ya tenía hora ANTES del mensaje. El mensaje no la produjo.
      cita({ chatId: "cata", creadoEn: dias(-30) }),
    ],
    seguimientos: [
      { chatId: "ana", tipo: "mantencion_toca", enviadoEn: dias(-10), respuestaRecibida: true },
      { chatId: "beto", tipo: "mantencion_toca", enviadoEn: dias(-10), respuestaRecibida: true },
      { chatId: "cata", tipo: "mantencion_toca", enviadoEn: dias(-10), respuestaRecibida: false },
    ],
  });
  assert.equal(r.seguimientosEnviados, 3);
  assert.equal(r.seguimientosRespondidos, 2);
  assert.equal(r.tasaRespuesta, 67);
  assert.equal(r.reactivados, 1, "solo Ana");
});

test("tres mensajes a la misma persona son un reactivado, no tres", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [],
    citasAnio: [cita({ chatId: "ana", creadoEn: dias(-5) })],
    seguimientos: [
      { chatId: "ana", tipo: "mantencion_toca", enviadoEn: dias(-9), respuestaRecibida: false },
      { chatId: "ana", tipo: "recordatorio_cita", enviadoEn: dias(-8), respuestaRecibida: false },
      { chatId: "ana", tipo: "encuesta_postventa", enviadoEn: dias(-7), respuestaRecibida: false },
    ],
  });
  assert.equal(r.reactivados, 1);
});

test("la ventana de reactivación tiene borde: 20 días después ya no es mérito del mensaje", () => {
  const entrada = {
    citasPeriodo: [],
    citasAnio: [cita({ chatId: "ana", creadoEn: dias(10) })],
    seguimientos: [
      { chatId: "ana", tipo: "mantencion_toca", enviadoEn: dias(-10), respuestaRecibida: false },
    ],
  };
  assert.equal(resumirFidelizacion(entrada).reactivados, 0, "pasaron 20 días");
  assert.equal(
    resumirFidelizacion({ ...entrada, ventanaReactivacionDias: 30 }).reactivados,
    1,
  );
});

test("un seguimiento programado pero no enviado no cuenta como enviado", () => {
  const r = resumirFidelizacion({
    citasPeriodo: [],
    citasAnio: [],
    seguimientos: [
      { chatId: "ana", tipo: "mantencion_toca", enviadoEn: null, respuestaRecibida: false },
    ],
  });
  assert.equal(r.seguimientosEnviados, 0);
  assert.equal(r.tasaRespuesta, 0);
});

test("un negocio sin nada devuelve ceros y no revienta", () => {
  const r = resumirFidelizacion({ citasPeriodo: [], citasAnio: [], seguimientos: [] });
  assert.equal(r.citas, 0);
  assert.equal(r.tasaRetorno, 0);
  assert.equal(r.reactivados, 0);
  assert.equal(r.ventanaReactivacionDias, 14);
});
