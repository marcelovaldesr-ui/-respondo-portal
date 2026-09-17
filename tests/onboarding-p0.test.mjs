import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  validarInsumosOnboarding,
  generarSlug,
  normalizarEscalacion,
  prepararFichaEmpleados,
  aprovisionarCliente,
  formatearReadinessTexto,
} from "../lib/onboarding.ts";
import { resolverCanalPrompt } from "../lib/promptEmpleado.ts";
import {
  hostDeMediaPermitido,
  crearStreamConLimiteBytes,
  descargarMediaSegura,
  LIMITE_BYTES_MEDIA,
} from "../lib/mediaSegura.ts";

// ── TEST 1: MIGRACIÓN 313 NO ALTERA REGISTROS LEGACY ─────────────────────────
test("1. Migración 313: solo altera default a 'cloud' sin migrar clientes WAHA existentes", () => {
  const sqlPath = path.resolve("sql/313_transporte_cloud_default.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  assert.ok(
    sql.includes("alter table ed_clientes alter column transporte set default 'cloud';"),
    "Debe alterar el DEFAULT de transporte a cloud",
  );
  // Verificar que NO haga update masivo sobre WAHA
  assert.ok(
    !sql.includes("update ed_clientes set transporte = 'cloud' where transporte = 'waha'"),
    "No debe modificar clientes con transporte 'waha'",
  );
  assert.ok(
    !sql.includes("update ed_clientes set transporte = 'cloud';"),
    "No debe forzar update incondicional",
  );
});

// ── TEST 2: MIGRACIÓN 314 ATOMICIDAD CONCEPTUAL ──────────────────────────────
test("2. Migración 314: función PostgreSQL atómica en una sola transacción", () => {
  const sqlPath = path.resolve("sql/314_fn_onboarding_cliente.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  assert.ok(
    sql.includes("create or replace function public.ed_aprovisionar_cliente(p_datos jsonb)"),
    "Debe definir la función ed_aprovisionar_cliente(p_datos jsonb)",
  );
  assert.ok(
    sql.includes("insert into public.ed_clientes"),
    "Debe insertar en ed_clientes",
  );
  assert.ok(
    sql.includes("insert into public.portal_usuarios"),
    "Debe insertar en portal_usuarios",
  );
  assert.ok(
    sql.includes("insert into public.ed_empleados"),
    "Debe insertar en ed_empleados",
  );
});

