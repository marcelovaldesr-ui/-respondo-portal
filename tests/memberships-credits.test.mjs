import test from "node:test";
import assert from "node:assert/strict";
import {
  crearPlan,
  altaMembresia,
  obtenerMembresiaActiva,
  procesarRenovacionMembresiaTrasPago,
} from "../lib/memberships/membershipsCore.ts";
import {
  registrarMovimientoCredito,
  reconstruirSaldoDesdeLedger,
} from "../lib/memberships/creditLedger.ts";

const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const OTRO_CLIENTE_ID = "c0000000-0000-0000-0000-000000000099";
const CONTACTO_ID = "k0000000-0000-0000-0000-000000000001";

function crearMockDb(datosIniciales = {}) {
  const tablas = {
    ed_planes: [...(datosIniciales.planes ?? [])],
    ed_membresias: [...(datosIniciales.membresias ?? [])],
    ed_creditos_ledger: [...(datosIniciales.ledger ?? [])],
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
        const t = tablas[tabla] ?? [];
        if (insertData) {
          const inserted = [];
          for (const item of insertData) {
            // Verificar unicidad en ed_creditos_ledger por (cliente_id, idempotency_key)
            if (tabla === "ed_creditos_ledger") {
              const existe = t.find((r) => r.cliente_id === item.cliente_id && r.idempotency_key === item.idempotency_key);
              if (existe) {
                resolve({ data: null, error: { code: "23505", message: "unique violation" } });
                return;
              }
            }
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

test("P2 - Creación de Plan y Alta de Membresía con créditos iniciales en Ledger", async () => {
  const supa = crearMockDb();

  // 1. Crear plan de 8 clases por $59.990
  const resPlan = await crearPlan({
    clienteId: CLIENTE_ID,
    nombre: "Pack 8 Clases Pilates",
    precioClp: 59990,
    creditosTotales: 8,
    vigenciaDias: 30,
    supa,
  });

  assert.equal(resPlan.ok, true);
  if (!resPlan.ok) return;

  // 2. Dar de alta membresía para contacto
  const resAlta = await altaMembresia({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    planId: resPlan.planId,
    supa,
  });

  assert.equal(resAlta.ok, true);
  if (!resAlta.ok) return;
  assert.equal(resAlta.creditosIniciales, 8);

  // 3. Verificar membresía creada
  const mem = supa.tablas.ed_membresias.find((m) => m.id === resAlta.membresiaId);
  assert.ok(mem);
  assert.equal(mem.creditos_saldo, 8);
  assert.equal(mem.estado, "activa");

  // 4. Verificar movimiento de alta en ledger
  const mov = supa.tablas.ed_creditos_ledger.find((l) => l.membresia_id === resAlta.membresiaId);
  assert.ok(mov);
  assert.equal(mov.tipo_movimiento, "alta_plan");
  assert.equal(mov.delta, 8);
  assert.equal(mov.saldo_resultante, 8);
});

test("P2 - Ledger: registro de consumos y consistencia matemática", async () => {
  const MEMBRESIA_ID = "mem-001";
  const supa = crearMockDb({
    membresias: [
      {
        id: MEMBRESIA_ID,
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 8,
        es_ilimitada: false,
        estado: "activa",
      },
    ],
    ledger: [
      {
        cliente_id: CLIENTE_ID,
        membresia_id: MEMBRESIA_ID,
        tipo_movimiento: "alta_plan",
        delta: 8,
        saldo_resultante: 8,
        idempotency_key: "alta-001",
      },
    ],
  });

  // Consumir 1 crédito por reserva
  const resConsumo = await registrarMovimientoCredito({
    clienteId: CLIENTE_ID,
    membresiaId: MEMBRESIA_ID,
    tipoMovimiento: "consumo_reserva",
    delta: -1,
    idempotencyKey: "reserva-cita-101",
    supa,
  });

  assert.equal(resConsumo.ok, true);
  if (resConsumo.ok) {
    assert.equal(resConsumo.saldoResultante, 7);
  }

  // Verificar reconstrucción directa sumando los deltas del ledger
  const recon = await reconstruirSaldoDesdeLedger(CLIENTE_ID, MEMBRESIA_ID, supa);
  assert.equal(recon.totalMovimientos, 2);
  assert.equal(recon.saldoCalculado, 7);
  assert.equal(recon.saldoCacheado, 7);
  assert.equal(recon.consistente, true);
});

test("P2 - Ledger: Idempotencia estricta ante reintentos con la misma clave", async () => {
  const MEMBRESIA_ID = "mem-002";
  const supa = crearMockDb({
    membresias: [
      {
        id: MEMBRESIA_ID,
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 5,
        es_ilimitada: false,
        estado: "activa",
      },
    ],
  });

  const params = {
    clienteId: CLIENTE_ID,
    membresiaId: MEMBRESIA_ID,
    tipoMovimiento: "consumo_reserva",
    delta: -1,
    idempotencyKey: "peticion-duplicada-key",
    supa,
  };

  // Primera ejecución
  const res1 = await registrarMovimientoCredito(params);
  assert.equal(res1.ok, true);
  if (res1.ok) assert.equal(res1.saldoResultante, 4);

  // Segunda ejecución con misma clave (doble clic)
  const res2 = await registrarMovimientoCredito(params);
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.saldoResultante, 4);
    assert.equal(res2.yaRegistrado, true);
  }

  // Comprobar que en el ledger existe EXACTAMENTE una fila
  const rows = supa.tablas.ed_creditos_ledger.filter((l) => l.idempotency_key === "peticion-duplicada-key");
  assert.equal(rows.length, 1);
});

test("P2 - Renovación tras PAYMENT_CONFIRMED: añade créditos y extiende vigencia", async () => {
  const PLAN_ID = "plan-pilates-8";
  const MEMBRESIA_ID = "mem-existente";
  const PAGO_ID = "pago-flow-renovacion";

  const inicioOriginal = new Date(Date.now() - 25 * 86_400_000);
  const finOriginal = new Date(Date.now() + 5 * 86_400_000);

  const supa = crearMockDb({
    planes: [
      {
        id: PLAN_ID,
        cliente_id: CLIENTE_ID,
        nombre: "Pack 8 Clases",
        precio_clp: 59990,
        creditos_totales: 8,
        vigencia_dias: 30,
        activo: true,
      },
    ],
    membresias: [
      {
        id: MEMBRESIA_ID,
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: PLAN_ID,
        inicio: inicioOriginal.toISOString(),
        fin: finOriginal.toISOString(),
        estado: "activa",
        creditos_saldo: 1,
        es_ilimitada: false,
      },
    ],
  });

  const resRenovacion = await procesarRenovacionMembresiaTrasPago(
    {
      clienteId: CLIENTE_ID,
      pagoId: PAGO_ID,
      contactoId: CONTACTO_ID,
      monto: 59990,
      payload: {
        tipoTransaccion: "renovacion_membresia",
        planId: PLAN_ID,
        contactoId: CONTACTO_ID,
      },
    },
    supa,
  );

  assert.equal(resRenovacion.ok, true);
  assert.equal(resRenovacion.renovado, true);

  // Verificar saldo actualizado en membresía (1 original + 8 nuevos = 9)
  const mem = supa.tablas.ed_membresias.find((m) => m.id === MEMBRESIA_ID);
  assert.equal(mem.creditos_saldo, 9);
  assert.equal(mem.estado, "activa");
  // Vigencia extendida: finOriginal + 30 días
  const finNueva = new Date(mem.fin).getTime();
  assert.ok(finNueva > finOriginal.getTime() + 28 * 86_400_000);

  // Verificar registro de renovación en el ledger
  const mov = supa.tablas.ed_creditos_ledger.find((l) => l.tipo_movimiento === "renovacion");
  assert.ok(mov);
  assert.equal(mov.delta, 8);
  assert.equal(mov.saldo_resultante, 9);
});

test("P2 - Tenant Isolation: no se accede ni se renueva membresía de otro cliente", async () => {
  const supa = crearMockDb({
    membresias: [
      {
        id: "mem-otro-tenant",
        cliente_id: OTRO_CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        fin: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        estado: "activa",
        creditos_saldo: 5,
      },
    ],
  });

  // Consultar con CLIENTE_ID no debe ver la de OTRO_CLIENTE_ID
  const mem = await obtenerMembresiaActiva(CLIENTE_ID, CONTACTO_ID, supa);
  assert.equal(mem, null);
});
