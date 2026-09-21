import test from "node:test";
import assert from "node:assert/strict";
import {
  inscribirConCredito,
  cancelarInscripcionCredito,
  registrarNoShow,
} from "../lib/classes/atomicBooking.ts";

const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const CONTACTO_ID = "k0000000-0000-0000-0000-000000000001";
const CLASE_ID = "clase-pilates-1900";

function crearMockDb(datosIniciales = {}) {
  const tablas = {
    ed_clases: [...(datosIniciales.clases ?? [])],
    ed_citas: [...(datosIniciales.citas ?? [])],
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
            const estadoAnterior = m.estado;
            Object.assign(m, updateData);
            if (
              tabla === "ed_citas" &&
              m.clase_id &&
              ["agendada", "confirmada", "reagendada"].includes(estadoAnterior) &&
              !["agendada", "confirmada", "reagendada"].includes(m.estado)
            ) {
              const clase = tablas.ed_clases.find((c) => c.id === m.clase_id);
              if (clase) clase.cupo_ocupado = Math.max(0, clase.cupo_ocupado - 1);
            }
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
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "RPC mocked fallback" } }),
  };
}

test("P3 - Inscripción atómica con crédito: descuenta saldo y ocupa cupo", async () => {
  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        profesional_id: "prof-clara",
        inicio: new Date(Date.now() + 24 * 3600_000).toISOString(),
        fin: new Date(Date.now() + 25 * 3600_000).toISOString(),
        cupo_maximo: 10,
        cupo_ocupado: 4,
        estado: "activa",
      },
    ],
    membresias: [
      {
        id: "mem-01",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 5,
        es_ilimitada: false,
        estado: "activa",
        fin: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      },
    ],
  });

  const res = await inscribirConCredito({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    claseId: CLASE_ID,
    nombre: "Ana Gómez",
    telefono: "56988776655",
    supa,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.cupoOcupado, 5);
    assert.equal(res.saldoRestante, 4);

    // Verificar en BD
    const clase = supa.tablas.ed_clases.find((c) => c.id === CLASE_ID);
    assert.equal(clase.cupo_ocupado, 5);

    const mem = supa.tablas.ed_membresias.find((m) => m.id === "mem-01");
    assert.equal(mem.creditos_saldo, 4);

    const cita = supa.tablas.ed_citas.find((c) => c.id === res.citaId);
    assert.ok(cita);
    assert.equal(cita.estado, "confirmada");
  }
});

test("P3 - Rechaza si el socio tiene saldo 0", async () => {
  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cliente_id: CLIENTE_ID,
        inicio: new Date(Date.now() + 24 * 3600_000).toISOString(),
        fin: new Date(Date.now() + 25 * 3600_000).toISOString(),
        cupo_maximo: 10,
        cupo_ocupado: 4,
        estado: "activa",
      },
    ],
    membresias: [
      {
        id: "mem-sin-saldo",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 0,
        es_ilimitada: false,
        estado: "agotada",
        fin: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      },
    ],
  });

  const res = await inscribirConCredito({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    claseId: CLASE_ID,
    nombre: "Ana Gómez",
    supa,
  });

  assert.equal(res.ok, false);
  assert.equal(res.motivo, "sin_creditos");
});

test("P3 - Rechaza si la membresía está vencida", async () => {
  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cliente_id: CLIENTE_ID,
        inicio: new Date(Date.now() + 24 * 3600_000).toISOString(),
        fin: new Date(Date.now() + 25 * 3600_000).toISOString(),
        cupo_maximo: 10,
        cupo_ocupado: 4,
        estado: "activa",
      },
    ],
    membresias: [
      {
        id: "mem-vencida",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 3,
        es_ilimitada: false,
        estado: "vencida",
        fin: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      },
    ],
  });

  const res = await inscribirConCredito({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    claseId: CLASE_ID,
    nombre: "Ana Gómez",
    supa,
  });

  assert.equal(res.ok, false);
  assert.equal(res.motivo, "membresia_vencida");
});

test("P3 - Doble clic: rechaza si la misma persona ya está inscrita", async () => {
  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cliente_id: CLIENTE_ID,
        inicio: new Date(Date.now() + 24 * 3600_000).toISOString(),
        fin: new Date(Date.now() + 25 * 3600_000).toISOString(),
        cupo_maximo: 10,
        cupo_ocupado: 1,
        estado: "activa",
      },
    ],
    membresias: [
      {
        id: "mem-01",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 5,
        es_ilimitada: false,
        estado: "activa",
        fin: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      },
    ],
    citas: [
      {
        id: "cita-existente",
        cliente_id: CLIENTE_ID,
        clase_id: CLASE_ID,
        chat_id: "56988776655",
        estado: "confirmada",
      },
    ],
  });

  const res = await inscribirConCredito({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    claseId: CLASE_ID,
    nombre: "Ana Gómez",
    chatId: "56988776655",
    supa,
  });

  assert.equal(res.ok, false);
  assert.equal(res.motivo, "ya_inscrito");
});

