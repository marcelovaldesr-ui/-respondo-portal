import test from "node:test";
import assert from "node:assert/strict";
import {
  crearHoldReserva,
  manejarPagoConfirmadoBooking,
  liberarHoldsExpirados,
} from "../lib/booking/bookingAnticipos.ts";

import { cifrar } from "../lib/cifrado.ts";

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-unit-tests-12345";
const FLOW_SECRET_CIFRADO = cifrar("test-secret-flow-key", "flow-secret");

const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const SERVICIO_ID = "s0000000-0000-0000-0000-000000000001";
const PROFESIONAL_ID = "p0000000-0000-0000-0000-000000000001";

function crearMockDb(datosIniciales = {}) {
  const tablas = {
    ed_clientes: [
      {
        id: CLIENTE_ID,
        commerce_booking_v1_activo: true,
        flow_api_key: "test-api",
        flow_secret_cifrado: FLOW_SECRET_CIFRADO,
        flow_modo: "sandbox",
        flow_estado: "conectado",
        ...(datosIniciales.cliente ?? {}),
      },
    ],
    ed_servicios: [
      {
        id: SERVICIO_ID,
        cliente_id: CLIENTE_ID,
        nombre: "Evaluación Médica / Pilates",
        duracion_min: 60,
        requiere_anticipo: true,
        anticipo_monto_fijo: 15000,
        activo: true,
        ...(datosIniciales.servicio ?? {}),
      },
    ],
    ed_citas: [...(datosIniciales.citas ?? [])],
    ed_pagos: [...(datosIniciales.pagos ?? [])],
    ed_eventos_comerciales: [...(datosIniciales.eventos ?? [])],
  };

  function matchFilters(row, filters) {
    for (const f of filters) {
      if (f.op === "eq" && row[f.col] !== f.val) return false;
      if (f.op === "neq" && row[f.col] === f.val) return false;
      if (f.op === "in" && !f.val.includes(row[f.col])) return false;
      if (f.op === "lt" && !(row[f.col] < f.val)) return false;
      if (f.op === "gt" && !(row[f.col] > f.val)) return false;
    }
    return true;
  }

  function crearQuery(tabla) {
    const filters = [];
    let isSingle = false;
    let isMaybeSingle = false;
    let updateData = null;
    let insertData = null;

    const builder = {
      select: () => builder,
      eq: (col, val) => { filters.push({ op: "eq", col, val }); return builder; },
      neq: (col, val) => { filters.push({ op: "neq", col, val }); return builder; },
      in: (col, val) => { filters.push({ op: "in", col, val }); return builder; },
      lt: (col, val) => { filters.push({ op: "lt", col, val }); return builder; },
      gt: (col, val) => { filters.push({ op: "gt", col, val }); return builder; },
      gte: (col, val) => { filters.push({ op: "gte", col, val }); return builder; },
      lte: (col, val) => { filters.push({ op: "lte", col, val }); return builder; },
      not: () => builder,
      limit: () => builder,
      single: () => { isSingle = true; return builder; },
      maybeSingle: () => { isMaybeSingle = true; return builder; },
      insert: (data) => {
        insertData = Array.isArray(data) ? data : [data];
        return builder;
      },
      update: (data) => {
        updateData = data;
        return builder;
      },
      then: (resolve) => {
        const t = tablas[tabla] ?? [];
        if (insertData) {
          const inserted = [];
          for (const item of insertData) {
            const row = { id: item.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...item };
            t.push(row);
            inserted.push(row);
          }
          resolve({ data: isSingle ? inserted[0] : inserted, error: null });
          return;
        }

        if (updateData) {
          const matched = t.filter((r) => matchFilters(r, filters));
          for (const m of matched) {
            Object.assign(m, updateData);
          }
          resolve({ data: matched, error: null });
          return;
        }

        const filtered = t.filter((r) => matchFilters(r, filters));
        if (isSingle) {
          resolve({ data: filtered[0] ?? null, error: filtered[0] ? null : { message: "Not found" } });
        } else if (isMaybeSingle) {
          resolve({ data: filtered[0] ?? null, error: null });
        } else {
          resolve({ data: filtered, error: null });
        }
      },
    };

    return builder;
  }

  return {
    tablas,
    from: (tabla) => crearQuery(tabla),
  };
}