// ── TEST 3: SERVICE_ROLE GRANTS Y SEGURIDAD INVOKER (MIGRACIÓN 314) ──────────
test("3. Migración 314: service_role grants mínimos (DML y execute) y aislamiento estricto", () => {
  const sqlPath = path.resolve("sql/314_fn_onboarding_cliente.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  // A. Seguridad Invoker y search_path
  assert.ok(
    sql.includes("security invoker"),
    "Debe ser SECURITY INVOKER para ejecutar con permisos del llamador",
  );
  assert.ok(
    sql.includes("set search_path = public, pg_temp"),
    "Debe fijar search_path estricto",
  );

  // B. Privilegios DML mínimos para service_role
  assert.ok(
    sql.includes("grant select, insert on table public.ed_clientes to service_role;"),
    "Debe conceder SELECT, INSERT en ed_clientes a service_role",
  );
  assert.ok(
    sql.includes("grant select, insert on table public.portal_usuarios to service_role;"),
    "Debe conceder SELECT, INSERT en portal_usuarios a service_role",
  );
  assert.ok(
    sql.includes("grant insert on table public.ed_empleados to service_role;"),
    "Debe conceder INSERT en ed_empleados a service_role",
  );

  // C. Revocar ejecución de roles públicos y anónimos
  assert.ok(
    sql.includes("revoke all on function public.ed_aprovisionar_cliente(jsonb) from public;"),
    "Debe revocar ejecución a PUBLIC",
  );
  assert.ok(
    sql.includes("revoke all on function public.ed_aprovisionar_cliente(jsonb) from anon;"),
    "Debe revocar ejecución a anon",
  );
  assert.ok(
    sql.includes("revoke all on function public.ed_aprovisionar_cliente(jsonb) from authenticated;"),
    "Debe revocar ejecución a authenticated",
  );

  // D. Concesión exclusiva de ejecución a service_role
  assert.ok(
    sql.includes("grant execute on function public.ed_aprovisionar_cliente(jsonb) to service_role;"),
    "Debe otorgar execute exclusivamente a service_role",
  );

  // E. Verificar que NO se conceda acceso a anon ni authenticated
  assert.ok(
    !sql.includes("grant execute on function public.ed_aprovisionar_cliente(jsonb) to anon"),
    "No debe conceder ejecución a anon",
  );
  assert.ok(
    !sql.includes("grant execute on function public.ed_aprovisionar_cliente(jsonb) to authenticated"),
    "No debe conceder ejecución a authenticated",
  );
});

// ── TEST 4: PLAN AUSENTE Y VALIDACIÓN DE PLANES REALES ────────────────────────
test("4. Plan ausente y validación: rechaza plan ausente (PLAN_REQUERIDO) y planes ficticios", async () => {
  const base = {
    nombre: "Empresa Real",
    rubro: "servicios",
    emailDueno: "owner@empresa.cl",
    telefonoEscalacion: "+56912345678",
  };

  // A. Plan ausente en TypeScript (validarInsumosOnboarding)
  const valSinPlan = validarInsumosOnboarding({ ...base });
  assert.equal(valSinPlan.ok, false);
  if (!valSinPlan.ok) {
    assert.equal(valSinPlan.codigo, "PLAN_REQUERIDO");
    assert.match(valSinPlan.error, /plan es requerido explícitamente/i);
  }

  // B. Plan ausente en SQL 314
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(
    sql314.includes("raise exception 'PLAN_REQUERIDO:"),
    "sql/314 debe lanzar PLAN_REQUERIDO si plan es omitido o vacío",
  );

  // C. Plan ausente manejado por aprovisionarCliente RPC
  const mockSupaPlanReq = {
    rpc: async () => ({
      data: null,
      error: { message: "PLAN_REQUERIDO: Debe especificar un plan comercial explícito." },
    }),
  };
  const resPlanReq = await aprovisionarCliente({ ...base, plan: undefined }, mockSupaPlanReq);
  assert.equal(resPlanReq.ok, false);
  if (!resPlanReq.ok) {
    assert.equal(resPlanReq.codigo, "PLAN_REQUERIDO");
  }

  // D. Planes válidos admitidos
  for (const plan of ["tino_solo", "inicial", "crecimiento", "empresa", "a_medida"]) {
    const val = validarInsumosOnboarding({ ...base, plan });
    assert.equal(val.ok, true, `Plan ${plan} debe ser aceptado`);
    if (val.ok) {
      assert.equal(val.normalizado.plan, plan);
    }
  }

  // E. Planes ficticios rechazados (starter, pro)
  const valStarter = validarInsumosOnboarding({ ...base, plan: "starter" });
  assert.equal(valStarter.ok, false);
  if (!valStarter.ok) assert.equal(valStarter.codigo, "PLAN_INVALIDO");

  const valPro = validarInsumosOnboarding({ ...base, plan: "pro" });
  assert.equal(valPro.ok, false);
  if (!valPro.ok) assert.equal(valPro.codigo, "PLAN_INVALIDO");
});

// ── TEST 5: AGENDA SIN TABLA INEXISTENTE ED_CITAS_CONFIG ─────────────────────
test("5. Agenda real: ed_citas_config NO existe en código ni en migración 314", () => {
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(
    !sql314.includes("insert into public.ed_citas_config"),
    "sql/314 no debe insertar en la tabla ficticia ed_citas_config",
  );
  assert.ok(
    !sql314.includes("create table if not exists public.ed_citas_config"),
    "sql/314 no debe crear la tabla ficticia ed_citas_config",
  );

  const onboardingTs = fs.readFileSync(path.resolve("lib/onboarding.ts"), "utf-8");
  assert.ok(
    !onboardingTs.includes("ed_citas_config"),
    "lib/onboarding.ts no debe referenciar ed_citas_config",
  );

  // Valida que la agenda active reservas_online en ed_clientes
  const val = validarInsumosOnboarding({
    nombre: "Clínica Dental",
    emailDueno: "admin@dental.cl",
    telefonoEscalacion: "+56912345678",
    plan: "inicial",
    conAgenda: true,
  });
  assert.equal(val.ok, true);
  if (val.ok) {
    assert.equal(val.normalizado.conAgenda, true);
  }
});

// ── TEST 6: IDEMPOTENCIA - MISMO PAYLOAD COMPLETO (0 WRITES) ──────────────────
test("6. Idempotencia: mismo payload completo retorna tenant existente sin escrituras", async () => {
  let rpcLlamado = false;
  let datosEnviados = null;

  const mockSupa = {
    rpc: async (name, { p_datos }) => {
      rpcLlamado = true;
      datosEnviados = p_datos;
      assert.equal(name, "ed_aprovisionar_cliente");
      return {
        data: {
          ok: true,
          idempotente: true,
          status: "EXISTENTE_NO_MODIFICADO",
          cliente_id: "00000000-0000-0000-0000-000000000001",
          nombre: p_datos.nombre,
          slug: p_datos.slug,
          email_dueno: p_datos.email_dueno,
          transporte: p_datos.transporte,
          moneda: p_datos.moneda,
          plan: p_datos.plan,
          cupo_conversaciones: p_datos.cupo_conversaciones,
          agenda_activa: p_datos.con_agenda,
          staff_count: p_datos.email_staff.length,
        },
        error: null,
      };
    },
  };

  const payloadCompleto = {
    nombre: "Clínica Dental San Lucas",
    rubro: "odontologia",
    emailDueno: "admin@sanlucas.cl",
    emailStaff: ["recepcion@sanlucas.cl", "doctor@sanlucas.cl"],
    telefonoEscalacion: "+56912345678",
    slug: "clinica-san-lucas",
    moneda: "CLP",
    plan: "crecimiento",
    cupoConversaciones: 3000,
    conAgenda: true,
    transporte: "cloud",
    pagoLinkBase: "https://webpay.cl/sanlucas",
    pagoRefEtiqueta: "RUT Paciente",
    clienteId: "00000000-0000-0000-0000-000000000001",
  };

  const res = await aprovisionarCliente(payloadCompleto, mockSupa);

  assert.equal(rpcLlamado, true);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.idempotente, true);
    assert.equal(res.status, "EXISTENTE_NO_MODIFICADO");
    assert.equal(res.clienteId, "00000000-0000-0000-0000-000000000001");
    assert.equal(res.plan, "crecimiento");
    assert.equal(res.moneda, "CLP");
    assert.equal(res.agendaActiva, true);
    assert.equal(res.staffCount, 2);
  }

  // Verificar que el payload hacia la base de datos conservó todos los campos
  assert.equal(datosEnviados.plan, "crecimiento");
  assert.equal(datosEnviados.moneda, "CLP");
  assert.equal(datosEnviados.con_agenda, true);
  assert.equal(datosEnviados.pago_link_base, "https://webpay.cl/sanlucas");
  assert.equal(datosEnviados.pago_ref_etiqueta, "RUT Paciente");
  assert.deepEqual(datosEnviados.email_staff, ["recepcion@sanlucas.cl", "doctor@sanlucas.cl"]);
});

