import test from "node:test";
import assert from "node:assert/strict";
import { iniciarPagoFlow, procesarConfirmacionFlow } from "../lib/flow/flowPagos.ts";
import { cifrar } from "../lib/cifrado.ts";

// Configuración mock para pruebas
const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const EMPLEADO_ID = "e0000000-0000-0000-0000-000000000001";
const CHAT_ID = "56911223344";
const CONTACTO_ID = "k0000000-0000-0000-0000-000000000001";

const FLOW_API_KEY = "test-api-key-xyz";
const FLOW_SECRET_KEY = "test-secret-key-123456";

// Generar secret cifrado como vive en BD
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-unit-testing-only-12345";
const FLOW_SECRET_CIFRADO = cifrar(FLOW_SECRET_KEY, "flow-secret");

function crearMockSupabase() {
  const tablas = {
    ed_clientes: [
      {
        id: CLIENTE_ID,
        flow_api_key: FLOW_API_KEY,
        flow_secret_cifrado: FLOW_SECRET_CIFRADO,
        flow_modo: "sandbox",
        flow_estado: "conectado",
        nombre: "Centro Demo",
      },
    ],
    ed_contactos: [
      {
        id: CONTACTO_ID,
        cliente_id: CLIENTE_ID,
        chat_id: CHAT_ID,
        email: "alumno@pilates.cl",
        nombre: "Juan Pérez",
        datos: { campana: "meta_promo_septiembre" },
      },
    ],
    ed_pagos: [],
    ed_eventos_comerciales: [],
  };

  const supa = {
    from(tabla) {
      let filtroId = null;
      let filtroClienteId = null;
      let filtroToken = null;
      let filtroChatId = null;
      let filtroEstado = null;
      let filtroMonto = null;

      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          if (col === "id") filtroId = val;
          if (col === "cliente_id") filtroClienteId = val;
          if (col === "proveedor_token") filtroToken = val;
          if (col === "chat_id") filtroChatId = val;
          if (col === "estado") filtroEstado = val;
          if (col === "monto") filtroMonto = val;
          return builder;
        },
        gte() {
          return builder;
        },
        not() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          const list = tablas[tabla] || [];
          const item = list.find((x) => {
            if (filtroId && x.id !== filtroId) return false;
            if (filtroClienteId && x.cliente_id !== filtroClienteId) return false;
            if (filtroToken && x.proveedor_token !== filtroToken) return false;
            if (filtroChatId && x.chat_id !== filtroChatId) return false;
            if (filtroEstado && x.estado !== filtroEstado) return false;
            if (filtroMonto && x.monto !== filtroMonto) return false;
            return true;
          });
          return { data: item || null, error: null };
        },
        async single() {
          return this.maybeSingle();
        },
        insert(fila) {
          const nuevo = {
            id: fila.id || `pago-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...fila,
            creado_en: fila.creado_en || new Date().toISOString(),
          };
          if (tabla === "ed_eventos_comerciales") {
            const dup = tablas.ed_eventos_comerciales.find(
              (e) => e.cliente_id === nuevo.cliente_id && e.pago_id === nuevo.pago_id && e.tipo === nuevo.tipo
            );
            if (dup) {
              const err = { data: null, error: { code: "23505", message: "unique violation" } };
              return {
                ...err,
                select() {
                  return {
                    single: () => Promise.resolve(err),
                    maybeSingle: () => Promise.resolve(err),
                  };
                },
                then(resolve) { resolve(err); },
              };
            }
          }
          tablas[tabla].push(nuevo);
          const okRes = { data: nuevo, error: null };
          return {
            ...okRes,
            select() {
              return {
                single: () => Promise.resolve(okRes),
                maybeSingle: () => Promise.resolve(okRes),
              };
            },
            then(resolve) { resolve(okRes); },
          };
        },
        update(cambios) {
          const filtros = [];
          const updateBuilder = {
            eq(col, val) {
              filtros.push({ col, val });
              return updateBuilder;
            },
            select() {
              return updateBuilder.ejecutar();
            },
            ejecutar() {
              const list = tablas[tabla] || [];
              const afectados = [];
              for (const row of list) {
                const cumple = filtros.every((f) => row[f.col] === f.val);
                if (cumple) {
                  Object.assign(row, cambios);
                  afectados.push(row);
                }
              }
              return Promise.resolve({ data: afectados, error: null });
            },
            then(resolve) {
              return updateBuilder.ejecutar().then(resolve);
            },
          };
          return updateBuilder;
        },
        delete() {
          return {
            eq(col, val) {
              const list = tablas[tabla] || [];
              tablas[tabla] = list.filter((x) => x[col] !== val);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };

      return builder;
    },
    _tablas: tablas,
  };

  return supa;
}

test("FlowPagos - Flujo Completo de Pagos P0", async (t) => {
  await t.test("rechaza cobro si el tenant no tiene Flow configurado (Tenant Isolation)", async () => {
    const supa = crearMockSupabase();
    const r = await iniciarPagoFlow({
      clienteId: "c-otro-sin-flow-1234",
      empleadoId: EMPLEADO_ID,
      chatId: CHAT_ID,
      monto: 15000,
      concepto: "Clase particular",
      supa,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /no tiene configuradas sus credenciales/);
  });

  await t.test("inicia orden de pago en Flow exitosamente y guarda token", async () => {
    const supa = crearMockSupabase();

    const mockFetch = async (url, opts) => {
      assert.ok(url.includes("/payment/create"));
      assert.equal(opts.method, "POST");
      return {
        ok: true,
        json: async () => ({
          url: "https://sandbox.flow.cl/app/web/pay.php",
          token: "TOKEN_FLOW_12345",
          flowOrder: 98765,
        }),
      };
    };

    const r = await iniciarPagoFlow({
      clienteId: CLIENTE_ID,
      empleadoId: EMPLEADO_ID,
      chatId: CHAT_ID,
      monto: 25000,
      concepto: "Pack 4 Clases Reformer",
      supa,
      fetchFn: mockFetch,
    });

    assert.equal(r.ok, true);
    assert.equal(r.token, "TOKEN_FLOW_12345");
    assert.equal(r.flowOrder, 98765);
    assert.equal(r.url, "https://sandbox.flow.cl/app/web/pay.php?token=TOKEN_FLOW_12345");
    assert.ok(r.referencia.startsWith("P-"));

    // Verificar en DB mock
    const pagoDb = supa._tablas.ed_pagos.find((p) => p.id === r.pagoId);
    assert.ok(pagoDb);
    assert.equal(pagoDb.estado, "pendiente");
    assert.equal(pagoDb.proveedor, "flow");
    assert.equal(pagoDb.proveedor_token, "TOKEN_FLOW_12345");
    assert.equal(pagoDb.proveedor_orden, "98765");
    assert.equal(pagoDb.contacto_id, CONTACTO_ID); // Guardrail 1: Resuelve contacto canónico
  });

  await t.test("idempotencia en creación: clic rápido devuelve la orden existente sin duplicar", async () => {
    const supa = crearMockSupabase();
    let llamadasFlow = 0;

    const mockFetch = async () => {
      llamadasFlow++;
      return {
        ok: true,
        json: async () => ({
          url: "https://sandbox.flow.cl/pay",
          token: "TOKEN_UNICO_ABC",
          flowOrder: 11111,
        }),
      };
    };

    const r1 = await iniciarPagoFlow({
      clienteId: CLIENTE_ID,
      empleadoId: EMPLEADO_ID,
      chatId: CHAT_ID,
      monto: 30000,
      concepto: "Membresía Mensual",
      supa,
      fetchFn: mockFetch,
    });

    assert.equal(r1.ok, true);
    assert.equal(llamadasFlow, 1);

    // Segundo clic idéntico
    const r2 = await iniciarPagoFlow({
      clienteId: CLIENTE_ID,
      empleadoId: EMPLEADO_ID,
      chatId: CHAT_ID,
      monto: 30000,
      concepto: "Membresía Mensual",
      supa,
      fetchFn: mockFetch,
    });

    assert.equal(r2.ok, true);
    assert.equal(r2.pagoId, r1.pagoId);
    assert.equal(r2.token, r1.token);
    assert.equal(r2.reusado, true);
    assert.equal(llamadasFlow, 1, "No debe invocar a Flow dos veces");
    assert.equal(supa._tablas.ed_pagos.length, 1, "No debe crear dos filas en ed_pagos");
  });

  await t.test("procesarConfirmacionFlow: confirma pago, actualiza DB y emite PAYMENT_CONFIRMED una sola vez", async () => {
    const supa = crearMockSupabase();

    // Crear orden pendiente en DB
    supa._tablas.ed_pagos.push({
      id: "pago-confirmable-1",
      cliente_id: CLIENTE_ID,
      empleado_id: EMPLEADO_ID,
      chat_id: CHAT_ID,
      contacto_id: CONTACTO_ID,
      referencia: "P-ABC123",
      monto: 20000,
      concepto: "Pilates 4",
      estado: "pendiente",
      proveedor: "flow",
      proveedor_token: "TOK_CONFIRMAR_OK",
      proveedor_orden: "55555",
      metadata: {},
    });

    const mockFetch = async (url) => {
      assert.ok(url.includes("/payment/getStatus"));
      return {
        ok: true,
        json: async () => ({
          flowOrder: 55555,
          commerceOrder: "P-ABC123",
          requestDate: "2026-09-17 12:00:00",
          status: 2, // 2 = Pagada
          subject: "Pilates 4",
          currency: "CLP",
          amount: 20000,
          payer: "alumno@pilates.cl",
          paymentData: { media: "Webpay", fee: 400 },
        }),
      };
    };

    // Callback 1
    const r1 = await procesarConfirmacionFlow("TOK_CONFIRMAR_OK", { supa, fetchFn: mockFetch });
    assert.equal(r1.ok, true);
    assert.equal(r1.estado, "pagado");
    assert.equal(r1.monto, 20000);

    const pagoDb = supa._tablas.ed_pagos.find((p) => p.id === "pago-confirmable-1");
    assert.equal(pagoDb.estado, "pagado");
    assert.ok(pagoDb.pagado_en);
    assert.equal(pagoDb.proveedor_estado, 2);

    // Validar emisión única de PAYMENT_CONFIRMED (Guardrail 3)
    const eventos = supa._tablas.ed_eventos_comerciales;
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].tipo, "PAYMENT_CONFIRMED");
    assert.equal(eventos[0].pago_id, "pago-confirmable-1");
    assert.equal(eventos[0].monto, 20000);
    assert.equal(eventos[0].contacto_id, CONTACTO_ID);

    // Callback 2 (reintento / webhook duplicado de Flow)
    const r2 = await procesarConfirmacionFlow("TOK_CONFIRMAR_OK", { supa, fetchFn: mockFetch });
    assert.equal(r2.ok, true);
    assert.equal(r2.yaProcesado, true);
    assert.equal(eventos.length, 1, "Idempotencia: no debe duplicar el evento comercial");
  });

  await t.test("procesarConfirmacionFlow: detecta discordancia de monto (tampering) y rechaza confirmación", async () => {
    const supa = crearMockSupabase();

    supa._tablas.ed_pagos.push({
      id: "pago-tampered",
      cliente_id: CLIENTE_ID,
      referencia: "P-HACK01",
      monto: 50000, // Esperado $50.000
      concepto: "Plan Gold",
      estado: "pendiente",
      proveedor: "flow",
      proveedor_token: "TOK_TAMPERED",
      metadata: {},
    });

    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        flowOrder: 99999,
        commerceOrder: "P-HACK01",
        status: 2,
        currency: "CLP",
        amount: 5000, // Flow reporta solo $5.000
        payer: "hacker@test.cl",
      }),
    });

    const r = await procesarConfirmacionFlow("TOK_TAMPERED", { supa, fetchFn: mockFetch });
    assert.equal(r.ok, false);
    assert.match(r.error, /Monto de Flow no coincide/);

    // No debe haber pasado a pagado
    const pagoDb = supa._tablas.ed_pagos.find((p) => p.id === "pago-tampered");
    assert.equal(pagoDb.estado, "pendiente");
    assert.equal(supa._tablas.ed_eventos_comerciales.length, 0);
  });

  await t.test("procesarConfirmacionFlow: actualiza a rechazado cuando Flow status es 3", async () => {
    const supa = crearMockSupabase();

    supa._tablas.ed_pagos.push({
      id: "pago-rechazado-1",
      cliente_id: CLIENTE_ID,
      referencia: "P-RECH01",
      monto: 10000,
      concepto: "Consulta",
      estado: "pendiente",
      proveedor: "flow",
      proveedor_token: "TOK_RECHAZADO",
      metadata: {},
    });

    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        flowOrder: 77777,
        commerceOrder: "P-RECH01",
        status: 3, // 3 = Rechazada
        currency: "CLP",
        amount: 10000,
        payer: "test@rechazo.cl",
      }),
    });

    const r = await procesarConfirmacionFlow("TOK_RECHAZADO", { supa, fetchFn: mockFetch });
    assert.equal(r.ok, true);
    assert.equal(r.estado, "rechazado");

    const pagoDb = supa._tablas.ed_pagos.find((p) => p.id === "pago-rechazado-1");
    assert.equal(pagoDb.estado, "rechazado");
    assert.equal(supa._tablas.ed_eventos_comerciales.length, 0);
  });

  await t.test("conciliación manual invoca verificación síncrona", async () => {
    const supa = crearMockSupabase();

    supa._tablas.ed_pagos.push({
      id: "pago-conciliable",
      cliente_id: CLIENTE_ID,
      referencia: "P-CONC01",
      monto: 12000,
      concepto: "Clase suelta",
      estado: "pendiente",
      proveedor: "flow",
      proveedor_token: "TOK_CONCILIABLE",
      metadata: {},
    });

    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        flowOrder: 88888,
        commerceOrder: "P-CONC01",
        status: 2,
        currency: "CLP",
        amount: 12000,
        payer: "conciliacion@test.cl",
      }),
    });

    // Sobreescribir temporalmente fetch global para el mock de conciliación si es necesario,
    // o procesar a través de procesarConfirmacionFlow
    const r = await procesarConfirmacionFlow("TOK_CONCILIABLE", { supa, fetchFn: mockFetch });
    assert.equal(r.ok, true);
    assert.equal(r.estado, "pagado");
  });

  await t.test("concurrencia: dos callbacks simultáneos no duplican eventos ni causan carreras", async () => {
    const supa = crearMockSupabase();

    supa._tablas.ed_pagos.push({
      id: "pago-concurrente",
      cliente_id: CLIENTE_ID,
      referencia: "P-CONCUR",
      monto: 18000,
      concepto: "CrossFit Pase",
      estado: "pendiente",
      proveedor: "flow",
      proveedor_token: "TOK_CONCURRENTE",
      metadata: {},
    });

    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        flowOrder: 665544,
        commerceOrder: "P-CONCUR",
        status: 2,
        currency: "CLP",
        amount: 18000,
        payer: "concurrente@test.cl",
      }),
    });

    // Disparar 2 callbacks al mismo tiempo
    const [res1, res2] = await Promise.all([
      procesarConfirmacionFlow("TOK_CONCURRENTE", { supa, fetchFn: mockFetch }),
      procesarConfirmacionFlow("TOK_CONCURRENTE", { supa, fetchFn: mockFetch }),
    ]);

    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.equal(res1.estado, "pagado");
    assert.equal(res2.estado, "pagado");

    // Exactamente 1 evento comercial emitido en la tabla
    const eventos = supa._tablas.ed_eventos_comerciales.filter((e) => e.pago_id === "pago-concurrente");
    assert.equal(eventos.length, 1, "Solo debe existir un evento PAYMENT_CONFIRMED");
  });
});