test("P1 - Feature Flag: rechaza hold si commerce_booking_v1_activo es false", async () => {
  const supa = crearMockDb({
    cliente: { commerce_booking_v1_activo: false },
  });

  const res = await crearHoldReserva({
    clienteId: CLIENTE_ID,
    servicioId: SERVICIO_ID,
    profesionalId: PROFESIONAL_ID,
    inicioIso: "2026-10-01T14:00:00.000Z",
    nombreContacto: "Juan Perez",
    supa,
  });

  assert.equal(res.ok, false);
  assert.equal(res.motivo, "feature_flag_desactivado");
});

test("P1 - Configuración de servicio: rechaza si no requiere anticipo", async () => {
  const supa = crearMockDb({
    servicio: { requiere_anticipo: false, anticipo_monto_fijo: null },
  });

  const res = await crearHoldReserva({
    clienteId: CLIENTE_ID,
    servicioId: SERVICIO_ID,
    profesionalId: PROFESIONAL_ID,
    inicioIso: "2026-10-01T14:00:00.000Z",
    nombreContacto: "Juan Perez",
    supa,
  });

  assert.equal(res.ok, false);
  assert.equal(res.motivo, "no_requiere_anticipo");
});

test("P1 - Creación exitosa de hold y link de Flow", async () => {
  const supa = crearMockDb();

  // Mock de fetch para Flow API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      token: "TOKEN-MOCK-123",
      url: "https://sandbox.flow.cl/app/web/pay.php",
      flowOrder: 998877,
    }),
  });

  try {
    const res = await crearHoldReserva({
      clienteId: CLIENTE_ID,
      servicioId: SERVICIO_ID,
      profesionalId: PROFESIONAL_ID,
      inicioIso: "2026-10-01T14:00:00.000Z",
      nombreContacto: "Juan Perez",
      chatId: "56911223344",
      supa,
    });

    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.montoAnticipo, 15000);
      assert.match(res.checkoutUrl, /pay\.php/);
      assert.equal(res.flowOrder, 998877);

      // Verificar que ed_citas quedó en pendiente_pago
      const cita = supa.tablas.ed_citas.find((c) => c.id === res.citaId);
      assert.ok(cita);
      assert.equal(cita.estado, "pendiente_pago");
      assert.equal(cita.anticipo_pagado, false);
      assert.ok(cita.hold_expira_en);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P1 - Desacoplamiento Booking: PAYMENT_CONFIRMED confirma reserva exitosamente", async () => {
  const CITA_ID = "c-hold-001";
  const PAGO_ID = "p-flow-001";
  const supa = crearMockDb({
    citas: [
      {
        id: CITA_ID,
        cliente_id: CLIENTE_ID,
        profesional_id: PROFESIONAL_ID,
        inicio: "2026-10-01T14:00:00.000Z",
        fin: "2026-10-01T15:00:00.000Z",
        estado: "pendiente_pago",
        hold_expira_en: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    ],
  });

  const res = await manejarPagoConfirmadoBooking(
    {
      clienteId: CLIENTE_ID,
      pagoId: PAGO_ID,
      monto: 15000,
      payload: { reservaId: CITA_ID },
    },
    supa,
  );

  assert.equal(res.ok, true);
  assert.equal(res.confirmado, true);

  const cita = supa.tablas.ed_citas.find((c) => c.id === CITA_ID);
  assert.equal(cita.estado, "confirmada");
  assert.equal(cita.anticipo_pagado, true);
  assert.equal(cita.pago_id, PAGO_ID);
});