// ── TEST 7A: IDEMPOTENCIA - MISMO SLUG + PLAN DISTINTO ────────────────────────
test("7a. Idempotencia: mismo slug + plan distinto lanza CONFLICTO_IDEMPOTENCIA", async () => {
  const mockSupaDiffPlan = {
    rpc: async () => ({
      data: null,
      error: { message: "CONFLICTO_IDEMPOTENCIA: El slug 'clinica-san-lucas' ya existe pero con datos distintos a los solicitados." },
    }),
  };

  const res = await aprovisionarCliente(
    {
      nombre: "Clínica Dental San Lucas",
      emailDueno: "admin@sanlucas.cl",
      telefonoEscalacion: "+56912345678",
      slug: "clinica-san-lucas",
      plan: "empresa", // existente era "inicial" o "crecimiento"
    },
    mockSupaDiffPlan,
  );

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.codigo, "CONFLICTO_IDEMPOTENCIA");
    assert.match(res.error, /CONFLICTO_IDEMPOTENCIA/);
  }

  // Verificar en SQL 314 que la comparación incluya el plan
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(sql314.includes("and v_existing_plan = v_plan"), "sql/314 debe comparar v_existing_plan = v_plan");
});

// ── TEST 7B: IDEMPOTENCIA - MISMO SLUG + MONEDA DISTINTA ──────────────────────
test("7b. Idempotencia: mismo slug + moneda distinta lanza CONFLICTO_IDEMPOTENCIA", async () => {
  const mockSupaDiffMoneda = {
    rpc: async () => ({
      data: null,
      error: { message: "CONFLICTO_IDEMPOTENCIA: El slug 'clinica-san-lucas' ya existe pero con datos distintos a los solicitados." },
    }),
  };

  const res = await aprovisionarCliente(
    {
      nombre: "Clínica Dental San Lucas",
      emailDueno: "admin@sanlucas.cl",
      telefonoEscalacion: "+56912345678",
      slug: "clinica-san-lucas",
      plan: "inicial",
      moneda: "USD", // existente era "CLP"
    },
    mockSupaDiffMoneda,
  );

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.codigo, "CONFLICTO_IDEMPOTENCIA");
    assert.match(res.error, /CONFLICTO_IDEMPOTENCIA/);
  }

  // Verificar en SQL 314 que la comparación incluya la moneda
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(sql314.includes("and v_existing_moneda = v_moneda"), "sql/314 debe comparar v_existing_moneda = v_moneda");
});

