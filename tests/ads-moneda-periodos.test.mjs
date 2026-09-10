import assert from "node:assert/strict";
import test from "node:test";

import {
  decimalesDe,
  dividir,
  formatearMonto,
  formatearNumero,
  formatearPorcentaje,
  sumar,
} from "../lib/ads/moneda.ts";
import {
  bordesUTC,
  diaLegible,
  diasEntre,
  esDiaValido,
  instanteChile,
  periodoAnterior,
  rangoLegible,
  resolverRango,
  sumarDias,
} from "../lib/ads/periodos.ts";

/**
 * Monedas y fechas: las dos capas donde un informe de publicidad miente sin
 * que nadie lo note. Un peso escrito como dólar y un día corrido por el huso
 * horario dan cifras que «se ven bien» y llevan a decisiones de plata malas.
 */

/* ── Moneda ─────────────────────────────────────────────────────────────── */

test("⭐ el peso chileno no lleva decimales y usa punto de miles", () => {
  assert.equal(formatearMonto({ valor: 1000, moneda: "CLP" }), "$1.000");
  assert.equal(formatearMonto({ valor: 890000, moneda: "CLP" }), "$890.000");
  assert.equal(decimalesDe("CLP"), 0);
});

test("el dólar sí lleva decimales", () => {
  assert.equal(decimalesDe("USD"), 2);
  assert.match(formatearMonto({ valor: 1000, moneda: "USD" }, { monedaDelNegocio: "USD" }), /1\.000,00/);
});

test("⭐ una moneda distinta a la del negocio se rotula, para no confundirla", () => {
  // El error caro: leer «$50» de una cuenta en dólares como 50 pesos.
  assert.match(formatearMonto({ valor: 50, moneda: "USD" }, { monedaDelNegocio: "CLP" }), /^USD /);
  assert.equal(formatearMonto({ valor: 50, moneda: "CLP" }, { monedaDelNegocio: "CLP" }), "$50");
});

test("⭐ dos monedas distintas NO se suman: devuelve null, no un total falso", () => {
  assert.equal(sumar([{ valor: 1, moneda: "CLP" }, { valor: 1, moneda: "USD" }]), null);
  assert.deepEqual(sumar([{ valor: 10, moneda: "CLP" }, { valor: 5, moneda: "CLP" }]), {
    valor: 15,
    moneda: "CLP",
  });
});

test("dividir por cero no da infinito: da null", () => {
  assert.equal(dividir({ valor: 1000, moneda: "CLP" }, 0), null);
  assert.deepEqual(dividir({ valor: 1000, moneda: "CLP" }, 4), { valor: 250, moneda: "CLP" });
});

test("lo que no existe se escribe como raya, nunca como cero", () => {
  assert.equal(formatearMonto(null), "—");
  assert.equal(formatearNumero(null), "—");
  assert.equal(formatearPorcentaje(null), "—");
  assert.equal(formatearMonto({ valor: Number.NaN, moneda: "CLP" }), "—");
});

/* ── Períodos ───────────────────────────────────────────────────────────── */

// 10-sep-2026 23:30 en Chile (que en UTC ya es 11-sep).
const TARDE = new Date("2026-09-11T02:30:00Z");

test("⭐ «hoy» a las 23:30 de Chile sigue siendo hoy, no mañana", () => {
  // Sin fijar la zona, el servidor en UTC diría 11-sep y las cifras de la
  // noche aparecerían en el día equivocado.
  assert.equal(resolverRango("hoy", undefined, TARDE).desde, "2026-09-10");
});

test("«últimos 7 días» son 7 días completos, inclusive", () => {
  const r = resolverRango("7d", undefined, TARDE);
  assert.equal(r.desde, "2026-09-04");
  assert.equal(r.hasta, "2026-09-10");
  assert.equal(r.dias, 7);
});

test("el mes anterior va del 1 al último día, no «hace 30 días»", () => {
  const r = resolverRango("mes_anterior", undefined, TARDE);
  assert.equal(r.desde, "2026-08-01");
  assert.equal(r.hasta, "2026-08-31");
});

test("⭐ el período anterior tiene el MISMO largo y termina antes del actual", () => {
  const r = resolverRango("7d", undefined, TARDE);
  const a = periodoAnterior(r);
  assert.deepEqual(a, { desde: "2026-08-28", hasta: "2026-09-03" });
  assert.equal(diasEntre(a.desde, a.hasta), r.dias, "comparar 7 con 30 sería mentir");
});

test("el mes anterior no ofrece comparación: es otra pregunta", () => {
  assert.equal(periodoAnterior(resolverRango("mes_anterior", undefined, TARDE)), null);
});

test("⭐ el cambio de hora de Chile lo resuelve la zona, no un -3 escrito a mano", () => {
  // En 2026 Chile adelanta el reloj el primer domingo de septiembre.
  assert.equal(instanteChile("2026-06-15", "00:00:00"), "2026-06-15T04:00:00.000Z"); // UTC-4
  assert.equal(instanteChile("2026-09-30", "00:00:00"), "2026-09-30T03:00:00.000Z"); // UTC-3
});

test("los bordes del rango cubren el día entero en hora local", () => {
  const b = bordesUTC({ desde: "2026-09-04", hasta: "2026-09-10" });
  assert.ok(b.desdeISO < b.hastaISO);
  assert.match(b.desdeISO, /^2026-09-04T0[34]:00:00/);
});

test("una fecha imposible en la URL no revienta ni se corrige a escondidas", () => {
  const r = resolverRango("personalizado", { desde: "2026-13-40", hasta: "hola" }, TARDE);
  assert.equal(r.clave, "30d", "cae al default, que es lo que la persona venía a ver");
});

test("un rango personalizado válido se respeta; uno al revés no", () => {
  assert.equal(
    resolverRango("personalizado", { desde: "2026-09-01", hasta: "2026-09-05" }, TARDE).clave,
    "personalizado",
  );
  assert.equal(
    resolverRango("personalizado", { desde: "2026-09-05", hasta: "2026-09-01" }, TARDE).clave,
    "30d",
  );
});

test("un rango absurdamente largo se rechaza", () => {
  assert.equal(
    resolverRango("personalizado", { desde: "2020-01-01", hasta: "2026-09-01" }, TARDE).clave,
    "30d",
  );
});

test("esDiaValido rechaza lo que no es una fecha real", () => {
  assert.equal(esDiaValido("2026-02-30"), false);
  assert.equal(esDiaValido("2026-2-3"), false);
  assert.equal(esDiaValido("2026-02-28"), true);
});

test("sumar días cruza meses y años sin corrimientos", () => {
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
});

test("el rango se escribe legible y un solo día no se repite", () => {
  assert.equal(rangoLegible({ desde: "2026-09-10", hasta: "2026-09-10" }), diaLegible("2026-09-10"));
  assert.match(rangoLegible({ desde: "2026-09-04", hasta: "2026-09-10" }), / al /);
});
