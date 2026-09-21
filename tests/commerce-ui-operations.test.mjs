import test from "node:test";
import assert from "node:assert/strict";

import {
  listarMembresiasOperacionales,
  obtenerDetalleMembresiaOperacional,
  ajusteManualCreditos,
  renovarMembresiaManual,
} from "../lib/memberships/membershipsOperations.ts";
import { obtenerMovimientosLedger } from "../lib/memberships/creditLedger.ts";
import {
  listarClasesOperacionales,
  obtenerDetalleClaseOperacional,
  marcarAsistenciaCita,
} from "../lib/classes/classesOperations.ts";
import {
  buscarClientesOperacionales,
  obtenerFichaClienteOperacional,
} from "../lib/clients/clientsOperations.ts";
import { obtenerOperacionHoy } from "../lib/operationsSummary.ts";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

function crearMockDb(datos = {}) {
  const tablas = {
    ed_clientes: [...(datos.clientes ?? [])],
    ed_contactos: [...(datos.contactos ?? [])],
    ed_planes: [...(datos.planes ?? [])],
    ed_membresias: [...(datos.membresias ?? [])],
    ed_creditos_ledger: [...(datos.ledger ?? [])],
    ed_clases: [...(datos.clases ?? [])],
    ed_citas: [...(datos.citas ?? [])],
    ed_pagos: [...(datos.pagos ?? [])],
  };

  function matchFilter(row, f) {
    if (f.op === "eq") return row[f.col] === f.val;
    if (f.op === "neq") return row[f.col] !== f.val;
    if (f.op === "is") return row[f.col] === f.val;
    if (f.op === "in") return Array.isArray(f.val) && f.val.includes(row[f.col]);
    if (f.op === "gte") return row[f.col] >= f.val;
    if (f.op === "lte") return row[f.col] <= f.val;
    if (f.op === "gt") return row[f.col] > f.val;
    if (f.op === "lt") return row[f.col] < f.val;
    if (f.op === "ilike") {
      const pattern = String(f.val).replace(/%/g, "").toLowerCase();
      return String(row[f.col] ?? "").toLowerCase().includes(pattern);
    }
    return true;
  }

  function crearQuery(tabla) {
    const filters = [];
    let isSingle = false;
    let isMaybeSingle = false;
    let isCountHead = false;
    let updateData = null;
    let insertData = null;

    const builder = {
      select: (_cols, opts) => {
        if (opts?.head && opts?.count === "exact") isCountHead = true;
        return builder;
      },
      eq: (col, val) => { filters.push({ op: "eq", col, val }); return builder; },
      neq: (col, val) => { filters.push({ op: "neq", col, val }); return builder; },
      is: (col, val) => { filters.push({ op: "is", col, val }); return builder; },
      in: (col, val) => { filters.push({ op: "in", col, val }); return builder; },
      gte: (col, val) => { filters.push({ op: "gte", col, val }); return builder; },
      lte: (col, val) => { filters.push({ op: "lte", col, val }); return builder; },
      gt: (col, val) => { filters.push({ op: "gt", col, val }); return builder; },
      lt: (col, val) => { filters.push({ op: "lt", col, val }); return builder; },
      ilike: (col, val) => { filters.push({ op: "ilike", col, val }); return builder; },
      or: (condition) => {
        filters.push({ op: "or", raw: condition });
        return builder;
      },
      order: () => builder,
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
        const rows = tablas[tabla] ?? [];
        if (insertData) {
          rows.push(...insertData);
          return resolve({ data: insertData, error: null });
        }
        if (updateData) {
          const matched = rows.filter((r) => filters.every((f) => matchFilter(r, f)));
          matched.forEach((r) => Object.assign(r, updateData));
          return resolve({ data: matched, error: null });
        }
        const filtered = rows.filter((r) => {
          for (const f of filters) {
            if (f.op === "or") {
              const match = f.raw.split(",").some((part) => {
                const [col, , val] = part.split(".");
                const search = (val ?? "").replace(/%/g, "").toLowerCase();
                return String(r[col] ?? "").toLowerCase().includes(search);
              });
              if (!match) return false;
            } else if (!matchFilter(r, f)) {
              return false;
            }
          }
          return true;
        });

        if (isCountHead) {
          return resolve({ data: null, count: filtered.length, error: null });
        }
        if (isSingle) {
          return resolve({ data: filtered[0] ?? null, error: filtered[0] ? null : { message: "Not found" } });
        }
        if (isMaybeSingle) {
          return resolve({ data: filtered[0] ?? null, error: null });
        }
        return resolve({ data: filtered, error: null });
      },
    };
    return builder;
  }

  return {
    from: (tabla) => crearQuery(tabla),
    _tablas: tablas,
  };
}

