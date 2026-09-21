import test from "node:test";
import assert from "node:assert/strict";
import {
  detectarIntencionCommerce,
  ejecutarAccionCommerce,
  procesarCommerceWhatsAppRapido,
  construirBloqueCommercePrompt,
} from "../lib/whatsapp/commerceBookingBot.ts";

const CLIENTE_ID = "c0000000-0000-0000-0000-000000000001";
const CONTACTO_ID = "k0000000-0000-0000-0000-000000000001";
const CHAT_ID = "56911223344";

function crearMockDb(datosIniciales = {}) {
  const tablas = {
    ed_clientes: [...(datosIniciales.clientes ?? [])],
    ed_contactos: [...(datosIniciales.contactos ?? [])],
    ed_planes: [...(datosIniciales.planes ?? [])],
    ed_membresias: [...(datosIniciales.membresias ?? [])],
    ed_creditos_ledger: [...(datosIniciales.ledger ?? [])],
    ed_clases: [...(datosIniciales.clases ?? [])],
    ed_citas: [...(datosIniciales.citas ?? [])],
    ed_servicios: [...(datosIniciales.servicios ?? [])],
    ed_servicio_profesional: [...(datosIniciales.servicio_profesional ?? [])],
    ed_profesionales: [...(datosIniciales.profesionales ?? [])],
    ed_pagos: [...(datosIniciales.pagos ?? [])],
    ed_configuracion: [...(datosIniciales.configuracion ?? [])],
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
    }
    return true;
  }

  const client = {
    _tablas: tablas,
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
        const citaId = `cita-${Date.now()}`;
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
      }
      return { data: null, error: null };
    },
  };
  return client;
}

test("P4 - Detección determinística de las 6 intenciones", () => {
  assert.equal(detectarIntencionCommerce("¿Cuántas clases me quedan?"), "CONSULTAR_CREDITOS");
  assert.equal(detectarIntencionCommerce("mis creditos"), "CONSULTAR_CREDITOS");
  assert.equal(detectarIntencionCommerce("estado de mi membresía"), "CONSULTAR_CREDITOS");

  assert.equal(detectarIntencionCommerce("¿Hay Pilates mañana después de las 18?"), "CONSULTAR_CLASES_CUPOS");
  assert.equal(detectarIntencionCommerce("¿Qué clases hay disponibles hoy?"), "CONSULTAR_CLASES_CUPOS");

  assert.equal(detectarIntencionCommerce("Reserva la de las 19:30"), "RESERVAR_CLASE");
  assert.equal(detectarIntencionCommerce("inscríbeme en la clase de pilates"), "RESERVAR_CLASE");

  assert.equal(detectarIntencionCommerce("No podré ir mañana"), "CANCELAR_RESERVA");
  assert.equal(detectarIntencionCommerce("cancela mi reserva"), "CANCELAR_RESERVA");

  assert.equal(detectarIntencionCommerce("Quiero renovar mi plan"), "RENOVAR_MEMBRESIA");
  assert.equal(detectarIntencionCommerce("comprar más clases"), "RENOVAR_MEMBRESIA");

  assert.equal(detectarIntencionCommerce("pagar el anticipo"), "PAGAR_ANTICIPO");
  assert.equal(detectarIntencionCommerce("link de anticipo"), "PAGAR_ANTICIPO");

  // Consulta general fuera de commerce
  assert.equal(detectarIntencionCommerce("Hola, cuánto cuesta imprimir 100 flyers?"), null);
});

test("P4 - CONSULTAR_CREDITOS con saldo: responde determinísticamente sin alucinar", async () => {
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Catalina López" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases Mensual", precio_clp: 45000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 5,
        es_ilimitada: false,
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    texto: "¿Cuántas clases me quedan?",
    supa,
  });

  assert.equal(res.accion, "CONSULTAR_CREDITOS");
  assert.equal(res.ejecutado, true);
  assert.ok(res.respuestaTexto.includes("5 clases disponibles"));
  assert.ok(res.respuestaTexto.includes("Plan 8 Clases Mensual"));
  assert.equal(res.datosExtra?.saldo, 5);
});

