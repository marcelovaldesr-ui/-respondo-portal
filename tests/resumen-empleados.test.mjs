/**
 * TARJETAS DEL EQUIPO EN LA PORTADA (Fase 0): paginado, sin descartados y
 * "esperando" por conversación.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

test("resumenEmpleados: >1.000 mensajes, descartados fuera, esperando por chat de cualquier fecha", async () => {
  const mes = new Date(Date.now() - 60_000).toISOString();
  const mensajes = [];
  for (let i = 0; i < 1500; i++) mensajes.push({ empleado_id: "tino", chat_id: `c${i % 400}`, rol: i % 2 ? "cliente" : "empleado", creado_en: mes });
  const base = crearBaseMemoria({
    ed_empleados: [
      { id: "tino", cliente_id: "c1", rol: "tino", nombre_publico: "Tino", activo: true },
      { id: "beto", cliente_id: "c1", rol: "rita", nombre_publico: "Beto", activo: true },
    ],
    ed_mensajes: mensajes,
    ed_escalaciones: [
      { empleado_id: "tino", chat_id: "x", atendida_en: null, creado_en: "2026-01-01T00:00:00Z" }, // vieja, sigue esperando
      { empleado_id: "tino", chat_id: "x", atendida_en: null, creado_en: mes },
      { empleado_id: "tino", chat_id: "y", atendida_en: null, creado_en: mes },
    ],
    ed_seguimientos: [
      { empleado_id: "beto", tipo: "cotizacion_sin_respuesta", enviado_en: mes, respuesta_recibida: true, variables: {} },
      { empleado_id: "beto", tipo: "cotizacion_sin_respuesta", enviado_en: mes, respuesta_recibida: false, variables: { descartado: "no_contactar" } },
      { empleado_id: "beto", tipo: "encuesta_postventa", enviado_en: mes, respuesta_recibida: false, variables: {} },
    ],
    ed_resultados: [],
  });
  const { resumenEmpleados } = await import("../lib/resumen.ts");
  const r = await resumenEmpleados("c1", base);
  const tino = r.find((e) => e.rol === "tino");
  const beto = r.find((e) => e.rol === "rita");
  assert.equal(tino.conversaciones, 400, "antes quedaba cortado por las 1.000 filas");
  assert.equal(tino.escalacionesPendientes, 2, "x (dos derivaciones, una vieja) + y");
  assert.equal(beto.seguimientosEnviados, 2, "el descartado no cuenta");
  assert.equal(beto.seguimientosConRespuesta, 1);
  assert.deepEqual(beto.seguimientosPorTipo, { cotizacion_sin_respuesta: 1, encuesta_postventa: 1 });
  assert.equal(tino.completo, true);
});