// ── TEST 7C: IDEMPOTENCIA - MISMO SLUG + AGENDA DISTINTA ──────────────────────
test("7c. Idempotencia: mismo slug + agenda distinta lanza CONFLICTO_IDEMPOTENCIA", async () => {
  const mockSupaDiffAgenda = {
    rpc: async () => ({
      data: null,
      error: { message: "CONFLICTO_IDEMPOTENCIA: El slug 'clinica-san-lucas' ya existe pero con datos distintos a los solicitados." },
    }),
  };

  const res = await aprovisionarCliente(
    {
      nombre: "Clínica Dental San Lucas",
      emailDueno: "admin@sanlucas.cl",
      telefonoEscalacion: "+56912345678",
      slug: "clinica-san-lucas",
      plan: "inicial",
      conAgenda: true, // existente era conAgenda: false
    },
    mockSupaDiffAgenda,
  );

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.codigo, "CONFLICTO_IDEMPOTENCIA");
    assert.match(res.error, /CONFLICTO_IDEMPOTENCIA/);
  }

  // Verificar en SQL 314 que la comparación incluya la agenda (reservas_online)
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(sql314.includes("and v_existing_con_agenda = v_con_agenda"), "sql/314 debe comparar v_existing_con_agenda = v_con_agenda");
});

// ── TEST 7D: IDEMPOTENCIA - MISMO SLUG + STAFF DISTINTO ───────────────────────
test("7d. Idempotencia: mismo slug + staff distinto lanza CONFLICTO_IDEMPOTENCIA", async () => {
  const mockSupaDiffStaff = {
    rpc: async () => ({
      data: null,
      error: { message: "CONFLICTO_IDEMPOTENCIA: El slug 'clinica-san-lucas' ya existe pero con datos distintos a los solicitados." },
    }),
  };

  const res = await aprovisionarCliente(
    {
      nombre: "Clínica Dental San Lucas",
      emailDueno: "admin@sanlucas.cl",
      telefonoEscalacion: "+56912345678",
      slug: "clinica-san-lucas",
      plan: "inicial",
      emailStaff: ["nuevo_staff@sanlucas.cl"], // existente era "recepcion@sanlucas.cl"
    },
    mockSupaDiffStaff,
  );

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.codigo, "CONFLICTO_IDEMPOTENCIA");
    assert.match(res.error, /CONFLICTO_IDEMPOTENCIA/);
  }

  // Verificar en SQL 314 que la comparación ordene y compare listas completas de staff
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(
    sql314.includes("v_existing_staff_emails = v_sorted_request_staff"),
    "sql/314 debe comparar arrays de staff canónicamente ordenados",
  );
  assert.ok(
    sql314.includes("array_agg(email order by email)"),
    "sql/314 debe ordenar los emails de staff existentes",
  );
  assert.ok(
    sql314.includes("array_agg(s order by s)"),
    "sql/314 debe ordenar los emails de staff solicitados",
  );
});

