import assert from "node:assert/strict";
import test from "node:test";

import { armarMetricas, disponibles, variacion } from "../lib/ads/metricas.ts";
import { hallazgos } from "../lib/ads/insights.ts";
import { agruparPorAnuncio, resumenPauta } from "../lib/ads/atribucionCore.ts";

/**
 * Lo que se prueba acá es la honestidad del panel, no la aritmética.
 *
 * El error caro de un panel de publicidad no es sumar mal: es mostrar un cero
 * donde debería decir «no lo sabemos». Se ven igual y llevan a conclusiones
 * opuestas, y la que se ve bien es la falsa.
 */

const propios = {
  conversaciones: 40,
  cotizaciones: 18,
  agendadas: 12,
  ventas: 8,
  cobrado: { valor: 890000, moneda: "CLP" },
};

const plataforma = {
  impresiones: 12000,
  clics: 300,
  gasto: { valor: 120000, moneda: "CLP" },
};

const buscar = (grupos, clave) =>
  grupos.flatMap((g) => g.metricas).find((m) => m.clave === clave);

test("⭐⭐ sin conexión con Meta, el gasto NO es cero: es «no disponible»", () => {
  const g = armarMetricas({ plataforma: null, propios });
  const gasto = buscar(g, "gasto");

  assert.equal(gasto.valor, null);
  assert.equal(gasto.certeza, "no_disponible");
  assert.ok(gasto.motivo.length > 20, "tiene que decir cómo conseguirlo");
});

test("⭐⭐ sin conexión, lo NUESTRO se muestra igual", () => {
  // Es la tesis del producto: la atribución no necesita ninguna integración.
  const g = armarMetricas({ plataforma: null, propios });

  assert.equal(buscar(g, "conversaciones").valor, 40);
  assert.equal(buscar(g, "ventas").valor, 8);
  assert.equal(buscar(g, "cobrado").valor, 890000);
});

test("los costos por unidad solo existen si hay gasto", () => {
  const sin = armarMetricas({ plataforma: null, propios });
  assert.equal(buscar(sin, "costo_conversacion").certeza, "no_disponible");

  const con = armarMetricas({ plataforma, propios });
  const c = buscar(con, "costo_conversacion");
  assert.equal(c.certeza, "derivada");
  assert.equal(c.monto.valor, 3000); // 120.000 / 40
});

test("⭐ lo cobrado siempre es PARCIAL y lo dice", () => {
  const g = armarMetricas({ plataforma, propios });
  const cobrado = buscar(g, "cobrado");

  assert.equal(cobrado.certeza, "parcial");
  assert.match(cobrado.motivo, /transferencia|piso/i);
});

test("⭐⭐ con monedas distintas el retorno NO se calcula", () => {
  // Dividir dólares por pesos da un número que parece correcto y no significa
  // nada. Es exactamente el tipo de cifra con la que alguien decide gastar más.
  const g = armarMetricas({
    plataforma: { ...plataforma, gasto: { valor: 120, moneda: "USD" } },
    propios,
  });
  const roas = buscar(g, "roas");

  assert.equal(roas.valor, null);
  assert.equal(roas.certeza, "no_disponible");
  assert.match(roas.motivo, /USD/);
  assert.match(roas.motivo, /CLP/);
});

test("con la misma moneda el retorno se calcula, pero marcado como parcial", () => {
  const g = armarMetricas({ plataforma, propios });
  const roas = buscar(g, "roas");

  assert.ok(Math.abs(roas.valor - 890000 / 120000) < 0.001);
  assert.equal(roas.certeza, "parcial", "solo ve lo cobrado por enlace de pago");
});

test("una división por cero no produce infinito", () => {
  const g = armarMetricas({
    plataforma,
    propios: { ...propios, conversaciones: 0, ventas: 0 },
  });
  assert.equal(buscar(g, "costo_conversacion").monto, null);
  assert.equal(buscar(g, "conversion").valor, null);
});