// ── 1. TENANT ISOLATION ──────────────────────────────────────────────

test("Tenant Isolation: las membresías de Tenant A nunca son visibles para Tenant B", async () => {
  const supa = crearMockDb({
    membresias: [
      {
        id: "m-1",
        cliente_id: TENANT_A,
        contacto_id: "c-1",
        plan_id: "p-1",
        estado: "activa",
        creditos_saldo: 5,
        fin: "2026-10-01",
        ed_contactos: { nombre: "Alumno A", telefono: "+569111", chat_id: "569111" },
        ed_planes: { nombre: "Plan 8", precio_clp: 50000, creditos_totales: 8 },
      },
      {
        id: "m-2",
        cliente_id: TENANT_B,
        contacto_id: "c-2",
        plan_id: "p-2",
        estado: "activa",
        creditos_saldo: 8,
        fin: "2026-10-01",
        ed_contactos: { nombre: "Alumno B", telefono: "+569222", chat_id: "569222" },
        ed_planes: { nombre: "Plan 12", precio_clp: 70000, creditos_totales: 12 },
      },
    ],
    citas: [],
  });

  const resA = await listarMembresiasOperacionales(TENANT_A, supa);
  assert.equal(resA.membresias.length, 1);
  assert.equal(resA.membresias[0].id, "m-1");
  assert.equal(resA.membresias[0].contactoNombre, "Alumno A");

  const resB = await listarMembresiasOperacionales(TENANT_B, supa);
  assert.equal(resB.membresias.length, 1);
  assert.equal(resB.membresias[0].id, "m-2");
  assert.equal(resB.membresias[0].contactoNombre, "Alumno B");
});

test("Tenant Isolation: las clases de Tenant A nunca son visibles para Tenant B", async () => {
  const ahora = new Date(Date.now() + 3600_000).toISOString();
  const fin = new Date(Date.now() + 7200_000).toISOString();
  const supa = crearMockDb({
    clases: [
      {
        id: "clase-a",
        cliente_id: TENANT_A,
        servicio_id: "s-1",
        profesional_id: "p-1",
        inicio: ahora,
        fin: fin,
        cupo_maximo: 10,
        cupo_ocupado: 2,
        estado: "programada",
        ed_servicios: { nombre: "Pilates A" },
        ed_profesionales: { nombre: "Clara" },
      },
      {
        id: "clase-b",
        cliente_id: TENANT_B,
        servicio_id: "s-2",
        profesional_id: "p-2",
        inicio: ahora,
        fin: fin,
        cupo_maximo: 8,
        cupo_ocupado: 1,
        estado: "programada",
        ed_servicios: { nombre: "Pilates B" },
        ed_profesionales: { nombre: "Diego" },
      },
    ],
  });

  const resA = await listarClasesOperacionales(TENANT_A, supa);
  const todasA = [...resA.hoy, ...resA.estaSemana, ...resA.proximas];
  assert.equal(todasA.some((c) => c.servicioNombre === "Pilates A"), true);
  assert.equal(todasA.some((c) => c.servicioNombre === "Pilates B"), false);
});

// ── 2. KPIS DE MEMBRESÍAS ──────────────────────────────────────────