// ── TEST 7E: MANEJO DE CARRERAS CONCURRENTES / UNIQUE VIOLATION ───────────────
test("7e. Carreras concurrentes: mapeo de unique_violation a CONFLICTO_CARRERA", async () => {
  // A. Carrera por slug duplicado simultáneo
  const mockSupaRaceSlug = {
    rpc: async () => ({
      data: null,
      error: {
        message: 'CONFLICTO_CARRERA_SLUG: Conflicto de concurrencia: el slug "san-lucas" fue registrado por otra transacción simultánea.',
      },
    }),
  };

  const resSlug = await aprovisionarCliente(
    {
      nombre: "San Lucas Carrera",
      emailDueno: "race@sanlucas.cl",
      telefonoEscalacion: "+56912345678",
      plan: "inicial",
      slug: "san-lucas",
    },
    mockSupaRaceSlug,
  );

  assert.equal(resSlug.ok, false);
  if (!resSlug.ok) {
    assert.equal(resSlug.codigo, "CONFLICTO_CARRERA");
    assert.match(resSlug.error, /CONFLICTO_CARRERA_SLUG/);
  }

  // B. Carrera por email de dueño duplicado simultáneo
  const mockSupaRaceEmail = {
    rpc: async () => ({
      data: null,
      error: {
        message: 'CONFLICTO_CARRERA_EMAIL: Conflicto de concurrencia: el email "dueno@test.cl" fue registrado por otra transacción simultánea.',
      },
    }),
  };

  const resEmail = await aprovisionarCliente(
    {
      nombre: "Test Carrera Email",
      emailDueno: "dueno@test.cl",
      telefonoEscalacion: "+56912345678",
      plan: "inicial",
    },
    mockSupaRaceEmail,
  );

  assert.equal(resEmail.ok, false);
  if (!resEmail.ok) {
    assert.equal(resEmail.codigo, "CONFLICTO_CARRERA");
    assert.match(resEmail.error, /CONFLICTO_CARRERA_EMAIL/);
  }

  // C. Carrera por otra constraint unique genérica
  const mockSupaRaceUnique = {
    rpc: async () => ({
      data: null,
      error: {
        message: "CONFLICTO_CARRERA_UNIQUE: Violación de unicidad concurrente [ed_clientes_pkey]: Key (id)=(...) already exists.",
      },
    }),
  };

  const resUnique = await aprovisionarCliente(
    {
      nombre: "Test Carrera Unique",
      emailDueno: "unique@test.cl",
      telefonoEscalacion: "+56912345678",
      plan: "inicial",
    },
    mockSupaRaceUnique,
  );

  assert.equal(resUnique.ok, false);
  if (!resUnique.ok) {
    assert.equal(resUnique.codigo, "CONFLICTO_CARRERA");
    assert.match(resUnique.error, /CONFLICTO_CARRERA_UNIQUE/);
  }

  // D. Verificación de bloque EXCEPTION en SQL 314
  const sql314 = fs.readFileSync(path.resolve("sql/314_fn_onboarding_cliente.sql"), "utf-8");
  assert.ok(sql314.includes("when unique_violation then"), "sql/314 debe capturar when unique_violation");
  assert.ok(sql314.includes("get stacked diagnostics"), "sql/314 debe extraer diagnóstico de error");
  assert.ok(sql314.includes("CONFLICTO_CARRERA_SLUG"), "sql/314 debe mapear CONFLICTO_CARRERA_SLUG");
  assert.ok(sql314.includes("CONFLICTO_CARRERA_EMAIL"), "sql/314 debe mapear CONFLICTO_CARRERA_EMAIL");
});

// ── TEST 8: ENCAPSULAMIENTO COMERCIAL BETO -> ROL INTERNO RITA ──────────────
test("8. Encapsulamiento Beto -> rita: el rol en DB es 'rita', el nombre público es 'Beto'", () => {
  const empleados = prepararFichaEmpleados();
  const beto = empleados.find((e) => e.nombrePublico === "Beto");
  assert.ok(beto, "Debe existir la ficha de Beto");
  assert.equal(beto.rol, "rita", "El rol interno de Beto en la base de datos debe ser 'rita'");
  assert.equal(beto.nombrePublico, "Beto");

  const tino = empleados.find((e) => e.nombrePublico === "Tino");
  assert.equal(tino.rol, "tino");

  const vera = empleados.find((e) => e.nombrePublico === "Vera");
  assert.equal(vera.rol, "vera");
});

