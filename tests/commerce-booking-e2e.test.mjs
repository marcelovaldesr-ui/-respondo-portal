import test from "node:test";
import assert from "node:assert/strict";
import { crearHoldReserva, manejarPagoConfirmadoBooking } from "../lib/booking/bookingAnticipos.ts";
import {
  altaMembresia,
  procesarRenovacionMembresiaTrasPago,
  obtenerMembresiaActiva,
} from "../lib/memberships/membershipsCore.ts";
import { inscribirConCredito } from "../lib/classes/atomicBooking.ts";
import {
  ejecutarAccionCommerce,
  procesarCommerceWhatsAppRapido,
} from "../lib/whatsapp/commerceBookingBot.ts";
import { reconstruirSaldoDesdeLedger } from "../lib/memberships/creditLedger.ts";
import { cifrar } from "../lib/cifrado.ts";

process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-unit-tests-12345";
const FLOW_SECRET_CIFRADO = cifrar("test-secret-flow-key", "flow-secret");

const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const CONTACTO_ID = "k0000000-0000-0000-0000-000000000001";
const CHAT_ID = "56998765432";

function crearE2EDb(datosIniciales = {}) {
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
    ed_contactos: [...(datosIniciales.contactos ?? [])],
    ed_servicios: [...(datosIniciales.servicios ?? [])],
    ed_profesionales: [...(datosIniciales.profesionales ?? [])],
    ed_servicio_profesional: [...(datosIniciales.servicio_profesional ?? [])],
    ed_planes: [...(datosIniciales.planes ?? [])],
    ed_membresias: [...(datosIniciales.membresias ?? [])],
    ed_creditos_ledger: [...(datosIniciales.ledger ?? [])],
    ed_clases: [...(datosIniciales.clases ?? [])],
    ed_citas: [...(datosIniciales.citas ?? [])],
    ed_pagos: [...(datosIniciales.pagos ?? [])],
    ed_eventos_comerciales: [...(datosIniciales.eventos ?? [])],
  };

  function matchFilters(row, filters) {
    for (const f of filters) {
      if (f.op === "eq" && row[f.col] !== f.val) return false;
      if (f.op === "neq" && row[f.col] === f.val) return false;
      if (f.op === "in" && (!Array.isArray(f.val) || !f.val.includes(row[f.col]))) return false;
      if (f.op === "gte" && row[f.col] < f.val) return false;
      if (f.op === "lte" && row[f.col] > f.val) return false;
      if (f.op === "gt" && row[f.col] <= f.val) return false;
      if (f.op === "lt" && row[f.col] >= f.val) return false;
      if (f.op === "is" && f.val === null && row[f.col] !== null) return false;
    }
    return true;
  }

  let concurrencyLock = false;

  const client = {
    _tablas: tablas,
    tablas,
    from(tableName) {
      if (!tablas[tableName]) tablas[tableName] = [];
      const list = tablas[tableName];
      const state = {
        filters: [],
        selectedCols: "*",
        limitVal: null,
        orderCol: null,
        ascending: true,
        action: "select",
        insertData: null,
        updateData: null,
      };

      const chain = {
        select(cols = "*") {
          state.selectedCols = cols;
          return chain;
        },
        eq(col, val) {
          state.filters.push({ op: "eq", col, val });
          return chain;
        },
        neq(col, val) {
          state.filters.push({ op: "neq", col, val });
          return chain;
        },
        in(col, val) {
          state.filters.push({ op: "in", col, val });
          return chain;
        },
        is(col, val) {
          state.filters.push({ op: "is", col, val });
          return chain;
        },
        gte(col, val) {
          state.filters.push({ op: "gte", col, val });
          return chain;
        },
        lte(col, val) {
          state.filters.push({ op: "lte", col, val });
          return chain;
        },
        gt(col, val) {
          state.filters.push({ op: "gt", col, val });
          return chain;
        },
        lt(col, val) {
          state.filters.push({ op: "lt", col, val });
          return chain;
        },
        or() {
          return chain;
        },
        not() {
          return chain;
        },
        order(col, { ascending = true } = {}) {
          state.orderCol = col;
          state.ascending = ascending;
          return chain;
        },
        limit(num) {
          state.limitVal = num;
          return chain;
        },
        insert(rows) {
          state.action = "insert";
          state.insertData = Array.isArray(rows) ? rows : [rows];
          return chain;
        },
        update(data) {
          state.action = "update";
          state.updateData = data;
          return chain;
        },
        then(resolve, reject) {
          try {
            if (state.action === "insert") {
              const inserted = [];
              for (const item of state.insertData) {
                const newRow = {
                  id: item.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  creado_en: item.creado_en || new Date().toISOString(),
                  ...item,
                };
                list.push(newRow);
                inserted.push(newRow);
              }
              const res = { data: inserted, error: null };
              return Promise.resolve(resolve(res));
            }

            if (state.action === "update") {
              const updated = [];
              for (const row of list) {
                if (matchFilters(row, state.filters)) {
                  Object.assign(row, state.updateData);
                  updated.push(row);
                }
              }
              const res = { data: updated, error: null };
              return Promise.resolve(resolve(res));
            }

            let result = list.filter((r) => matchFilters(r, state.filters));
            if (state.orderCol) {
              result.sort((a, b) => {
                const va = a[state.orderCol];
                const vb = b[state.orderCol];
                if (va < vb) return state.ascending ? -1 : 1;
                if (va > vb) return state.ascending ? 1 : -1;
                return 0;
              });
            }
            if (state.limitVal !== null) {
              result = result.slice(0, state.limitVal);
            }

            if (state.selectedCols.includes("ed_servicios(nombre)")) {
              result = result.map((row) => {
                const svc = (tablas.ed_servicios ?? []).find((s) => s.id === row.servicio_id);
                return { ...row, ed_servicios: svc ? { nombre: svc.nombre } : null };
              });
            }

            const res = { data: result, error: null };
            return Promise.resolve(resolve(res));
          } catch (e) {
            return Promise.resolve(reject(e));
          }
        },
        async maybeSingle() {
          const res = await chain;
          const row = res.data && res.data.length > 0 ? res.data[0] : null;
          return { data: row, error: null };
        },
        async single() {
          return chain.maybeSingle();
        },
      };
      return chain;
    },
    async rpc(funcName, params) {
      if (funcName === "ed_inscribir_con_credito") {
        while (concurrencyLock) {
          await new Promise((r) => setTimeout(r, 2));
        }
        concurrencyLock = true;
        try {
          const mem = tablas.ed_membresias.find((m) => m.contacto_id === params.p_contacto_id);
          const clase = tablas.ed_clases.find((c) => c.id === params.p_clase_id);
          if (!mem || mem.creditos_saldo <= 0) {
            return { data: { ok: false, motivo: "sin_creditos" }, error: null };
          }
          if (clase.cupo_ocupado >= clase.cupo_maximo) {
            return { data: { ok: false, motivo: "cupo_agotado" }, error: null };
          }

          clase.cupo_ocupado += 1;
          mem.creditos_saldo -= 1;
          const citaId = `cita-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          tablas.ed_citas.push({
            id: citaId,
            cliente_id: params.p_cliente_id,
            clase_id: params.p_clase_id,
            contacto_id: params.p_contacto_id,
            chat_id: params.p_chat_id,
            estado: "confirmada",
            inicio: clase.inicio,
            fin: clase.fin,
            servicio_id: clase.servicio_id,
          });
          tablas.ed_creditos_ledger.push({
            id: `mov-${Date.now()}`,
            cliente_id: params.p_cliente_id,
            contacto_id: params.p_contacto_id,
            membresia_id: mem.id,
            tipo_movimiento: "consumo_reserva",
            delta: -1,
            saldo_resultante: mem.creditos_saldo,
            referencia: citaId,
            creado_en: new Date().toISOString(),
          });

          return {
            data: {
              ok: true,
              cita_id: citaId,
              saldo_restante: mem.creditos_saldo,
              cupo_ocupado: clase.cupo_ocupado,
              cupo_maximo: clase.cupo_maximo,
            },
            error: null,
          };
        } finally {
          concurrencyLock = false;
        }
      }
      return { data: null, error: null };
    },
  };
  return client;
}

test("E2E CASO A - Flujo Completo Anticipo: Hold 15m -> Flow Checkout -> PAYMENT_CONFIRMED -> Cita Confirmada", async () => {
  const supa = crearE2EDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Valentina Rozas" }],
    servicios: [
      {
        id: "svc-masaje",
        cliente_id: CLIENTE_ID,
        nombre: "Masaje Terapéutico",
        duracion_min: 60,
        requiere_anticipo: true,
        anticipo_monto_fijo: 10000,
        activo: true,
      },
    ],
    profesionales: [{ id: "prof-1", cliente_id: CLIENTE_ID, nombre: "Kinesióloga Andrea" }],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      token: "TOKEN-FLOW-E2E-123",
      url: "https://sandbox.flow.cl/app/web/pay.php",
      flowOrder: 10561800,
    }),
  });

  try {
    // 1. Cliente crea reserva con anticipo obligatorio
    const hold = await crearHoldReserva({
      clienteId: CLIENTE_ID,
      servicioId: "svc-masaje",
      profesionalId: "prof-1",
      inicioIso: "2026-09-25T15:00:00Z",
      nombreContacto: "Valentina Rozas",
      chatId: CHAT_ID,
      email: "valen@gmail.com",
      supa,
    });

    assert.equal(hold.ok, true);
    assert.equal(hold.montoAnticipo, 10000);
    assert.ok(hold.checkoutUrl.includes("flow.cl"));

    // Verificar estado inicial en DB: pendiente_pago
    const citaInicial = supa.tablas.ed_citas.find((c) => c.id === hold.citaId);
    assert.equal(citaInicial.estado, "pendiente_pago");
    assert.equal(citaInicial.anticipo_pagado, false);
    assert.ok(citaInicial.hold_expira_en);

    // 2. Simular pago exitoso en Flow y recepción de PAYMENT_CONFIRMED
    const eventoPago = {
      clienteId: CLIENTE_ID,
      contactoId: CONTACTO_ID,
      pagoId: hold.pagoId,
      monto: 10000,
      proveedor: "flow",
      proveedorOrden: String(hold.flowOrder),
      payload: {
        reservaId: hold.citaId,
      },
    };

    await manejarPagoConfirmadoBooking(eventoPago, supa);

    // 3. Verificar estado final: confirmada
    const citaFinal = supa.tablas.ed_citas.find((c) => c.id === hold.citaId);
    assert.equal(citaFinal.estado, "confirmada");
    assert.equal(citaFinal.anticipo_pagado, true);
    assert.equal(citaFinal.pago_id, hold.pagoId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("E2E CASO B - Membresía 8 Créditos -> WhatsApp Bot -> Reserva Clase -> 8 a 7 -> Cancelación a tiempo -> 7 a 8", async () => {
  const supa = crearE2EDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Martín Cárcamo" }],
    planes: [
      {
        id: "plan-pilates-8",
        cliente_id: CLIENTE_ID,
        nombre: "Pack 8 Clases Pilates",
        precio_clp: 45000,
        creditos_totales: 8,
        vigencia_dias: 30,
        activo: true,
      },
    ],
    servicios: [{ id: "svc-pilates", cliente_id: CLIENTE_ID, nombre: "Pilates Grupal" }],
    clases: [
      {
        id: "clase-pilates-martes",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        inicio: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), // mañana
        fin: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
        cupo_maximo: 10,
        cupo_ocupado: 2,
        estado: "activa",
      },
    ],
  });

  // 1. Alta de membresía (8 créditos iniciales en Ledger)
  const alta = await altaMembresia({
    clienteId: CLIENTE_ID,
    contactoId: CONTACTO_ID,
    planId: "plan-pilates-8",
    supa,
  });
  assert.equal(alta.ok, true);
  assert.equal(alta.creditosIniciales, 8);

  // 2. Consulta de créditos por WhatsApp
  const rConsulta = await procesarCommerceWhatsAppRapido({
    clienteId: CLIENTE_ID,
    empleadoId: "tino",
    chatId: CHAT_ID,
    textoEntrante: "¿Cuántas clases me quedan?",
    supa,
  });
  assert.ok(rConsulta.includes("8 clases disponibles"));

  // 3. Reserva de clase con crédito
  const rReserva = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    claseId: "clase-pilates-martes",
    texto: "Reserva la clase de mañana",
    nombreContacto: "Martín Cárcamo",
    supa,
  });
  assert.equal(rReserva.ejecutado, true);
  assert.ok(rReserva.respuestaTexto.includes("te quedan *7 créditos*"));

  // Verificar en base de datos y ledger
  const memTrasReserva = await obtenerMembresiaActiva(CLIENTE_ID, CONTACTO_ID, supa);
  assert.equal(memTrasReserva.creditos_saldo, 7);
  const rLedger1 = await reconstruirSaldoDesdeLedger(CLIENTE_ID, memTrasReserva.id, supa);
  assert.equal(rLedger1.saldoCalculado, 7);
  assert.equal(rLedger1.consistente, true);

  // 4. Cancelación con >2h de anticipación (a tiempo)
  const rCancel = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    texto: "No podré ir mañana",
    supa,
  });
  assert.equal(rCancel.ejecutado, true);
  assert.equal(rCancel.datosExtra?.devuelto, true);
  assert.ok(rCancel.respuestaTexto.includes("crédito fue devuelto"));

  // 5. Saldo final debe volver exactamente a 8
  const memFinal = await obtenerMembresiaActiva(CLIENTE_ID, CONTACTO_ID, supa);
  assert.equal(memFinal.creditos_saldo, 8);
  const rLedgerFinal = await reconstruirSaldoDesdeLedger(CLIENTE_ID, memFinal.id, supa);
  assert.equal(rLedgerFinal.saldoCalculado, 8);
  assert.equal(rLedgerFinal.consistente, true);
});

test("E2E CASO C - Concurrencia Crítica: 3 Alumnos compitiendo por el ÚLTIMO cupo -> sólo 1 gana y cupo máximo respetado", async () => {
  const supa = crearE2EDb({
    contactos: [
      { id: "c-1", cliente_id: CLIENTE_ID, chat_id: "569111", nombre: "Alumno 1" },
      { id: "c-2", cliente_id: CLIENTE_ID, chat_id: "569222", nombre: "Alumno 2" },
      { id: "c-3", cliente_id: CLIENTE_ID, chat_id: "569333", nombre: "Alumno 3" },
    ],
    membresias: [
      { id: "m-1", cliente_id: CLIENTE_ID, contacto_id: "c-1", estado: "activa", creditos_saldo: 3, fin: "2026-10-01T00:00:00Z" },
      { id: "m-2", cliente_id: CLIENTE_ID, contacto_id: "c-2", estado: "activa", creditos_saldo: 3, fin: "2026-10-01T00:00:00Z" },
      { id: "m-3", cliente_id: CLIENTE_ID, contacto_id: "c-3", estado: "activa", creditos_saldo: 3, fin: "2026-10-01T00:00:00Z" },
    ],
    clases: [
      {
        id: "clase-ult-cupo",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-yoga",
        cupo_maximo: 5,
        cupo_ocupado: 4, // QUEDA SÓLO 1 CUPO LIBRE
        estado: "activa",
        inicio: "2026-09-23T18:00:00Z",
        fin: "2026-09-23T19:00:00Z",
      },
    ],
  });

  const peticiones = [
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "c-1", claseId: "clase-ult-cupo", nombre: "Alumno 1", chatId: "569111", supa }),
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "c-2", claseId: "clase-ult-cupo", nombre: "Alumno 2", chatId: "569222", supa }),
    inscribirConCredito({ clienteId: CLIENTE_ID, contactoId: "c-3", claseId: "clase-ult-cupo", nombre: "Alumno 3", chatId: "569333", supa }),
  ];

  const resultados = await Promise.all(peticiones);
  const exitosos = resultados.filter((r) => r.ok);
  const rechazados = resultados.filter((r) => !r.ok);

  assert.equal(exitosos.length, 1, "EXACTAMENTE 1 alumno debe conseguir el último cupo");
  assert.equal(rechazados.length, 2, "Los otros 2 deben ser rechazados");
  assert.equal(rechazados[0].motivo, "cupo_agotado");
  assert.equal(rechazados[1].motivo, "cupo_agotado");

  // El cupo ocupado debe ser exactamente 5, jamás 6
  const claseFinal = supa.tablas.ed_clases.find((c) => c.id === "clase-ult-cupo");
  assert.equal(claseFinal.cupo_ocupado, 5);

  // Los 2 que perdieron deben mantener sus 3 créditos intactos
  const ganadorContactoId = supa.tablas.ed_citas[0].contacto_id;
  const perdedores = ["c-1", "c-2", "c-3"].filter((id) => id !== ganadorContactoId);
  for (const pId of perdedores) {
    const memPerdedor = supa.tablas.ed_membresias.find((m) => m.contacto_id === pId);
    assert.equal(memPerdedor.creditos_saldo, 3, `Contacto ${pId} no debe haber perdido créditos`);
  }
});

test("E2E CASO D - Saldo 0 -> Link Flow -> PAYMENT_CONFIRMED -> Créditos Cargados -> Reserva Exitosa", async () => {
  const supa = crearE2EDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Ignacia Ovalle" }],
    planes: [
      {
        id: "plan-renovacion",
        cliente_id: CLIENTE_ID,
        nombre: "Pack Mensual 8 Clases",
        precio_clp: 48000,
        creditos_totales: 8,
        vigencia_dias: 30,
        activo: true,
      },
    ],
    membresias: [
      {
        id: "mem-agotada",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-renovacion",
        inicio: "2026-09-01T00:00:00Z",
        fin: new Date(Date.now() + 30 * 86400000).toISOString(),
        estado: "agotada",
        creditos_saldo: 0,
        es_ilimitada: false,
      },
    ],
    clases: [
      {
        id: "clase-viernes",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        cupo_maximo: 8,
        cupo_ocupado: 1,
        estado: "activa",
        inicio: "2026-09-26T18:00:00Z",
        fin: "2026-09-26T19:00:00Z",
      },
    ],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      token: "TOKEN-FLOW-RENOV-999",
      url: "https://sandbox.flow.cl/app/web/pay.php",
      flowOrder: 10561999,
    }),
  });

  try {
    // 1. Cliente con 0 créditos consulta por WhatsApp
    const rConsulta = await procesarCommerceWhatsAppRapido({
      clienteId: CLIENTE_ID,
      empleadoId: "tino",
      chatId: CHAT_ID,
      textoEntrante: "cuántas clases me quedan?",
      supa,
    });
    assert.ok(rConsulta.includes("no te quedan créditos disponibles"));
    assert.ok(rConsulta.includes("flow.cl"));

    // 2. Cliente intenta reservar clase sin saldo -> Rechazado
    const rIntentoReserva = await ejecutarAccionCommerce({
      clienteId: CLIENTE_ID,
      chatId: CHAT_ID,
      claseId: "clase-viernes",
      texto: "Reserva la clase del viernes",
      supa,
    });
    assert.equal(rIntentoReserva.ejecutado, false);
    assert.ok(rIntentoReserva.respuestaTexto.includes("No tienes créditos vigentes disponibles"));

    // 3. Cliente paga link de renovación en Flow -> PAYMENT_CONFIRMED procesado
    const eventoPagoRenovacion = {
      clienteId: CLIENTE_ID,
      contactoId: CONTACTO_ID,
      pagoId: "pago-renov-123",
      monto: 48000,
      proveedor: "flow",
      proveedorOrden: "10561999",
      payload: {
        tipoTransaccion: "renovacion_membresia",
        planId: "plan-renovacion",
        contactoId: CONTACTO_ID,
      },
    };

    await procesarRenovacionMembresiaTrasPago(eventoPagoRenovacion, supa);

    // 4. Membresía renovada: saldo debe ser 8 y estado "activa"
    const memRenovada = await obtenerMembresiaActiva(CLIENTE_ID, CONTACTO_ID, supa);
    assert.equal(memRenovada.estado, "activa");
    assert.equal(memRenovada.creditos_saldo, 8);

    // 5. Cliente reserva nuevamente la clase -> AHORA SÍ es exitosa y saldo baja a 7
    const rReservaExitosa = await ejecutarAccionCommerce({
      clienteId: CLIENTE_ID,
      chatId: CHAT_ID,
      claseId: "clase-viernes",
      texto: "Reserva la clase del viernes",
      nombreContacto: "Ignacia Ovalle",
      supa,
    });
    assert.equal(rReservaExitosa.ejecutado, true);
    assert.ok(rReservaExitosa.respuestaTexto.includes("Inscripción confirmada"));
    assert.equal(rReservaExitosa.datosExtra?.saldoRestante, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