test("P1 - Idempotencia ante webhook duplicado", async () => {
  const CITA_ID = "c-hold-002";
  const PAGO_ID = "p-flow-002";
  const supa = crearMockDb({
    citas: [
      {
        id: CITA_ID,
        cliente_id: CLIENTE_ID,
        profesional_id: PROFESIONAL_ID,
        inicio: "2026-10-01T14:00:00.000Z",
        fin: "2026-10-01T15:00:00.000Z",
        estado: "confirmada",
        anticipo_pagado: true,
        pago_id: PAGO_ID,
      },
    ],
  });

  const res = await manejarPagoConfirmadoBooking(
    {
      clienteId: CLIENTE_ID,
      pagoId: PAGO_ID,
      monto: 15000,
      payload: { reservaId: CITA_ID },
    },
    supa,
  );

  assert.equal(res.ok, true);
  assert.equal(res.confirmado, true);
  assert.equal(res.yaConfirmado, true);
});

test("P1 - Concurrencia crítica: pago después de liberación cuando slot fue tomado por otro -> REQUIERE_ATENCION", async () => {
  const CITA_HOLD_ID = "c-hold-expirada";
  const CITA_NUEVA_ID = "c-ganadora-003";
  const PAGO_ID = "p-flow-003";

  const supa = crearMockDb({
    citas: [
      {
        id: CITA_HOLD_ID,
        cliente_id: CLIENTE_ID,
        profesional_id: PROFESIONAL_ID,
        inicio: "2026-10-01T14:00:00.000Z",
        fin: "2026-10-01T15:00:00.000Z",
        estado: "expirada",
        hold_expira_en: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      // Otro cliente tomó ese mismo slot mientras tanto
      {
        id: CITA_NUEVA_ID,
        cliente_id: CLIENTE_ID,
        profesional_id: PROFESIONAL_ID,
        inicio: "2026-10-01T14:00:00.000Z",
        fin: "2026-10-01T15:00:00.000Z",
        estado: "agendada",
      },
    ],
  });

  const res = await manejarPagoConfirmadoBooking(
    {
      clienteId: CLIENTE_ID,
      pagoId: PAGO_ID,
      monto: 15000,
      payload: { reservaId: CITA_HOLD_ID },
    },
    supa,
  );

  assert.equal(res.ok, true);
  assert.equal(res.confirmado, false);
  assert.equal(res.requiereAtencion, true);

  const citaHold = supa.tablas.ed_citas.find((c) => c.id === CITA_HOLD_ID);
  assert.equal(citaHold.estado, "requiere_atencion");
  assert.equal(citaHold.requiere_atencion, true);
  assert.equal(citaHold.anticipo_pagado, true);
  assert.equal(citaHold.pago_id, PAGO_ID);
  assert.match(citaHold.motivo_atencion, /tomado tras expirar/);
});

test("P1 - Expirador cron: libera holds expirados de manera idempotente", async () => {
  const ahora = Date.now();
  const supa = crearMockDb({
    citas: [
      {
        id: "c-vencida-1",
        cliente_id: CLIENTE_ID,
        estado: "pendiente_pago",
        hold_expira_en: new Date(ahora - 1000).toISOString(),
      },
      {
        id: "c-viva-2",
        cliente_id: CLIENTE_ID,
        estado: "pendiente_pago",
        hold_expira_en: new Date(ahora + 10 * 60_000).toISOString(),
      },
    ],
  });

  const res = await liberarHoldsExpirados(CLIENTE_ID, supa);
  assert.equal(res.ok, true);
  assert.equal(res.liberadas, 1);

  const c1 = supa.tablas.ed_citas.find((c) => c.id === "c-vencida-1");
  const c2 = supa.tablas.ed_citas.find((c) => c.id === "c-viva-2");
  assert.equal(c1.estado, "expirada");
  assert.equal(c2.estado, "pendiente_pago");

  // Segunda corrida: idempotente, libera 0
  const res2 = await liberarHoldsExpirados(CLIENTE_ID, supa);
  assert.equal(res2.ok, true);
  assert.equal(res2.liberadas, 0);
});
