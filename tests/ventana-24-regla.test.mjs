import assert from "node:assert/strict";
import test from "node:test";

import { HORAS_VENTANA, ventanaDesde } from "../lib/ventana24Regla.ts";

/**
 * Esta regla decide si en la bandeja aparece «tu mensaje puede no llegar».
 *
 * Equivocarla tiene dos costos distintos y los dos son reales:
 *  - de más: frena a alguien que iba a escribirle a un cliente, sin motivo;
 *  - de menos: la deja escribir algo que Meta rechaza con el error 131047 y el
 *    cliente nunca recibe.
 */

const AHORA = new Date("2026-08-25T12:00:00.000Z").getTime();
const haceHoras = (h) => new Date(AHORA - h * 36e5).toISOString();

test("en WAHA no hay ventana: nunca se avisa nada", () => {
  // Es el caso de Impresora Color, el único cliente en producción hoy.
  for (const t of ["waha", "WAHA", null, undefined, ""]) {
    assert.equal(ventanaDesde(t, haceHoras(500), AHORA), "no_aplica", `transporte ${t}`);
  }
});

test("sin transporte conocido se asume WAHA, no Cloud", () => {
  // Asumir "cloud" mostraría el aviso de las 24 h a quien no lo tiene, que es
  // justo el error que esta función vino a arreglar.
  assert.equal(ventanaDesde(undefined, haceHoras(48), AHORA), "no_aplica");
});

test("en Cloud, dentro de 24 h la ventana está ABIERTA", () => {
  for (const h of [0, 0.5, 1, 12, 23, 23.99]) {
    assert.equal(ventanaDesde("cloud", haceHoras(h), AHORA), "abierta", `hace ${h} h`);
  }
});

test("en Cloud, pasadas 24 h la ventana está CERRADA", () => {
  for (const h of [24, 24.01, 25, 72, 5000]) {
    assert.equal(ventanaDesde("cloud", haceHoras(h), AHORA), "cerrada", `hace ${h} h`);
  }
});

test("el borde exacto de 24 h cuenta como cerrada", () => {
  // Meta corta EN las 24 h. Ante la duda conviene el lado conservador: mostrar
  // "cerrada" y ofrecer plantilla nunca hace que un mensaje se pierda.
  assert.equal(ventanaDesde("cloud", haceHoras(HORAS_VENTANA), AHORA), "cerrada");
});

test("sin fecha del último entrante se dice DESCONOCIDA, no se inventa", () => {
  // La columna la agrega la migración 210; antes de eso no hay dato.
  for (const v of [null, undefined, ""]) {
    assert.equal(ventanaDesde("cloud", v, AHORA), "desconocida");
  }
});

test("una fecha corrupta no rompe la pantalla", () => {
  assert.equal(ventanaDesde("cloud", "no-es-una-fecha", AHORA), "desconocida");
});

test("una fecha en el futuro cuenta como abierta", () => {
  // Pasa por desfase de reloj entre el servidor de Meta y el nuestro. Si el
  // mensaje llegó "recién", lo correcto es dejar escribir.
  const futuro = new Date(AHORA + 5 * 60_000).toISOString();
  assert.equal(ventanaDesde("cloud", futuro, AHORA), "abierta");
});