// ── TEST 9: VALIDACIÓN Y DEDUPLICACIÓN DE STAFF ──────────────────────────────
test("9. Staff: valida emails, previene duplicados y rechaza colisión con el dueño", () => {
  const base = {
    nombre: "Test Staff",
    emailDueno: "dueno@test.cl",
    telefonoEscalacion: "+56912345678",
    plan: "inicial",
  };

  // Staff duplicado con dueño
  const valColision = validarInsumosOnboarding({
    ...base,
    emailStaff: ["dueno@test.cl"],
  });
  assert.equal(valColision.ok, false);
  if (!valColision.ok) assert.equal(valColision.codigo, "STAFF_DUPLICADO");

  // Staff duplicado entre sí
  const valDuplicado = validarInsumosOnboarding({
    ...base,
    emailStaff: ["staff@test.cl", "STAFF@test.cl"],
  });
  assert.equal(valDuplicado.ok, false);
  if (!valDuplicado.ok) assert.equal(valDuplicado.codigo, "STAFF_DUPLICADO");

  // Staff válido múltiple
  const valOk = validarInsumosOnboarding({
    ...base,
    emailStaff: ["recepcion@test.cl", "ventas@test.cl"],
  });
  assert.equal(valOk.ok, true);
  if (valOk.ok) {
    assert.deepEqual(valOk.normalizado.emailStaff, ["recepcion@test.cl", "ventas@test.cl"]);
  }
});

// ── TEST 10: NORMALIZACIÓN DE TELÉFONOS DE ESCALACIÓN ────────────────────────
test("10. Teléfonos: normaliza texto y arrays, exigiendo al menos 8 dígitos", () => {
  assert.deepEqual(normalizarEscalacion("+56 9 1234 5678"), ["+56 9 1234 5678"]);
  assert.deepEqual(
    normalizarEscalacion(["+56 9 1111 2222", "987654321"]),
    ["+56 9 1111 2222", "987654321"],
  );
  // Teléfono corto inválido (< 8 dígitos)
  assert.deepEqual(normalizarEscalacion("12345"), []);

  const valInvalido = validarInsumosOnboarding({
    nombre: "Test",
    emailDueno: "test@test.cl",
    telefonoEscalacion: "123",
    plan: "inicial",
  });
  assert.equal(valInvalido.ok, false);
  if (!valInvalido.ok) assert.equal(valInvalido.codigo, "TELEFONO_INVALIDO");
});

// ── TEST 11: MONEDA ISO-4217 (3 LETRAS MAYÚSCULAS) ───────────────────────────
test("11. Moneda: valida formato ISO-4217 de 3 letras mayúsculas", () => {
  const base = {
    nombre: "Test Moneda",
    emailDueno: "test@moneda.cl",
    telefonoEscalacion: "+56912345678",
    plan: "inicial",
  };

  assert.equal(validarInsumosOnboarding({ ...base, moneda: "CLP" }).ok, true);
  assert.equal(validarInsumosOnboarding({ ...base, moneda: "usd" }).ok, true); // normaliza a USD
  assert.equal(validarInsumosOnboarding({ ...base, moneda: "PESOS" }).ok, false);
  assert.equal(validarInsumosOnboarding({ ...base, moneda: "12" }).ok, false);
});

// ── TEST 12: FALLO CERRADO SIN MIGRACIÓN 314 (CERO ESCRITURAS) ───────────────
test("12. Fallo cerrado: si falta la migración 314, rechaza con MIGRACION_NO_APLICADA sin escrituras parciales", async () => {
  const mockSupaNoMigration = {
    rpc: async () => ({
      data: null,
      error: { code: "42883", message: "function public.ed_aprovisionar_cliente does not exist" },
    }),
  };

  const res = await aprovisionarCliente(
    {
      nombre: "Clínica Nueva",
      emailDueno: "admin@nueva.cl",
      telefonoEscalacion: "+56912345678",
      plan: "inicial",
    },
    mockSupaNoMigration,
  );

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.codigo, "MIGRACION_NO_APLICADA");
    assert.match(res.error, /Falta aplicar la migración de aprovisionamiento/);
  }
});