test("P3 - Cancelación a tiempo: libera cupo y devuelve crédito (+1 en ledger)", async () => {
  const CITA_ID = "cita-cancelable-1";
  const MEM_ID = "mem-devolucion";
  const inicioFuturo = new Date(Date.now() + 24 * 3600_000); // 24h antes (> 2h)

  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cupo_ocupado: 5,
      },
    ],
    citas: [
      {
        id: CITA_ID,
        cliente_id: CLIENTE_ID,
        clase_id: CLASE_ID,
        inicio: inicioFuturo.toISOString(),
        estado: "confirmada",
      },
    ],
    membresias: [
      {
        id: MEM_ID,
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        creditos_saldo: 4,
        es_ilimitada: false,
        estado: "activa",
        fin: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      },
    ],
  });

  const res = await cancelarInscripcionCredito({
    clienteId: CLIENTE_ID,
    citaId: CITA_ID,
    contactoId: CONTACTO_ID,
    supa,
  });

  assert.equal(res.ok, true);
  assert.equal(res.cancelada, true);
  assert.equal(res.creditoDevuelto, true);
  assert.equal(res.saldoResultante, 5);

  // Comprobar que el cupo decrementó
  const clase = supa.tablas.ed_clases.find((c) => c.id === CLASE_ID);
  assert.equal(clase.cupo_ocupado, 4);

  // Comprobar ledger con movimiento 'devolucion_cancelacion'
  const mov = supa.tablas.ed_creditos_ledger.find((l) => l.tipo_movimiento === "devolucion_cancelacion");
  assert.ok(mov);
  assert.equal(mov.delta, 1);
});

test("P3 - Cancelación fuera de plazo: cancela cita y libera cupo pero NO devuelve crédito", async () => {
  const CITA_ID = "cita-tardia-1";
  const inicioInminente = new Date(Date.now() + 30 * 60_000); // En 30 minutos (< 2h)

  const supa = crearMockDb({
    clases: [
      {
        id: CLASE_ID,
        cupo_ocupado: 5,
      },
    ],
    citas: [
      {
        id: CITA_ID,
        cliente_id: CLIENTE_ID,
        clase_id: CLASE_ID,
        inicio: inicioInminente.toISOString(),
        estado: "confirmada",
      },
    ],
  });

  const res = await cancelarInscripcionCredito({
    clienteId: CLIENTE_ID,
    citaId: CITA_ID,
    contactoId: CONTACTO_ID,
    supa,
  });

  assert.equal(res.ok, true);
  assert.equal(res.cancelada, true);
  assert.equal(res.creditoDevuelto, false);
  assert.equal(res.motivo, "fuera_de_ventana");

  // El cupo sí se libera para otro alumno
  const clase = supa.tablas.ed_clases.find((c) => c.id === CLASE_ID);
  assert.equal(clase.cupo_ocupado, 4);

  // Cero movimientos en ledger
  assert.equal(supa.tablas.ed_creditos_ledger.length, 0);
});

test("P3 - Registro de No-Show manual", async () => {
  const CITA_ID = "cita-no-show";
  const supa = crearMockDb({
    citas: [
      {
        id: CITA_ID,
        cliente_id: CLIENTE_ID,
        estado: "confirmada",
      },
    ],
  });

  const res = await registrarNoShow({
    clienteId: CLIENTE_ID,
    citaId: CITA_ID,
    notas: "Alumno no asistió a pilates",
    supa,
  });

  assert.equal(res.ok, true);
  const cita = supa.tablas.ed_citas.find((c) => c.id === CITA_ID);
  assert.equal(cita.estado, "no_show");
});

test("P3 - Concurrencia real: 3 reservas compitiendo por el ÚLTIMO cupo -> sólo 1 gana y cupo máximo respetado", async () => {
  // Clase de cupo máximo 10, con 9 ya ocupados (queda solo 1 lugar disponible)
  const claseCompartida = {
    id: CLASE_ID,
    cliente_id: CLIENTE_ID,
    inicio: new Date(Date.now() + 24 * 3600_000).toISOString(),
    fin: new Date(Date.now() + 25 * 3600_000).toISOString(),
    cupo_maximo: 10,
    cupo_ocupado: 9,
    estado: "activa",
  };

  const supa = crearMockDb({
    clases: [claseCompartida],
    membresias: [
      { id: "mem-a", cliente_id: CLIENTE_ID, contacto_id: "user-a", creditos_saldo: 3, es_ilimitada: false, estado: "activa", fin: new Date(Date.now() + 10 * 86_400_000).toISOString() },
      { id: "mem-b", cliente_id: CLIENTE_ID, contacto_id: "user-b", creditos_saldo: 3, es_ilimitada: false, estado: "activa", fin: new Date(Date.now() + 10 * 86_400_000).toISOString() },
      { id: "mem-c", cliente_id: CLIENTE_ID, contacto_id: "user-c", creditos_saldo: 3, es_ilimitada: false, estado: "activa", fin: new Date(Date.now() + 10 * 86_400_000).toISOString() },
    ],
  });

  // Ejecución simultánea
  const resultados = await Promise.all([
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "user-a", claseId: CLASE_ID, nombre: "User A", supa }),
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "user-b", claseId: CLASE_ID, nombre: "User B", supa }),
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "user-c", claseId: CLASE_ID, nombre: "User C", supa }),
  ]);

  const exitosas = resultados.filter((r) => r.ok);
  const rechazadas = resultados.filter((r) => !r.ok);

  // Exactamente UNA gana el último cupo
  assert.equal(exitosas.length, 1);
  // Las otras dos son rechazadas por cupo agotado
  assert.equal(rechazadas.length, 2);
  for (const r of rechazadas) {
    assert.equal(r.motivo, "cupo_agotado");
  }

  // Invariante sagrada: el cupo ocupado NUNCA supera el cupo máximo
  const claseFinal = supa.tablas.ed_clases.find((c) => c.id === CLASE_ID);
  assert.equal(claseFinal.cupo_ocupado, 10);
});
