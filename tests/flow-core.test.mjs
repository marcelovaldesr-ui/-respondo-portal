import test from "node:test";
import assert from "node:assert/strict";
import {
  firmarParametrosFlow,
  verificarFirmaFlow,
  mapearEstadoFlow,
  generarCommerceOrder,
  validarParametrosCrearPago,
  FLOW_MONTO_MIN,
  FLOW_MONTO_MAX,
} from "../lib/flow/flowCore.ts";

test("FlowCore - Firma HMAC-SHA256 oficial", async (t) => {
  await t.test("ordena parámetros alfabéticamente y calcula hash correcto", () => {
    const params = {
      apiKey: "test-api-key-123",
      commerceOrder: "ORD-001",
      subject: "Pago de prueba",
      currency: "CLP",
      amount: 15000,
      email: "cliente@ejemplo.cl",
      urlConfirmation: "https://ejemplo.cl/api/flow/confirmacion",
      urlReturn: "https://ejemplo.cl/api/flow/retorno",
    };
    const secret = "secreto-super-seguro-flow";

    const firma1 = firmarParametrosFlow(params, secret);
    assert.match(firma1, /^[0-9a-f]{64}$/, "La firma debe ser un hex de 64 caracteres");

    // Reordenar claves en el objeto de entrada debe dar EXACTAMENTE la misma firma
    const paramsDesordenados = {
      urlReturn: "https://ejemplo.cl/api/flow/retorno",
      amount: 15000,
      apiKey: "test-api-key-123",
      email: "cliente@ejemplo.cl",
      subject: "Pago de prueba",
      currency: "CLP",
      urlConfirmation: "https://ejemplo.cl/api/flow/confirmacion",
      commerceOrder: "ORD-001",
    };
    const firma2 = firmarParametrosFlow(paramsDesordenados, secret);
    assert.equal(firma1, firma2, "El orden inicial de las claves no debe alterar la firma");
  });

  await t.test("ignora la clave 's' existente para no auto-firmarse", () => {
    const params = {
      apiKey: "test-key",
      token: "tok_abc123",
      s: "firma-previa",
    };
    const secret = "mi-secreto";
    const f1 = firmarParametrosFlow(params, secret);
    const f2 = firmarParametrosFlow({ apiKey: "test-key", token: "tok_abc123" }, secret);
    assert.equal(f1, f2);
  });

  await t.test("falla si no se provee secretKey", () => {
    assert.throws(() => firmarParametrosFlow({ a: 1 }, ""), /secretKey/);
  });

  await t.test("verificarFirmaFlow valida con timingSafe y detecta alteraciones", () => {
    const params = { apiKey: "key1", token: "token_xyz" };
    const secret = "sec123";
    const firmaValida = firmarParametrosFlow(params, secret);

    assert.equal(verificarFirmaFlow(params, secret, firmaValida), true);
    assert.equal(verificarFirmaFlow(params, secret, "firma_falsa_alterada"), false);
    assert.equal(verificarFirmaFlow({ ...params, token: "token_hacked" }, secret, firmaValida), false);
  });
});

test("FlowCore - Mapeo de estados de Flow", async (t) => {
  await t.test("mapea códigos oficiales (1, 2, 3, 4) fielmente", () => {
    assert.equal(mapearEstadoFlow(1), "pendiente");
    assert.equal(mapearEstadoFlow(2), "pagado");
    assert.equal(mapearEstadoFlow(3), "rechazado");
    assert.equal(mapearEstadoFlow(4), "anulado");
    assert.equal(mapearEstadoFlow(99), "pendiente"); // default seguro
  });
});

test("FlowCore - Generación de commerceOrder", async (t) => {
  await t.test("genera formato alfanumérico limpio de longitud <= 45 caracteres", () => {
    const ref = "P-9B2K7F";
    const order = generarCommerceOrder(ref);
    assert.ok(order.startsWith("P-9B2K7F-"), "debe contener la referencia base");
    assert.ok(order.length <= 45, "Flow restringe commerceOrder a máx 45 caracteres");
    assert.match(order, /^[A-Za-z0-9_-]+$/);
  });
});

test("FlowCore - Validación de montos y parámetros", async (t) => {
  const urlsValidas = {
    urlConfirmation: "https://api.respon-do.com/api/flow/confirmacion",
    urlReturn: "https://api.respon-do.com/api/flow/retorno",
  };

  await t.test("rechaza montos menores a $350 CLP (mínimo de Flow en Webpay)", () => {
    const r = validarParametrosCrearPago({
      monto: 349,
      concepto: "Prueba",
      ...urlsValidas,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /mínimo/);
  });

  await t.test("acepta monto mínimo $350 CLP", () => {
    const r = validarParametrosCrearPago({
      monto: FLOW_MONTO_MIN,
      concepto: "Prueba mínima",
      ...urlsValidas,
    });
    assert.equal(r.ok, true);
    assert.equal(r.monto, 350);
  });

  await t.test("rechaza montos que superen el máximo de $10.000.000", () => {
    const r = validarParametrosCrearPago({
      monto: FLOW_MONTO_MAX + 1,
      concepto: "Excesivo",
      ...urlsValidas,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /máximo/);
  });

  await t.test("rechaza concepto vacío", () => {
    const r = validarParametrosCrearPago({
      monto: 5000,
      concepto: "   ",
      ...urlsValidas,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /concepto/);
  });

  await t.test("asigna email por defecto si no se proporciona", () => {
    const r = validarParametrosCrearPago({
      monto: 10000,
      concepto: "Cita médica",
      ...urlsValidas,
    });
    assert.equal(r.ok, true);
    assert.ok(r.email.includes("@"));
  });

  await t.test("rechaza URLs no válidas", () => {
    const r = validarParametrosCrearPago({
      monto: 5000,
      concepto: "Clase Pilates",
      urlConfirmation: "no-es-url",
      urlReturn: "tampoco",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /URLs/);
  });
});
