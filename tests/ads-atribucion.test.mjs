import assert from "node:assert/strict";
import test from "node:test";

import {
  agruparPorAnuncio,
  claveDeAviso,
  estadoAtribucion,
  nombreDeAviso,
  resumenPauta,
} from "../lib/ads/atribucionCore.ts";

/**
 * El informe de pauta es de los que se leen una vez y se creen para siempre: si
 * dice que un aviso trajo $890.000, nadie va a ir a contarlo a mano. Por eso lo
 * que se prueba acá no es que sume, es que NO cuente de más.
 */

const contacto = (chatId, campana) => ({ chatId, campana });

test("un chat cuenta una sola vez aunque tenga varios resultados", () => {
  const [fila] = agruparPorAnuncio({
    contactos: [contacto("569111", { anuncioId: "120", titular: "Flyers desde $30" })],
    resultados: [
      { chatId: "569111", tipo: "venta_confirmada" },
      { chatId: "569111", tipo: "venta_recuperada" },
      { chatId: "569111", tipo: "agendamiento" },
      { chatId: "569111", tipo: "agendamiento" },
    ],
    pagos: [],
  });

  assert.equal(fila.conversaciones, 1);
  assert.equal(fila.ventas, 1, "dos resultados de venta en el mismo chat son UNA venta");
  assert.equal(fila.agendadas, 1);
});

test("los pagos SÍ se suman todos: dos abonos son dos pagos", () => {
  const [fila] = agruparPorAnuncio({
    contactos: [contacto("569111", { anuncioId: "120" })],
    resultados: [],
    pagos: [
      { chatId: "569111", monto: 50000 },
      { chatId: "569111", monto: 30000 },
    ],
  });
  assert.equal(fila.pagado, 80000);
});

test("una venta de un chat SIN anuncio no se le atribuye a la pauta", () => {
  const filas = agruparPorAnuncio({
    contactos: [contacto("569111", { anuncioId: "120" })],
    resultados: [{ chatId: "569999", tipo: "venta_confirmada" }],
    pagos: [{ chatId: "569999", monto: 900000 }],
  });

  assert.equal(filas.length, 1);
  assert.equal(filas[0].ventas, 0);
  assert.equal(filas[0].pagado, 0, "la plata que no vino del aviso no es del aviso");
});

test("los contactos se agrupan por id de anuncio, no por titular", () => {
  const filas = agruparPorAnuncio({
    contactos: [
      contacto("a", { anuncioId: "120", titular: "Flyers desde $30" }),
      // Mismo aviso, titular editado después en Meta: sigue siendo uno solo.
      contacto("b", { anuncioId: "120", titular: "Flyers desde $35" }),
      contacto("c", { anuncioId: "999", titular: "Tarjetas" }),
    ],
    resultados: [],
    pagos: [],
  });

  assert.equal(filas.length, 2);
  const flyers = filas.find((f) => f.anuncioId === "120");
  assert.equal(flyers.conversaciones, 2);
});

test("un chat repetido en la entrada no se cuenta dos veces", () => {
  const filas = agruparPorAnuncio({
    contactos: [contacto("a", { anuncioId: "120" }), contacto("a", { anuncioId: "120" })],
    resultados: [],
    pagos: [],
  });
  assert.equal(filas[0].conversaciones, 1);
});

test("se cuenta cuántas conversaciones traen el identificador del clic", () => {
  const [fila] = agruparPorAnuncio({
    contactos: [
      contacto("a", { anuncioId: "120", ctwaClid: "ARAxyz" }),
      contacto("b", { anuncioId: "120" }),
    ],
    resultados: [],
    pagos: [],
  });
  assert.equal(fila.conversaciones, 2);
  assert.equal(fila.conClid, 1, "sin clid esa conversación no se le puede devolver a Meta");
});

test("el orden pone primero lo que trajo plata", () => {
  const filas = agruparPorAnuncio({
    contactos: [
      contacto("a", { anuncioId: "muchos_clics" }),
      contacto("b", { anuncioId: "muchos_clics" }),
      contacto("c", { anuncioId: "muchos_clics" }),
      contacto("d", { anuncioId: "vendio" }),
    ],
    resultados: [],
    pagos: [{ chatId: "d", monto: 120000 }],
  });
  assert.equal(filas[0].anuncioId, "vendio");
});

test("un aviso sin id se agrupa por su titular y se nombra de forma legible", () => {
  const filas = agruparPorAnuncio({
    contactos: [contacto("a", { titular: "Pendones 2x1" }), contacto("b", { titular: "Pendones 2x1" })],
    resultados: [],
    pagos: [],
  });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].titular, "Pendones 2x1");
  assert.equal(filas[0].conversaciones, 2);
});

test("sin titular ni id, el aviso se llama por lo que es y no revienta", () => {
  assert.equal(nombreDeAviso({}), "Anuncio sin identificar");
  assert.equal(claveDeAviso({}), "sin_id");
  assert.equal(nombreDeAviso({ anuncioId: "120210000000123456" }), "Anuncio 123456");
});

test("montos basura no ensucian el total", () => {
  const [fila] = agruparPorAnuncio({
    contactos: [contacto("a", { anuncioId: "120" })],
    resultados: [],
    pagos: [
      { chatId: "a", monto: Number.NaN },
      { chatId: "a", monto: -5000 },
      { chatId: "a", monto: 12000 },
    ],
  });
  assert.equal(fila.pagado, 12000);
});

test("el resumen calcula cuántas conversaciones cuesta una venta", () => {
  const filas = agruparPorAnuncio({
    contactos: [
      contacto("a", { anuncioId: "1" }),
      contacto("b", { anuncioId: "1" }),
      contacto("c", { anuncioId: "1" }),
      contacto("d", { anuncioId: "1" }),
    ],
    resultados: [{ chatId: "a", tipo: "venta_confirmada" }],
    pagos: [],
  });
  const r = resumenPauta(filas);
  assert.equal(r.conversaciones, 4);
  assert.equal(r.ventas, 1);
  assert.equal(r.porVenta, 4);
});

test("sin ventas todavía, no se inventa una división por cero", () => {
  const r = resumenPauta(
    agruparPorAnuncio({
      contactos: [contacto("a", { anuncioId: "1" })],
      resultados: [],
      pagos: [],
    }),
  );
  assert.equal(r.porVenta, 0);
});

test("el estado de la atribución dice la verdad en los tres casos", () => {
  const vacio = resumenPauta([]);
  assert.equal(estadoAtribucion(vacio).nivel, "sin_datos");

  const sinClid = resumenPauta(
    agruparPorAnuncio({
      contactos: [contacto("a", { anuncioId: "1" })],
      resultados: [],
      pagos: [],
    }),
  );
  assert.equal(estadoAtribucion(sinClid).nivel, "solo_lectura");

  const conClid = resumenPauta(
    agruparPorAnuncio({
      contactos: [contacto("a", { anuncioId: "1", ctwaClid: "ARAxyz" })],
      resultados: [],
      pagos: [],
    }),
  );
  assert.equal(estadoAtribucion(conClid).nivel, "listo");
});