test("P4 - CONSULTAR_CREDITOS saldo 0: ofrece renovación con link de pago", async () => {
  const supa = crearMockDb({
    clientes: [{ id: CLIENTE_ID, commerce_booking_v1_activo: true }],
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Catalina López" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases Mensual", precio_clp: 45000, creditos_totales: 8, vigencia_dias: 30 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "agotada",
        creditos_saldo: 0,
        es_ilimitada: false,
      },
    ],
    configuracion: [
      {
        cliente_id: CLIENTE_ID,
        flow_api_key: "flow-key",
        flow_secret_key: "flow-secret",
        flow_activo: true,
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    texto: "¿cuántas clases me quedan?",
    supa,
  });

  assert.equal(res.accion, "CONSULTAR_CREDITOS");
  assert.ok(res.respuestaTexto.includes("no te quedan créditos disponibles"));
  assert.equal(res.datosExtra?.saldo, 0);
});

test("P4 - RESERVAR_CLASE con crédito: descuenta saldo y confirma en WhatsApp", async () => {
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Diego Silva" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases", precio_clp: 45000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 4,
        es_ilimitada: false,
      },
    ],
    servicios: [{ id: "svc-pilates", cliente_id: CLIENTE_ID, nombre: "Pilates Reformer" }],
    clases: [
      {
        id: "clase-101",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        inicio: "2026-09-22T19:00:00Z",
        fin: "2026-09-22T20:00:00Z",
        cupo_maximo: 8,
        cupo_ocupado: 3,
        estado: "activa",
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    claseId: "clase-101",
    texto: "Reserva la de las 19:00",
    nombreContacto: "Diego Silva",
    supa,
  });

  assert.equal(res.accion, "RESERVAR_CLASE");
  assert.equal(res.ejecutado, true);
  assert.ok(res.respuestaTexto.includes("Inscripción confirmada"));
  assert.ok(res.respuestaTexto.includes("3 créditos"));
  assert.equal(res.datosExtra?.saldoRestante, 3);
});

test("P4 - RESERVAR_CLASE sin créditos: rechaza y ofrece renovación", async () => {
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Diego Silva" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases", precio_clp: 45000, creditos_totales: 8, vigencia_dias: 30 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 0,
        es_ilimitada: false,
      },
    ],
    servicios: [{ id: "svc-pilates", cliente_id: CLIENTE_ID, nombre: "Pilates Reformer" }],
    clases: [
      {
        id: "clase-101",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        inicio: "2026-09-22T19:00:00Z",
        fin: "2026-09-22T20:00:00Z",
        cupo_maximo: 8,
        cupo_ocupado: 3,
        estado: "activa",
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    claseId: "clase-101",
    texto: "Reserva la de las 19:00",
    nombreContacto: "Diego Silva",
    supa,
  });

  assert.equal(res.accion, "RESERVAR_CLASE");
  assert.equal(res.ejecutado, false);
  assert.ok(res.respuestaTexto.includes("No tienes créditos vigentes disponibles"));
  assert.equal(res.datosExtra?.motivo, "sin_creditos");
});

test("P4 - CANCELAR_RESERVA a tiempo (>2h): devuelve crédito (+1)", async () => {
  const inicioClase = new Date(Date.now() + 5 * 3600 * 1000).toISOString(); // en 5 horas
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Ana Morales" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases", precio_clp: 45000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 3,
        es_ilimitada: false,
      },
    ],
    servicios: [{ id: "svc-pilates", cliente_id: CLIENTE_ID, nombre: "Pilates Reformer" }],
    clases: [
      {
        id: "clase-101",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        inicio: inicioClase,
        fin: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        cupo_maximo: 8,
        cupo_ocupado: 4,
        estado: "activa",
      },
    ],
    citas: [
      {
        id: "cita-clase-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        clase_id: "clase-101",
        chat_id: CHAT_ID,
        inicio: inicioClase,
        fin: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        estado: "confirmada",
        servicio_id: "svc-pilates",
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    texto: "No podré ir a la clase",
    supa,
  });

  assert.equal(res.accion, "CANCELAR_RESERVA");
  assert.equal(res.ejecutado, true);
  assert.ok(res.respuestaTexto.includes("cancelada con éxito"));
  assert.ok(res.respuestaTexto.includes("crédito fue devuelto"));
  assert.equal(res.datosExtra?.devuelto, true);
  assert.equal(res.datosExtra?.saldo, 4);
});