// ── TEST 13: READINESS AUDITA CORE VS MÓDULOS OPCIONALES ─────────────────────
test("13. Readiness: distingue CORE completo y no marca módulos opcionales no contratados como error crítico", () => {
  const mockReadiness = {
    clienteId: "11111111-1111-1111-1111-111111111111",
    nombre: "Taller Mecánico",
    slug: "taller-mecanico",
    plan: "inicial",
    core: {
      tenantRegistrado: true,
      activo: true,
      duenoConfigurado: true,
      emailDueno: "mecanico@taller.cl",
      staffRegistrados: 1,
      tinoActivo: true,
      betoActivo: true,
      veraActiva: true,
    },
    canales: {
      whatsapp: { conectado: true, transporte: "cloud", wabaId: "waba_123", coexistencia: false },
      instagram: { conectado: false, igUserId: null },
    },
    modulosOpcionales: {
      agenda: { contratada: false, rutaPublica: null, serviciosActivos: 0, profesionalesActivos: 0 },
      marketing: { conectado: false, datasetId: null },
      cobros: { linkConfigurado: false, linkBase: null, etiquetaRef: null },
    },
  };

  const texto = formatearReadinessTexto(mockReadiness);
  assert.match(texto, /CORE \(✓ COMPLETO\)/);
  assert.match(texto, /Agenda: ○ NO CONTRATADA/);
  assert.match(texto, /Marketing CAPI: ○ NO CONFIGURADO/);
  assert.match(texto, /Cobros Asistidos: ○ NO CONFIGURADO/);
});

// ── TEST 14: CANAL PROMPT EN TINO (MULTICANAL INSTAGRAM VS WHATSAPP) ──────────
test("14. Canal Prompt: Tino adapta su saludo y contexto a Instagram sin mencionar WhatsApp", () => {
  // 1. Canal Instagram
  const rIg = resolverCanalPrompt("instagram");
  assert.equal(rIg.nombre, "Instagram");
  assert.equal(rIg.mensajes, "Instagram Direct (máx. 1.000 caracteres)");

  // 2. Canal WhatsApp Cloud
  const rWa = resolverCanalPrompt("whatsapp");
  assert.equal(rWa.nombre, "WhatsApp");
  assert.equal(rWa.mensajes, "WhatsApp real");

  // 3. Canal WAHA Legacy
  const rWaha = resolverCanalPrompt("waha");
  assert.equal(rWaha.nombre, "WhatsApp");
  assert.equal(rWaha.mensajes, "WhatsApp real");

  // 4. Default sin canal
  const rDef = resolverCanalPrompt(undefined);
  assert.equal(rDef.nombre, "WhatsApp");
  assert.equal(rDef.mensajes, "WhatsApp real");
});

// ── TEST 15: MEDIA PROXY SSRF Y CONTROL DE REDIRECTS ─────────────────────────
test("15. Media Proxy SSRF: rechaza dominios no autorizados y redirecciones a hosts prohibidos", async () => {
  // Hosts directos
  assert.equal(hostDeMediaPermitido("https://lookaside.fbsbx.com/ig_messaging_cdn/?asid=123"), true);
  assert.equal(hostDeMediaPermitido("https://scontent.cdninstagram.com/photo.jpg"), true);
  assert.equal(hostDeMediaPermitido("https://scontent-scl2-1.fbcdn.net/image.png"), true);
  assert.equal(hostDeMediaPermitido("https://graph.facebook.com/v21.0/123"), true);

  // Hosts prohibidos
  assert.equal(hostDeMediaPermitido("http://lookaside.fbsbx.com/insecure"), false);
  assert.equal(hostDeMediaPermitido("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(hostDeMediaPermitido("https://localhost:3000/admin"), false);
  assert.equal(hostDeMediaPermitido("https://malicious-site.com/fake.jpg"), false);

  // Simulación de redirect prohibido (SSRF)
  const mockFetchForbiddenRedirect = async (url) => {
    if (url === "https://lookaside.fbsbx.com/start") {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://169.254.169.254/latest/meta-data" },
      });
    }
    return new Response("ok", { status: 200 });
  };

  const resForbidden = await descargarMediaSegura("https://lookaside.fbsbx.com/start", {
    fetchImpl: mockFetchForbiddenRedirect,
  });
  assert.equal(resForbidden.ok, false);
  if (!resForbidden.ok) {
    assert.equal(resForbidden.status, 400);
    assert.match(resForbidden.error, /Redirección a host no permitido/);
  }

  // Simulación de redirect permitido (Meta a CDN)
  const mockFetchAllowedRedirect = async (url) => {
    if (url === "https://lookaside.fbsbx.com/start") {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://scontent.cdninstagram.com/photo.jpg" },
      });
    }
    return new Response("imagen_binaria", {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  };

  const resAllowed = await descargarMediaSegura("https://lookaside.fbsbx.com/start", {
    fetchImpl: mockFetchAllowedRedirect,
  });
  assert.equal(resAllowed.ok, true);

  // Simulación de bucle de redirects (> MAX_REDIRECTS_MEDIA)
  const mockFetchLoop = async () => {
    return new Response(null, {
      status: 302,
      headers: { Location: "https://lookaside.fbsbx.com/start" },
    });
  };

  const resLoop = await descargarMediaSegura("https://lookaside.fbsbx.com/start", {
    fetchImpl: mockFetchLoop,
  });
  assert.equal(resLoop.ok, false);
  if (!resLoop.ok) {
    assert.equal(resLoop.status, 508);
    assert.match(resLoop.error, /Demasiadas redirecciones/);
  }
});