test("los cuatro grupos van del dato conocido al que solo tenemos nosotros", () => {
  const g = armarMetricas({ plataforma: null, propios });
  assert.deepEqual(
    g.map((x) => x.clave),
    ["publicidad", "captacion", "calidad", "negocio"],
  );
  // Sin Meta, el primer grupo queda entero sin datos y el segundo no.
  assert.equal(disponibles(g[0]), 0);
  assert.ok(disponibles(g[1]) > 0);
});

test("⭐ el porcentaje de variación no aparece sobre números chicos", () => {
  assert.equal(variacion(3, 2).texto, "antes 2");
  assert.equal(variacion(14, 11).texto, "+27%");
  assert.equal(variacion(8, 20).texto, "-60%");
  assert.equal(variacion(5, 0), null, "sin base no hay porcentaje");
  assert.equal(variacion(null, 10), null);
});

/* ── Hallazgos automáticos ──────────────────────────────────────────────── */

const conAnuncio = (chat, anuncioId) => ({ chatId: chat, campana: { anuncioId } });

function armar(contactos, resultados = [], pagos = []) {
  const filas = agruparPorAnuncio({ contactos, resultados, pagos });
  return { filas, resumen: resumenPauta(filas) };
}

test("⭐⭐ con poca evidencia NO se afirma nada", () => {
  // Tres conversaciones y cero ventas es un martes, no un hallazgo.
  const { filas, resumen } = armar([
    conAnuncio("a", "1"),
    conAnuncio("b", "1"),
    conAnuncio("c", "1"),
  ]);
  const h = hallazgos({
    filas,
    resumen,
    propios: { conversaciones: 3, cotizaciones: 0, agendadas: 0, ventas: 0, cobrado: { valor: 0, moneda: "CLP" } },
    propiosAntes: null,
    periodo: "los últimos 7 días",
  });
  assert.equal(h.length, 0);
});

test("un anuncio con volumen y cero ventas SÍ se marca, con sus cifras", () => {
  const contactos = Array.from({ length: 10 }, (_, i) => conAnuncio(`c${i}`, "1"));
  const { filas, resumen } = armar(contactos);
  const h = hallazgos({
    filas,
    resumen,
    propios: { conversaciones: 10, cotizaciones: 0, agendadas: 0, ventas: 0, cobrado: { valor: 0, moneda: "CLP" } },
    propiosAntes: null,
    periodo: "los últimos 7 días",
  });

  assert.ok(h.length >= 1);
  assert.match(h[0].titulo, /no cierra/);
  assert.match(h[0].evidencia, /10 conversaciones/);
  assert.equal(h[0].tono, "alerta");
});

test("la caída de conversaciones necesita base suficiente para afirmarse", () => {
  const { filas, resumen } = armar([conAnuncio("a", "1")]);
  const base = { filas, resumen, periodo: "los últimos 7 días" };
  const propios = { conversaciones: 4, cotizaciones: 0, agendadas: 0, ventas: 0, cobrado: { valor: 0, moneda: "CLP" } };

  // Con 5 antes no se dice nada: la muestra no alcanza.
  const pocos = hallazgos({ ...base, propios, propiosAntes: { ...propios, conversaciones: 5 } });
  assert.ok(!pocos.some((x) => x.clave === "variacion_conversaciones"));

  // Con 20 antes y 4 ahora, sí.
  const muchos = hallazgos({ ...base, propios, propiosAntes: { ...propios, conversaciones: 20 } });
  const v = muchos.find((x) => x.clave === "variacion_conversaciones");
  assert.ok(v);
  assert.match(v.titulo, /80% menos/);
});

test("los hallazgos se ordenan por lo que cuesta plata y no desbordan", () => {
  const contactos = Array.from({ length: 12 }, (_, i) => conAnuncio(`c${i}`, "1"));
  const { filas, resumen } = armar(contactos);
  const h = hallazgos({
    filas,
    resumen,
    propios: { conversaciones: 12, cotizaciones: 0, agendadas: 6, ventas: 0, cobrado: { valor: 0, moneda: "CLP" } },
    propiosAntes: { conversaciones: 40, cotizaciones: 0, agendadas: 0, ventas: 0, cobrado: { valor: 0, moneda: "CLP" } },
    periodo: "los últimos 7 días",
  });

  assert.ok(h.length <= 4);
  assert.equal(h[0].tono, "alerta");
});