test("P4 - CANCELAR_RESERVA tardía (<2h): libera cupo pero NO devuelve crédito", async () => {
  const inicioClase = new Date(Date.now() + 1 * 3600 * 1000).toISOString(); // en 1 hora
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Ana Morales" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases", precio_clp: 45000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 3,
        es_ilimitada: false,
      },
    ],
    servicios: [{ id: "svc-pilates", cliente_id: CLIENTE_ID, nombre: "Pilates Reformer" }],
    clases: [
      {
        id: "clase-101",
        cliente_id: CLIENTE_ID,
        servicio_id: "svc-pilates",
        inicio: inicioClase,
        fin: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        cupo_maximo: 8,
        cupo_ocupado: 4,
        estado: "activa",
      },
    ],
    citas: [
      {
        id: "cita-clase-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        clase_id: "clase-101",
        chat_id: CHAT_ID,
        inicio: inicioClase,
        fin: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        estado: "confirmada",
        servicio_id: "svc-pilates",
      },
    ],
  });

  const res = await ejecutarAccionCommerce({
    clienteId: CLIENTE_ID,
    chatId: CHAT_ID,
    texto: "cancela mi reserva de hoy",
    supa,
  });

  assert.equal(res.accion, "CANCELAR_RESERVA");
  assert.equal(res.ejecutado, true);
  assert.ok(res.respuestaTexto.includes("cancelada"));
  assert.ok(res.respuestaTexto.includes("no permiten reembolsar el crédito"));
  assert.equal(res.datosExtra?.devuelto, false);
  assert.equal(res.datosExtra?.saldo, 3);
});

test("P4 - Fast path procesarCommerceWhatsAppRapido respeta feature flag", async () => {
  // Tenant con feature flag desactivado
  const supaInactivo = crearMockDb({
    clientes: [{ id: CLIENTE_ID, commerce_booking_v1_activo: false }],
  });

  const rInactivo = await procesarCommerceWhatsAppRapido({
    clienteId: CLIENTE_ID,
    empleadoId: "emp-1",
    chatId: CHAT_ID,
    textoEntrante: "¿Cuántas clases me quedan?",
    supa: supaInactivo,
  });

  assert.equal(rInactivo, null, "Debe ser null para no interferir con negocios sin Commerce");

  // Tenant con feature flag activado
  const supaActivo = crearMockDb({
    clientes: [{ id: CLIENTE_ID, commerce_booking_v1_activo: true }],
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Socio Activo" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan 8 Clases", precio_clp: 45000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 6,
        es_ilimitada: false,
      },
    ],
  });

  const rActivo = await procesarCommerceWhatsAppRapido({
    clienteId: CLIENTE_ID,
    empleadoId: "emp-1",
    chatId: CHAT_ID,
    textoEntrante: "¿Cuántas clases me quedan?",
    supa: supaActivo,
  });

  assert.ok(rActivo !== null);
  assert.ok(rActivo.includes("6 clases disponibles"));
});

test("P4 - construirBloqueCommercePrompt genera prompt estructurado e inquebrantable", async () => {
  const supa = crearMockDb({
    contactos: [{ id: CONTACTO_ID, cliente_id: CLIENTE_ID, chat_id: CHAT_ID, nombre: "Pedro Pascal" }],
    planes: [{ id: "plan-8", cliente_id: CLIENTE_ID, nombre: "Plan Full Pilates", precio_clp: 50000 }],
    membresias: [
      {
        id: "mem-1",
        cliente_id: CLIENTE_ID,
        contacto_id: CONTACTO_ID,
        plan_id: "plan-8",
        inicio: "2026-09-01T00:00:00Z",
        fin: "2026-10-01T23:59:59Z",
        estado: "activa",
        creditos_saldo: 7,
        es_ilimitada: false,
      },
    ],
  });

  const bloque = await construirBloqueCommercePrompt(CLIENTE_ID, CHAT_ID, supa);
  assert.ok(bloque !== null);
  assert.ok(bloque.includes("Plan Full Pilates"));
  assert.ok(bloque.includes("7 clases"));
  assert.ok(bloque.includes("REGLA ESTRICTA: NUNCA inventes créditos"));
});