// ── TEST 16: LÍMITE DE TAMAÑO DE MEDIA (25 MB REAL Y STREAM CHUNKED) ──────────
test("16. Media Size: límite de 25 MB real (Content-Length y streaming chunked)", async () => {
  // A. Content-Length excesivo (> 25MB)
  const mockFetchTooLarge = async () => {
    return new Response("demasiado grande", {
      status: 200,
      headers: {
        "Content-Length": String(LIMITE_BYTES_MEDIA + 1024),
        "Content-Type": "image/jpeg",
      },
    });
  };

  const resTooLarge = await descargarMediaSegura("https://lookaside.fbsbx.com/large", {
    fetchImpl: mockFetchTooLarge,
  });
  assert.equal(resTooLarge.ok, false);
  if (!resTooLarge.ok) {
    assert.equal(resTooLarge.status, 413);
    assert.match(resTooLarge.error, /Archivo demasiado grande/);
  }

  // B. Stream chunked sin Content-Length que supera el límite de bytes
  const chunk1MB = new Uint8Array(1024 * 1024); // 1 MB
  const streamChunked = new ReadableStream({
    start(controller) {
      // Emitir 26 chunks de 1 MB cada uno (> 25 MB)
      for (let i = 0; i < 26; i++) {
        controller.enqueue(chunk1MB);
      }
      controller.close();
    },
  });

  const streamLimitado = crearStreamConLimiteBytes(streamChunked, LIMITE_BYTES_MEDIA);
  const reader = streamLimitado.getReader();

  let bytesLeidos = 0;
  let errorAtrapado = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesLeidos += value.byteLength;
    }
  } catch (err) {
    errorAtrapado = true;
    assert.equal(err.message, "EXCESO_LIMITE_BYTES");
  }

  assert.equal(errorAtrapado, true, "El transform stream debe abortar al exceder 25 MB");
  assert.ok(bytesLeidos <= LIMITE_BYTES_MEDIA + 1024 * 1024, "No debe continuar acumulando bytes");

  // C. Stream válido <= 25 MB completa sin error
  const streamValido = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 100)); // 100 KB
      controller.close();
    },
  });

  const streamValidoLimitado = crearStreamConLimiteBytes(streamValido, LIMITE_BYTES_MEDIA);
  const readerValido = streamValidoLimitado.getReader();
  let leidos = 0;
  while (true) {
    const { done, value } = await readerValido.read();
    if (done) break;
    leidos += value.byteLength;
  }
  assert.equal(leidos, 1024 * 100);
});

// ── TEST 17: GENERACIÓN Y NORMALIZACIÓN DE SLUG ──────────────────────────────
test("17. GenerarSlug: remueve diacríticos, caracteres raros y recorta longitud", () => {
  assert.equal(generarSlug("Clínica Dental San Lucas"), "clinica-dental-san-lucas");
  assert.equal(generarSlug("  ¡Café & Panadería Ñuñoa!  "), "cafe-panaderia-nunoa");
  assert.equal(generarSlug("Taller Mecánico 24/7"), "taller-mecanico-24-7");
});