test("Membresías: cálculo de KPIs operacionales (activas, vencen, sin créditos)", async () => {
  const hoyMs = Date.now();
  const en3DiasIso = new Date(hoyMs + 3 * 86_400_000).toISOString();
  const en20DiasIso = new Date(hoyMs + 20 * 86_400_000).toISOString();

  const supa = crearMockDb({
    membresias: [
      // Activa con créditos que vence en 20 días
      {
        id: "m-1",
        cliente_id: TENANT_A,
        contacto_id: "c-1",
        plan_id: "p-1",
        estado: "activa",
        creditos_saldo: 4,
        fin: en20DiasIso,
        ed_contactos: { nombre: "C1" },
        ed_planes: { nombre: "Plan 1" },
      },
      // Activa pero vence esta semana (en 3 días)
      {
        id: "m-2",
        cliente_id: TENANT_A,
        contacto_id: "c-2",
        plan_id: "p-1",
        estado: "activa",
        creditos_saldo: 2,
        fin: en3DiasIso,
        ed_contactos: { nombre: "C2" },
        ed_planes: { nombre: "Plan 1" },
      },
      // Activa pero agotada (saldo 0)
      {
        id: "m-3",
        cliente_id: TENANT_A,
        contacto_id: "c-3",
        plan_id: "p-1",
        estado: "activa",
        creditos_saldo: 0,
        fin: en20DiasIso,
        ed_contactos: { nombre: "C3" },
        ed_planes: { nombre: "Plan 1" },
      },
      // Ya vencida (saldo 0)
      {
        id: "m-4",
        cliente_id: TENANT_A,
        contacto_id: "c-4",
        plan_id: "p-1",
        estado: "vencida",
        creditos_saldo: 0,
        fin: "2026-01-01",
        ed_contactos: { nombre: "C4" },
        ed_planes: { nombre: "Plan 1" },
      },
    ],
    citas: [],
  });

  const res = await listarMembresiasOperacionales(TENANT_A, supa);
  assert.equal(res.kpis.activas, 3);
  assert.equal(res.kpis.vencenEstaSemana, 1);
  assert.equal(res.kpis.sinCreditos, 2);
  assert.equal(res.kpis.renovacionesPendientes, 1);
});

// ── 3. LEDGER INMUTABLE Y AJUSTE MANUAL ─────────────────────────────

test("Auditoría de Ledger: requiere motivo obligatorio para ajuste manual", async () => {
  const supa = crearMockDb({
    membresias: [
      { id: "m-10", cliente_id: TENANT_A, contacto_id: "c-10", creditos_saldo: 3 },
    ],
  });

  const resSinMotivo = await ajusteManualCreditos({
    clienteId: TENANT_A,
    membresiaId: "m-10",
    delta: 2,
    motivo: "",
    supa,
  });
  assert.equal(resSinMotivo.ok, false);
  assert.match(resSinMotivo.error, /motivo.*obligatorio/i);
});

test("Auditoría de Ledger: escribe registro inmutable con tipo ajuste_manual", async () => {
  const supa = crearMockDb({
    membresias: [
      { id: "m-10", cliente_id: TENANT_A, contacto_id: "c-10", creditos_saldo: 3 },
    ],
    ledger: [],
  });

  const res = await ajusteManualCreditos({
    clienteId: TENANT_A,
    membresiaId: "m-10",
    delta: 2,
    motivo: "Compensación clase feriado",
    supa,
  });

  assert.equal(res.ok, true);
  assert.equal(res.nuevoSaldo, 5);

  const movimientos = await obtenerMovimientosLedger(TENANT_A, "m-10", supa);
  assert.equal(movimientos.length, 1);
  assert.equal(movimientos[0].tipoMovimiento, "ajuste_manual");
  assert.equal(movimientos[0].delta, 2);
  assert.equal(movimientos[0].saldoResultante, 5);
  assert.match(movimientos[0].motivo, /Compensación clase feriado/);
});

