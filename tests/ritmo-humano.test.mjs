import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPERA_CORTA,
  ESPERA_LARGA,
  delayHumano,
  ventanaDeEspera,
} from "../lib/ritmoHumano.ts";

/**
 * Estas reglas salieron de incidentes reales en el WhatsApp de Impresora Color.
 * Si un test de acá falla, no es un detalle de estilo: es Tino volviendo a
 * preguntar lo mismo 2-4 veces, que es el bug que más caro costó encontrar.
 */

test("un saludo se responde RÁPIDO aunque sea corto y sin puntuación", () => {
  // Es la excepción importante: es el primer contacto, y ahí la velocidad es
  // justamente lo que impresiona. Nadie manda "Hola" en pedazos.
  for (const s of ["Hola", "hola", "Holaa", "Buenas", "buenos días", "Buenas tardes", "alo"]) {
    assert.equal(ventanaDeEspera(s), ESPERA_CORTA, `"${s}" debería ser corta`);
  }
});

test("una frase corta sin cierre ESPERA: probablemente sigue escribiendo", () => {
  for (const s of ["Es ese mismo", "el de 500", "quiero cotizar algo"]) {
    assert.equal(ventanaDeEspera(s), ESPERA_LARGA, `"${s}" debería ser larga`);
  }
});

test("uno o dos caracteres SIEMPRE esperan, aunque cierren con signo", () => {
  // "?" termina en puntuación, así que la regla general lo mandaría a corta.
  // Pero un mensaje de un carácter es siempre un pedazo de algo más.
  for (const s of ["?", "y", "ok", "si"]) {
    assert.equal(ventanaDeEspera(s), ESPERA_LARGA, `"${s}" debería ser larga`);
  }
});

test("una frase completa se responde rápido", () => {
  for (const s of [
    "Hola, quería saber el precio de 1000 flyers tamaño carta.",
    "¿Tienen disponibilidad para el martes?",
  ]) {
    assert.equal(ventanaDeEspera(s), ESPERA_CORTA, `"${s}" debería ser corta`);
  }
});

test("el vacío no rompe ni deja esperando", () => {
  assert.equal(ventanaDeEspera(""), ESPERA_CORTA);
  assert.equal(ventanaDeEspera("   "), ESPERA_CORTA);
});

test("el retardo humano se queda entre 1,5 y 6 segundos", () => {
  // El piso evita la respuesta instantánea que delata al bot; el techo evita
  // que se sienta como demora (y que se coma el presupuesto de la función).
  for (const texto of ["ok", "a".repeat(50), "a".repeat(5000)]) {
    for (let i = 0; i < 50; i++) {
      const d = delayHumano(texto);
      assert.ok(d >= 1500 && d <= 6000, `fuera de rango: ${d} para largo ${texto.length}`);
    }
  }
});

test("un texto largo tarda más que uno corto", () => {
  // Con jitter conviene comparar promedios, no una muestra suelta.
  const prom = (t) => {
    let s = 0;
    for (let i = 0; i < 200; i++) s += delayHumano(t);
    return s / 200;
  };
  assert.ok(prom("a".repeat(80)) > prom("ok"), "el largo debería influir");
});
