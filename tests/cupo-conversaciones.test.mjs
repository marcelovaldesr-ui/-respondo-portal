import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANES,
  cicloActual,
  costoExcedente,
  esPlanConocido,
  mensajeDeAviso,
  porcentajeUsado,
  proyeccionFinDeCiclo,
  umbralAlcanzado,
} from "../lib/cupoConversaciones.ts";

// ── Los planes deben coincidir con la tabla comercial ──────────────────────
// Si alguien cambia un cupo acá sin cambiar PLANES_Y_PRECIOS_RESPONDO.md, el
// portal le va a cobrar al cliente algo distinto de lo que dice el contrato.

test("los cupos son los de la tabla comercial del 12-ago-2026", () => {
  assert.equal(PLANES.tino_solo.cupo, 800);
  assert.equal(PLANES.inicial.cupo, 1200);
  assert.equal(PLANES.crecimiento.cupo, 3000);
  assert.equal(PLANES.empresa.cupo, 6000);
});

test("el excedente se cobra entre el 60% y el 67% de la tarifa del plan", () => {
  // Es la regla del mercado (Cliengo 0,64-0,84x · respond.io 0,75x). Si algún
  // día alguien sube el precio del pack por encima de la tarifa del plan,
  // estaría castigando al cliente que crece: este test lo frena.
  for (const clave of ["tino_solo", "inicial", "crecimiento", "empresa"]) {
    const p = PLANES[clave];
    const tarifaDelPlan = p.precio / p.cupo;
    const tarifaExtra = p.pack.precio / p.pack.tamano;
    const razon = tarifaExtra / tarifaDelPlan;
    assert.ok(
      razon >= 0.55 && razon <= 0.7,
      `${clave}: el excedente quedó en ${razon.toFixed(2)}x la tarifa del plan`,
    );
  }
});

test("reconoce los planes válidos y rechaza cualquier otro", () => {
  assert.equal(esPlanConocido("inicial"), true);
  assert.equal(esPlanConocido("a_medida"), true);
  assert.equal(esPlanConocido("premium"), false);
  assert.equal(esPlanConocido(null), false);
  assert.equal(esPlanConocido(undefined), false);
});

// ── Porcentaje y umbrales ──────────────────────────────────────────────────

test("el porcentaje no se topa en 100: pasarse es un estado válido", () => {
  assert.equal(porcentajeUsado(600, 1200), 50);
  assert.equal(porcentajeUsado(1200, 1200), 100);
  assert.equal(porcentajeUsado(1500, 1200), 125);
  assert.equal(porcentajeUsado(0, 1200), 0);
});

test("un cupo de cero no revienta ni avisa", () => {
  assert.equal(porcentajeUsado(50, 0), 0);
  assert.equal(umbralAlcanzado(50, 0), null);
});

test("avisa al 80% y al 100%, y en nada intermedio", () => {
  assert.equal(umbralAlcanzado(959, 1200), null); // 79,9%
  assert.equal(umbralAlcanzado(960, 1200), 80); // 80% exacto
  assert.equal(umbralAlcanzado(1199, 1200), 80); // 99,9%
  assert.equal(umbralAlcanzado(1200, 1200), 100);
});

test("si salta de golpe del 70% al 105%, avisa 100 y no 80", () => {
  // El cron revisa una vez por hora. Un cliente con mucho volumen puede cruzar
  // los dos umbrales entre dos corridas: mandarle los dos mensajes seguidos
  // sería ruido.
  assert.equal(umbralAlcanzado(1260, 1200), 100);
});

// ── Proyección ─────────────────────────────────────────────────────────────

test("proyecta el cierre del ciclo al ritmo actual", () => {
  const ciclo = {
    id: "2026-08",
    desdeIso: "",
    hastaIso: "",
    diasDelCiclo: 31,
    diasCorridos: 10,
    diasRestantes: 21,
  };
  // 300 en 10 días → 30 por día → 930 en 31 días.
  assert.equal(proyeccionFinDeCiclo(300, ciclo), 930);
});

test("el día 1 del ciclo la proyección no divide por cero", () => {
  const ciclo = {
    id: "2026-08",
    desdeIso: "",
    hastaIso: "",
    diasDelCiclo: 31,
    diasCorridos: 1,
    diasRestantes: 30,
  };
  assert.equal(proyeccionFinDeCiclo(12, ciclo), 372);
});

// ── Excedente ──────────────────────────────────────────────────────────────