test("Renovación manual: falla cerrado cuando el RPC atómico aún no está aplicado", async () => {
  let escrituras = 0;
  const supa = {
    from() {
      escrituras += 1;
      throw new Error("No debe escribir por pasos");
    },
    async rpc() {
      return { data: null, error: { code: "PGRST202", message: "RPC ausente" } };
    },
  };

  const res = await renovarMembresiaManual({
    clienteId: TENANT_A,
    membresiaId: "m-atomic",
    supa,
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /actualización operativa/i);
  assert.equal(escrituras, 0);
});

test("Renovación manual: usa una sola operación transaccional", async () => {
  let llamada = null;
  const supa = {
    async rpc(nombre, params) {
      llamada = { nombre, params };
      return { data: [{ ok: true, nueva_fin: "2026-12-01", saldo_resultante: 13 }], error: null };
    },
  };

  const res = await renovarMembresiaManual({
    clienteId: TENANT_A,
    membresiaId: "m-atomic",
    supa,
  });

  assert.equal(res.ok, true);
  assert.equal(llamada.nombre, "ed_renovar_membresia_manual");
  assert.equal(llamada.params.p_cliente_id, TENANT_A);
  assert.equal(llamada.params.p_membresia_id, "m-atomic");
  assert.match(llamada.params.p_idempotency_key, /^renov-manual-m-atomic-/);
});

// ── 4. CLASES Y ASISTENCIA ─────────────────────────────────────────

test("Clases: marca asistencia como completada", async () => {
  const supa = crearMockDb({
    citas: [
      { id: "cita-123", cliente_id: TENANT_A, estado: "confirmada" },
    ],
  });

  const res = await marcarAsistenciaCita(TENANT_A, "cita-123", supa);
  assert.equal(res.ok, true);

  const citaActualizada = supa._tablas.ed_citas.find((c) => c.id === "cita-123");
  assert.equal(citaActualizada.estado, "completada");
});

// ── 5. OPERACIÓN HOY & REGRESSION TESTING ──────────────────────────

test("Operación de Hoy: devuelve null si commerce_booking_v1_activo es false (cero regresión)", async () => {
  const supa = crearMockDb({
    clientes: [
      { id: TENANT_A, commerce_booking_v1_activo: false },
    ],
  });

  const res = await obtenerOperacionHoy(TENANT_A, supa);
  assert.equal(res, null);
});

test("Operación de Hoy: calcula métricas correctamente cuando commerce está activo", async () => {
  const hoyIso = new Date().toISOString();
  const supa = crearMockDb({
    clientes: [
      { id: TENANT_A, commerce_booking_v1_activo: true },
    ],
    clases: [
      { id: "cl-1", cliente_id: TENANT_A, inicio: hoyIso, cupo_maximo: 8, cupo_ocupado: 6, estado: "activa" },
      { id: "cl-2", cliente_id: TENANT_A, inicio: hoyIso, cupo_maximo: 10, cupo_ocupado: 4, estado: "activa" },
    ],
    citas: [
      { id: "ci-1", cliente_id: TENANT_A, clase_id: null, inicio: hoyIso, estado: "confirmada" },
      { id: "ci-2", cliente_id: TENANT_A, clase_id: null, inicio: hoyIso, estado: "pendiente_pago", hold_expira_en: new Date(Date.now() + 10 * 60_000).toISOString() },
    ],
    membresias: [
      { id: "mb-1", cliente_id: TENANT_A, estado: "activa", fin: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    ],
  });

  const res = await obtenerOperacionHoy(TENANT_A, supa);
  assert.notEqual(res, null);
  assert.equal(res.clasesHoy, 2);
  assert.equal(res.cuposLibresHoy, (8 - 6) + (10 - 4)); // 2 + 6 = 8
  assert.equal(res.citasHoy, 2);
  assert.equal(res.holdsPendientes, 1);
  assert.equal(res.membresiasPorVencer7d, 1);
});

// ── 6. DETALLES Y FICHAS OPERACIONALES ──────────────────────────────

test("Membresías: detalle operacional obtiene plan y movimientos de ledger", async () => {
  const supa = crearMockDb({
    membresias: [
      {
        id: "m-100",
        cliente_id: TENANT_A,
        contacto_id: "c-100",
        plan_id: "p-1",
        creditos_saldo: 8,
        fin: "2026-11-01",
        estado: "activa",
        ed_contactos: { nombre: "Valentina R.", telefono: "+56912345678", chat_id: "56912345678" },
        ed_planes: { nombre: "Pilates 8", precio_clp: 60000, creditos_totales: 8, vigencia_dias: 30 },
      },
    ],
    ledger: [
      {
        id: "led-1",
        cliente_id: TENANT_A,
        membresia_id: "m-100",
        tipo_movimiento: "alta_plan",
        delta: 8,
        saldo_resultante: 8,
        creado_en: "2026-10-01T10:00:00Z",
      },
    ],
    citas: [],
    pagos: [],
  });

  const detalle = await obtenerDetalleMembresiaOperacional(TENANT_A, "m-100", supa);
  assert.notEqual(detalle, null);
  assert.equal(detalle.contactoNombre, "Valentina R.");
  assert.equal(detalle.planNombre, "Pilates 8");
  assert.equal(detalle.movimientosLedger.length, 1);
  assert.equal(detalle.movimientosLedger[0].tipoMovimiento, "alta_plan");
});

test("Membresías: el detalle no mezcla reservas de otro contacto del mismo tenant", async () => {
  const futuro = new Date(Date.now() + 86_400_000).toISOString();
  const supa = crearMockDb({
    membresias: [{
      id: "m-contacto-1",
      cliente_id: TENANT_A,
      contacto_id: "contacto-1",
      plan_id: "plan-1",
      creditos_saldo: 4,
      es_ilimitada: false,
      inicio: new Date().toISOString(),
      fin: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      estado: "activa",
      ed_contactos: { nombre: "Socio Uno", chat_id: "56911111111" },
      ed_planes: { nombre: "Plan 4", creditos_totales: 4 },
    }],
    citas: [
      { id: "reserva-propia", cliente_id: TENANT_A, contacto_id: "contacto-1", inicio: futuro, estado: "confirmada", ed_servicios: { nombre: "Pilates" } },
      { id: "reserva-ajena", cliente_id: TENANT_A, contacto_id: "contacto-2", inicio: futuro, estado: "confirmada", ed_servicios: { nombre: "Yoga" } },
    ],
    ledger: [],
    pagos: [],
  });

  const detalle = await obtenerDetalleMembresiaOperacional(TENANT_A, "m-contacto-1", supa);
  assert.deepEqual(detalle.proximasReservas.map((r) => r.citaId), ["reserva-propia"]);
});

test("Clases: detalle operacional lista asistentes inscritos", async () => {
  const supa = crearMockDb({
    clases: [
      {
        id: "cl-200",
        cliente_id: TENANT_A,
        cupo_maximo: 8,
        cupo_ocupado: 1,
        inicio: "2026-10-01T18:00:00Z",
        fin: "2026-10-01T19:00:00Z",
        estado: "programada",
        ed_servicios: { nombre: "Pilates Reformer" },
        ed_profesionales: { nombre: "Clara" },
      },
    ],
    citas: [
      {
        id: "cita-200",
        cliente_id: TENANT_A,
        clase_id: "cl-200",
        contacto_id: "c-100",
        nombre_contacto: "Valentina R.",
        telefono: "+56912345678",
        chat_id: "56912345678",
        estado: "confirmada",
        creado_en: "2026-09-20T10:00:00Z",
      },
    ],
    membresias: [
      {
        id: "m-100",
        cliente_id: TENANT_A,
        contacto_id: "c-100",
        plan_id: "p-1",
        estado: "activa",
        ed_planes: { nombre: "Pilates 8" },
      },
    ],
  });

  const detalle = await obtenerDetalleClaseOperacional(TENANT_A, "cl-200", supa);
  assert.notEqual(detalle, null);
  assert.equal(detalle.id, "cl-200");
  assert.equal(detalle.servicioNombre, "Pilates Reformer");
  assert.equal(detalle.inscritos.length, 1);
  assert.equal(detalle.inscritos[0].nombre, "Valentina R.");
  assert.equal(detalle.inscritos[0].planNombre, "Pilates 8");
});

test("Clientes: búsqueda operacional y ficha de cliente", async () => {
  const supa = crearMockDb({
    contactos: [
      {
        id: "c-500",
        cliente_id: TENANT_A,
        nombre: "Camila Silva",
        telefono: "+56987654321",
        email: "camila@test.cl",
        chat_id: "56987654321",
      },
    ],
    membresias: [
      {
        id: "m-500",
        cliente_id: TENANT_A,
        contacto_id: "c-500",
        plan_id: "p-5",
        estado: "activa",
        creditos_saldo: 6,
        fin: "2026-11-01",
        ed_planes: { nombre: "Plan Trimestral", creditos_totales: 24 },
      },
    ],
    planes: [
      { id: "p-5", cliente_id: TENANT_A, nombre: "Plan Trimestral", creditos_totales: 24 },
    ],
    citas: [],
    pagos: [],
  });

  const busqueda = await buscarClientesOperacionales(TENANT_A, "Camila", supa);
  assert.equal(busqueda.length, 1);
  assert.equal(busqueda[0].nombre, "Camila Silva");
  assert.equal(busqueda[0].membresia.planNombre, "Plan Trimestral");

  const ficha = await obtenerFichaClienteOperacional(TENANT_A, "c-500", supa);
  assert.notEqual(ficha, null);
  assert.equal(ficha.nombre, "Camila Silva");
  assert.equal(ficha.membresia.creditosSaldo, 6);
});
