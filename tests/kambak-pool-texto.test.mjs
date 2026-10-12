/**
 * TESTS FASE 5: Variación de texto para WAHA pool (anti-patrón de envío masivo).
 * (lib/plantillasKambakPool.ts y lib/kambakEnvios.ts)
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANTILLAS_KAMBAK,
  textoDe,
} from "../lib/plantillasKambak.ts";
import {
  textoWaha,
  variantesWaha,
  LINEA_BAJA,
  VARIANTES_PLANTILLAS_WAHA,
} from "../lib/plantillasKambakPool.ts";

test("Fase 5: todas las plantillas de marketing tienen al menos 2–3 variantes para WAHA", () => {
  const marketingTemplates = Object.values(PLANTILLAS_KAMBAK).filter(
    (p) => p.categoria === "marketing",
  );

  assert.ok(marketingTemplates.length >= 4);

  for (const p of marketingTemplates) {
    const moldes = VARIANTES_PLANTILLAS_WAHA[p.nombre];
    assert.ok(
      moldes && moldes.length >= 2,
      `Plantilla ${p.nombre} debe tener al menos 2 variantes configuradas`,
    );
  }
});

test("Fase 5: ninguna variante de marketing omite la línea de baja ni pierde variables", () => {
  const marketingTemplates = Object.values(PLANTILLAS_KAMBAK).filter(
    (p) => p.categoria === "marketing",
  );

  for (const p of marketingTemplates) {
    // Usar ejemplos oficiales definidos en la plantilla
    const params = p.ejemplos;
    const variantes = variantesWaha(p, params);

    assert.ok(
      variantes.length >= 2,
      `Plantilla ${p.nombre} debe devolver al menos 2 variantes`,
    );

    for (let i = 0; i < variantes.length; i++) {
      const v = variantes[i];

      // 1. Debe contener la línea de BAJA obligatoria
      assert.ok(
        v.includes(LINEA_BAJA),
        `Variante ${i} de ${p.nombre} no contiene la línea de baja: "${LINEA_BAJA}"`,
      );

      // 2. Debe contener cada uno de los parámetros provistos
      for (let j = 0; j < params.length; j++) {
        assert.ok(
          v.includes(params[j]),
          `Variante ${i} de ${p.nombre} no contiene el parámetro ${j + 1} (${p.variables[j]}: "${params[j]}")`,
        );
      }

      // 3. No debe tener placeholders sin reemplazar
      assert.ok(
        !/\{\{\d+\}\}/.test(v),
        `Variante ${i} de ${p.nombre} contiene placeholders {{...}} sin reemplazar: "${v}"`,
      );
    }
  }
});

test("Fase 5: la semilla por teléfono es determinista y estable", () => {
  const p = PLANTILLAS_KAMBAK.sello_promo;
  const params = p.ejemplos;
  const tel1 = "56912345678";
  const tel2 = "56987654321";

  // Repetidas llamadas con el mismo teléfono dan el mismo resultado exacto
  const r1a = textoWaha(p, params, tel1);
  const r1b = textoWaha(p, params, tel1);
  assert.equal(r1a, r1b);

  const r2a = textoWaha(p, params, tel2);
  const r2b = textoWaha(p, params, tel2);
  assert.equal(r2a, r2b);
});

test("Fase 5: una lista de números distribuye las diferentes variantes", () => {
  const p = PLANTILLAS_KAMBAK.sello_promo;
  const params = p.ejemplos;
  const telefonos = [
    "56911111111",
    "56922222222",
    "56933333333",
    "56944444444",
    "56955555555",
    "56966666666",
    "56977777777",
    "56988888888",
    "56999999999",
    "56912345678",
  ];

  const textosObtenidos = new Set();
  for (const tel of telefonos) {
    const txt = textoWaha(p, params, tel);
    textosObtenidos.add(txt);
  }

  // Se generaron múltiples variantes entre la lista de teléfonos
  assert.ok(
    textosObtenidos.size >= 2,
    `Esperaba que se distribuyeran al menos 2 variantes entre 10 números, pero solo se obtuvo ${textosObtenidos.size}`,
  );
});

test("Fase 5: textoDe para Meta sigue intacto y sin variaciones", () => {
  const p = PLANTILLAS_KAMBAK.sello_promo;
  const params = p.ejemplos;

  const textoMeta = textoDe(p, params);
  assert.equal(
    textoMeta,
    "Hola Camila, en Café Aroma tenemos una promo para ti: 2x1 en cafés.\n\n" +
      "Pide uno y llévate otro gratis, de lunes a jueves.\n\n" +
      "Válida hasta el 31 de octubre.\n\n" +
      LINEA_BAJA,
  );
});