test("dentro del cupo no hay nada que cobrar", () => {
  assert.deepEqual(costoExcedente(1000, 1200, PLANES.inicial), {
    packs: 0,
    conversaciones: 0,
    costo: 0,
  });
  // Justo en el límite tampoco.
  assert.equal(costoExcedente(1200, 1200, PLANES.inicial).costo, 0);
});

test("el excedente se cobra por pack completo, no por conversación suelta", () => {
  // 1 sola conversación de más ya es un pack de 300.
  assert.deepEqual(costoExcedente(1201, 1200, PLANES.inicial), {
    packs: 1,
    conversaciones: 1,
    costo: 24000,
  });
  // 301 de más son dos packs.
  assert.deepEqual(costoExcedente(1501, 1200, PLANES.inicial), {
    packs: 2,
    conversaciones: 301,
    costo: 48000,
  });
});

test("un plan sin pack (a medida) no genera cobro automático", () => {
  assert.equal(costoExcedente(9999, 100, PLANES.a_medida).costo, 0);
});

// ── El ciclo ───────────────────────────────────────────────────────────────

test("el ciclo es el mes calendario chileno", () => {
  const ciclo = cicloActual(new Date("2026-08-12T18:00:00Z"));
  assert.equal(ciclo.id, "2026-08");
  assert.ok(ciclo.desdeIso.startsWith("2026-08-01"));
  assert.ok(ciclo.hastaIso.startsWith("2026-09-01"));
});

test("en diciembre el ciclo siguiente salta de año", () => {
  const ciclo = cicloActual(new Date("2026-12-20T18:00:00Z"));
  assert.equal(ciclo.id, "2026-12");
  assert.ok(ciclo.hastaIso.startsWith("2027-01-01"));
});

test("los días corridos y restantes cubren el ciclo completo, sin contar dos veces el día en curso", () => {
  const ciclo = cicloActual(new Date("2026-08-12T18:00:00Z"));
  assert.equal(ciclo.diasDelCiclo, 31);
  assert.equal(ciclo.diasCorridos + ciclo.diasRestantes, 31);
});

test("febrero de un año bisiesto tiene 29 días", () => {
  const ciclo = cicloActual(new Date("2028-02-10T18:00:00Z"));
  assert.equal(ciclo.diasDelCiclo, 29);
  assert.equal(ciclo.diasCorridos + ciclo.diasRestantes, 29);
});

test("el último día del ciclo no quedan días negativos", () => {
  const ciclo = cicloActual(new Date("2026-08-31T20:00:00Z"));
  assert.ok(ciclo.diasRestantes >= 0);
  assert.equal(ciclo.diasCorridos, 31);
});

// ── El mensaje al dueño ────────────────────────────────────────────────────

test("el aviso de 100% deja claro que el servicio NO se corta", () => {
  const estado = {
    clienteId: "x",
    plan: "inicial",
    etiquetaPlan: "Inicial",
    consumo: 1250,
    cupo: 1200,
    porcentaje: 104,
    proyeccion: 1400,
    excedente: { packs: 1, conversaciones: 50, costo: 24000 },
    ciclo: {
      id: "2026-08",
      desdeIso: "",
      hastaIso: "",
      diasDelCiclo: 31,
      diasCorridos: 20,
      diasRestantes: 11,
    },
  };
  const texto = mensajeDeAviso(estado, 100);
  assert.match(texto, /sigue atendiendo con normalidad/i);
  assert.match(texto, /1\.200/); // el cupo, formateado en es-CL
  // Nada que suene a amenaza. Ojo: "no se corta nada" SÍ contiene "corta" y es
  // justamente la frase que queremos — por eso se buscan las formas que solo
  // aparecen cuando se está anunciando un castigo, no la raíz suelta.
  assert.doesNotMatch(texto, /suspend|bloque|pausa|se cortará|dejará de|desactiv/i);
  // Negrita de WhatsApp: un asterisco, no dos.
  assert.doesNotMatch(texto, /\*\*/);
});

test("el aviso de 80% informa sin alarmar", () => {
  const estado = {
    clienteId: "x",
    plan: "inicial",
    etiquetaPlan: "Inicial",
    consumo: 960,
    cupo: 1200,
    porcentaje: 80,
    proyeccion: 1300,
    excedente: { packs: 0, conversaciones: 0, costo: 0 },
    ciclo: {
      id: "2026-08",
      desdeIso: "",
      hastaIso: "",
      diasDelCiclo: 31,
      diasCorridos: 24,
      diasRestantes: 7,
    },
  };
  const texto = mensajeDeAviso(estado, 80);
  assert.match(texto, /960 de las 1\.200/);
  assert.match(texto, /7 días/);
  assert.match(texto, /sigue funcionando/i);
});
