/**
 * AGENDA — FASE 2: multiprofesional, «cualquiera», asignación determinista,
 * concurrencia real y comportamiento seguro cuando Google no responde.
 *
 * Todo corre sin red ni base: el núcleo es puro y la base en memoria emula el
 * EXCLUDE anti-solape de ed_citas (que es la única garantía de verdad contra
 * la doble reserva).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const { computarSlots, elegirProfesional, diaChileDe } = await import("../lib/agendaCore.ts");
const { disponibilidad, reservarCupo, reagendar } = await import("../lib/agenda.ts");
const { profesionalPedido } = await import("../lib/agendaBot.ts");
const { rangoDelMes, rangoDelDia } = await import("../lib/reservasPublicas.ts");

const AHORA = new Date("2026-09-14T12:00:00Z"); // lunes, 09:00 en Chile
const dia = (d) => [0, 1, 2, 3, 4, 5, 6].map((x) => ({ dia_semana: x, ...d }));

const EXCLUSION_CITAS = {
  exclusiones: {
    ed_citas: [
      {
        por: "profesional_id",
        desde: "inicio",
        hasta: "fin",
        donde: (f) => ["agendada", "confirmada", "reagendada"].includes(f.estado),
      },
    ],
  },
};

function base(extra = {}) {
  return crearBaseMemoria(
    {
      ed_clientes: [{ id: "c1", anticipacion_min_horas: 0, horizonte_dias: 30 }],
      ed_servicios: [
        { id: "s1", cliente_id: "c1", nombre: "Corte", duracion_min: 60, activo: true, buffer_min: 0, precio_clp: 12000 },
      ],
      ed_profesionales: [
        { id: "pa", cliente_id: "c1", nombre: "Marcela", activo: true, gcal_sync: false },
        { id: "pb", cliente_id: "c1", nombre: "Camila", activo: true, gcal_sync: false },
      ],
      ed_servicio_profesional: [
        { servicio_id: "s1", profesional_id: "pa" },
        { servicio_id: "s1", profesional_id: "pb" },
      ],
      ed_horarios: [
        ...dia({ profesional_id: "pa", desde: "10:00:00", hasta: "13:00:00" }),
        ...dia({ profesional_id: "pb", desde: "10:00:00", hasta: "12:00:00" }),
      ],
      ed_bloqueos: [],
      ed_citas: [],
      ed_seguimientos: [],
      ...extra,
    },
    EXCLUSION_CITAS,
  );
}

// ─── Núcleo ─────────────────────────────────────────────────────────────────

test("un cupo por HORA, no uno por profesional", () => {
  const slots = computarSlots({
    ahora: AHORA,
    dias: 1,
    duracionMin: 60,
    anticipacionMin: 0,
    ocupados: [],
    ventanas: [
      { profesionalId: "pa", diaSemana: 1, desde: "10:00", hasta: "12:00" },
      { profesionalId: "pb", diaSemana: 1, desde: "10:00", hasta: "12:00" },
      { profesionalId: "pc", diaSemana: 1, desde: "11:00", hasta: "12:00" },
    ],
  });
  assert.deepEqual(
    slots.map((s) => [s.inicio.slice(11, 16), s.profesionales]),
    [
      ["13:00", ["pa", "pb"]],
      ["14:00", ["pa", "pb", "pc"]],
    ],
    "dos horas, cada una una sola vez, con quiénes pueden tomarla",
  );
  assert.equal(slots[0].profesionalId, "pa", "compatibilidad: el primero sigue expuesto");
});

test("el rango lo pide quien llama: día, tope por día y «solo si hay algo»", () => {
  const ventanas = [{ profesionalId: "pa", diaSemana: 1, desde: "10:00", hasta: "18:00" }];
  const comun = { ahora: AHORA, duracionMin: 60, anticipacionMin: 0, ocupados: [], ventanas };

  const todo = computarSlots({ ...comun, dias: 8 });
  assert.equal(todo.length, 16, "dos lunes × 8 cupos");

  const topeado = computarSlots({ ...comun, dias: 8, maxPorDia: 3 });
  assert.equal(topeado.length, 6, "3 por día como mucho");

  const soloDias = computarSlots({ ...comun, dias: 8, soloPrimeroPorDia: true });
  assert.equal(soloDias.length, 2, "para pintar el calendario basta 1 por día");

  const otroDia = computarSlots({ ...comun, dias: 1, desdeDia: new Date("2026-09-21T12:00:00Z") });
  assert.equal(otroDia.length, 8);
  assert.ok(otroDia[0].inicio.startsWith("2026-09-21"), "se puede pedir un día futuro sin generar los previos");
});

test("asignación determinista: menos citas ese día, luego menos en total, luego orden estable", () => {
  const porDia = new Map([["pa", 3], ["pb", 1], ["pc", 1]]);
  const total = new Map([["pa", 3], ["pb", 9], ["pc", 4]]);
  assert.equal(elegirProfesional(["pa", "pb", "pc"], { porDia, total }), "pc");
  assert.equal(elegirProfesional(["pa", "pb"], { porDia: new Map(), total: new Map() }), "pa", "empate: orden estable");
  assert.equal(elegirProfesional(["pa", "pb"], { porDia, total }, "pa"), "pa", "quien pidió a alguien, lo recibe");
  assert.equal(elegirProfesional(["pa"], {}, "pz"), "pa", "un preferido que no está disponible no bloquea");
  assert.equal(elegirProfesional([], {}), null);
});

test("nombre del profesional pedido por WhatsApp → id real, sin inventar", () => {
  const gente = [{ id: "pa", nombre: "Marcela" }, { id: "pb", nombre: "Camila" }];
  assert.equal(profesionalPedido(gente, "camila"), "pb");
  assert.equal(profesionalPedido(gente, "Marcela Pérez"), "pa", "tolera que agregue el apellido");
  assert.equal(profesionalPedido(gente, "Rodrigo"), null);
  assert.equal(profesionalPedido(gente, ""), null);
});

test("rangos públicos: mes y día", () => {
  const ahora = new Date("2026-09-14T12:00:00Z");
  assert.equal(rangoDelMes("2026-10", ahora).dias, 31);
  assert.equal(rangoDelMes("2026-09", ahora).dias, 17, "el mes en curso parte hoy");
  assert.equal(rangoDelMes("2025-01", ahora), null, "un mes pasado no se calcula");
  assert.equal(rangoDelMes("basura", ahora), null);
  assert.equal(rangoDelDia("2026-09-18").dias, 1);
  assert.equal(rangoDelDia("18-09-2026"), null);
});

// ─── Disponibilidad con base ────────────────────────────────────────────────

test("«cualquiera»: horas únicas; con profesional elegido, solo las suyas", async () => {
  const supa = base();
  const todos = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1 });
  assert.equal(todos.ok, true);
  assert.deepEqual(todos.slots.map((s) => s.inicio.slice(11, 16)), ["13:00", "14:00", "15:00"]);
  assert.deepEqual(todos.slots[0].profesionales, ["pa", "pb"]);
  assert.deepEqual(todos.profesionales.map((p) => p.nombre).sort(), ["Camila", "Marcela"]);

  const soloCamila = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1, profesionalId: "pb" });
  assert.deepEqual(soloCamila.slots.map((s) => s.inicio.slice(11, 16)), ["13:00", "14:00"]);
  assert.ok(soloCamila.slots.every((s) => s.profesionales.length === 1));

  const ajeno = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1, profesionalId: "de-otro-negocio" });
  assert.deepEqual(ajeno, { ok: false, motivo: "profesional_invalido" });
});

test("una cita ocupa solo a su profesional, y la hora sigue ofreciéndose por el otro", async () => {
  const supa = base({
    ed_citas: [
      { id: "x1", cliente_id: "c1", profesional_id: "pa", servicio_id: "s1", estado: "agendada", inicio: "2026-09-14T13:00:00.000Z", fin: "2026-09-14T14:00:00.000Z" },
    ],
  });
  const r = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1 });
  const trece = r.slots.find((s) => s.inicio.endsWith("13:00:00.000Z"));
  assert.deepEqual(trece.profesionales, ["pb"], "la hora queda solo para quien está libre");
});

// ─── Google caído: no se ofrece lo que no se puede comprobar ────────────────

test("si no podemos comprobar el Google de un profesional, sus horas NO se ofrecen", async () => {
  const supa = base();
  // pa sincroniza con Google, pero no hay credenciales que permitan comprobarlo.
  supa.tablas.ed_profesionales[0].gcal_sync = true;
  supa.tablas.ed_profesionales[0].gcal_modo = "cuenta_servicio";
  supa.tablas.ed_profesionales[0].gcal_id = "cal@grupo.calendar.google.com";

  const r = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.noVerificables.map((p) => p.id), ["pa"]);
  assert.ok(r.slots.every((s) => !s.profesionales.includes("pa")), "nada suyo se ofrece");
  assert.deepEqual(r.slots.map((s) => s.inicio.slice(11, 16)), ["13:00", "14:00"], "las horas de Camila siguen");

  const conTodo = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1, incluirNoVerificables: true });
  assert.ok(conTodo.slots.some((s) => s.profesionales.includes("pa")), "el portal sí puede verlas, avisando");
});

// ─── Reserva con asignación y carrera ───────────────────────────────────────

test("reservar «cualquiera» asigna al de menos carga y respeta al pedido", async () => {
  const supa = base({
    ed_citas: [
      { id: "x1", cliente_id: "c1", profesional_id: "pa", servicio_id: "s1", estado: "agendada", inicio: "2026-09-14T15:00:00.000Z", fin: "2026-09-14T16:00:00.000Z" },
    ],
  });
  const r = await reservarCupo(
    { clienteId: "c1", servicioId: "s1", inicioIso: "2026-09-14T13:00:00.000Z", nombreContacto: "Ana", origen: "web", ahora: AHORA },
    supa,
  );
  assert.equal(r.ok, true);
  assert.equal(r.cita.profesional_id, "pb", "Marcela ya tiene una cita ese día: va Camila");

  const conNombre = await reservarCupo(
    { clienteId: "c1", servicioId: "s1", inicioIso: "2026-09-14T14:00:00.000Z", profesionalId: "pa", nombreContacto: "Luis", origen: "web", ahora: AHORA },
    supa,
  );
  assert.equal(conNombre.cita.profesional_id, "pa");
});

test("dos clientes confirman la misma hora: uno gana, el otro se va con el segundo profesional", async () => {
  const supa = base();
  const datos = { clienteId: "c1", servicioId: "s1", inicioIso: "2026-09-14T13:00:00.000Z", origen: "web", ahora: AHORA };
  const [a, b] = [
    await reservarCupo({ ...datos, nombreContacto: "Cliente A" }, supa),
    await reservarCupo({ ...datos, nombreContacto: "Cliente B" }, supa),
  ];
  assert.equal(a.ok && b.ok, true, "hay dos profesionales: caben los dos");
  assert.notEqual(a.cita.profesional_id, b.cita.profesional_id);

  // El tercero ya no cabe: esa hora se acabó.
  const c = await reservarCupo({ ...datos, nombreContacto: "Cliente C" }, supa);
  assert.equal(c.ok, false);
  assert.equal(c.motivo, "cupo_tomado");
  assert.ok((c.alternativas ?? []).length > 0, "se ofrecen horas cercanas reales");
  assert.ok(c.alternativas.every((s) => s.inicio !== datos.inicioIso));
});

test("pedir a una persona concreta no se sustituye por otra a sus espaldas", async () => {
  const supa = base();
  const datos = { clienteId: "c1", servicioId: "s1", inicioIso: "2026-09-14T13:00:00.000Z", origen: "web", ahora: AHORA };
  await reservarCupo({ ...datos, profesionalId: "pa", nombreContacto: "Ana" }, supa);
  const segundo = await reservarCupo({ ...datos, profesionalId: "pa", nombreContacto: "Beto" }, supa);
  assert.equal(segundo.ok, false);
  assert.equal(segundo.motivo, "cupo_tomado", "Camila estaba libre, pero pidieron a Marcela");
});

test("no se puede reservar una hora que el servidor no ofreció (madrugada, fuera de horario)", async () => {
  const supa = base();
  const r = await reservarCupo(
    { clienteId: "c1", servicioId: "s1", inicioIso: "2026-09-15T06:00:00.000Z", nombreContacto: "Ana", origen: "web", ahora: AHORA },
    supa,
  );
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "cupo_tomado");
});

// ─── Reagendar ──────────────────────────────────────────────────────────────

test("mover una hora puede cambiar de profesional, y el de otro negocio se rechaza", async () => {
  const supa = base({
    ed_citas: [
      { id: "x1", cliente_id: "c1", profesional_id: "pa", servicio_id: "s1", estado: "agendada", inicio: "2026-09-14T13:00:00.000Z", fin: "2026-09-14T14:00:00.000Z" },
    ],
    ed_servicios: [{ id: "s1", cliente_id: "c1", nombre: "Corte", duracion_min: 60, activo: true, buffer_min: 0 }],
  });
  const r = await reagendar("c1", "x1", "2026-09-14T14:00:00.000Z", supa, { profesionalId: "pb" });
  assert.equal(r.ok, true);
  assert.equal(r.cita.profesional_id, "pb");
  assert.equal(r.cita.estado, "reagendada");

  const ajeno = await reagendar("c1", "x1", "2026-09-14T15:00:00.000Z", supa, { profesionalId: "otro-negocio" });
  assert.deepEqual(ajeno, { ok: false, motivo: "profesional_invalido" });

  const deOtroCliente = await reagendar("c2", "x1", "2026-09-14T15:00:00.000Z", supa);
  assert.equal(deOtroCliente.ok, false, "la cita de otro negocio no existe para mí");
});

test("una inscripción a clase no se mueve de hora", async () => {
  const supa = base({
    ed_citas: [
      { id: "k1", cliente_id: "c1", profesional_id: "pa", servicio_id: "s1", clase_id: "cl1", estado: "agendada", inicio: "2026-09-14T13:00:00.000Z", fin: "2026-09-14T14:00:00.000Z" },
    ],
  });
  const r = await reagendar("c1", "k1", "2026-09-14T15:00:00.000Z", supa);
  assert.deepEqual(r, { ok: false, motivo: "inscripcion_de_clase" });
  assert.equal(supa.tablas.ed_citas[0].inicio, "2026-09-14T13:00:00.000Z", "no se tocó");
});

test("el día chileno de un instante no se corre con el cambio de hora", () => {
  assert.equal(diaChileDe("2026-09-14T12:00:00Z"), "2026-09-14");
  assert.equal(diaChileDe("2026-09-15T02:00:00Z"), "2026-09-14", "23:00 del 14 en Chile");
});

// ─── Clases, enlace de gestión y coste de las consultas ─────────────────────

test("una clase programada ocupa al profesional aunque no tenga inscritos", async () => {
  const supa = base({
    ed_clases: [
      {
        id: "cl1",
        cliente_id: "c1",
        profesional_id: "pa",
        estado: "activa",
        inicio: "2026-09-14T13:00:00.000Z",
        fin: "2026-09-14T14:00:00.000Z",
        cupo_maximo: 10,
        cupo_ocupado: 0,
      },
    ],
  });
  const r = await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1 });
  const trece = r.slots.find((s) => s.inicio.endsWith("13:00:00.000Z"));
  assert.deepEqual(trece.profesionales, ["pb"], "Marcela está dando clase");
});

test("el número de consultas no crece con los días pedidos", async () => {
  const supa = base();
  await disponibilidad("c1", "s1", { supa, ahora: AHORA, dias: 1 });
  const unDia = supa.llamadas.length;
  const supa2 = base();
  await disponibilidad("c1", "s1", { supa2: undefined, supa: supa2, ahora: AHORA, dias: 30 });
  assert.equal(supa2.llamadas.length, unDia, `mismas consultas: ${unDia} vs ${supa2.llamadas.length}`);
  assert.ok(unDia <= 9, `demasiadas consultas por cálculo: ${unDia}`);
  // 9 = servicio · config · mapeo · profesionales · horarios · bloqueos · citas · clases · Google.
});

test("el enlace de gestión muere 24 h después del TÉRMINO de la cita", async () => {
  const { citaPorToken } = await import("../lib/autogestionDatos.ts");
  const token = "a".repeat(36);
  const base = (inicio, fin) =>
    crearBaseMemoria({
      ed_citas: [
        {
          id: "c",
          cliente_id: "c1",
          servicio_id: "s1",
          profesional_id: "pa",
          clase_id: null,
          gestion_token: token,
          nombre_contacto: "Ana",
          inicio,
          fin,
          estado: "completada",
        },
      ],
      ed_servicios: [{ id: "s1", cliente_id: "c1", nombre: "Corte", duracion_min: 45, precio_clp: 9000, activo: true }],
      ed_clientes: [{ id: "c1", nombre: "Negocio", slug: "n", activo: true }],
    });

  // Una hora de hace meses: muerta.
  assert.equal(
    await citaPorToken(token, base("2026-01-10T13:00:00.000Z", "2026-01-10T13:45:00.000Z")),
    null,
    "una hora de hace meses ya no se muestra",
  );

  // Terminó hace 2 h: todavía abre (alcanza para mirarla al día siguiente).
  const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
  const ok = await citaPorToken(token, base(new Date(Date.now() - 3 * 3600_000).toISOString(), hace2h));
  assert.ok(ok, "una hora recién terminada sigue abriendo");

  // Terminó hace 25 h: muerta.
  const hace25h = new Date(Date.now() - 25 * 3600_000).toISOString();
  assert.equal(
    await citaPorToken(token, base(new Date(Date.now() - 26 * 3600_000).toISOString(), hace25h)),
    null,
    "pasadas 24 h del término, el enlace no muestra nada",
  );
});

test("una sesión larga no mata su propio enlace antes de terminar", async () => {
  // Se cuenta desde el FIN, no desde el inicio: con el criterio viejo, una
  // sesión de tres horas dejaba a la persona sin enlace mientras seguía dentro.
  const { citaPorToken } = await import("../lib/autogestionDatos.ts");
  const token = "b".repeat(36);
  const supa = crearBaseMemoria({
    ed_citas: [
      {
        id: "c",
        cliente_id: "c1",
        servicio_id: "s1",
        profesional_id: "pa",
        clase_id: null,
        gestion_token: token,
        nombre_contacto: "Ana",
        inicio: new Date(Date.now() - 23 * 3600_000).toISOString(),
        fin: new Date(Date.now() + 1 * 3600_000).toISOString(),
        estado: "confirmada",
      },
    ],
    ed_servicios: [{ id: "s1", cliente_id: "c1", nombre: "Taller", duracion_min: 1440, precio_clp: null, activo: true }],
    ed_clientes: [{ id: "c1", nombre: "Negocio", slug: "n", activo: true }],
  });
  assert.ok(await citaPorToken(token, supa), "la cita todavía no termina: el enlace vive");
});

test("mover por el enlace usa el horizonte del negocio, no un plazo propio", async () => {
  // El negocio abre 60 días; el cliente debe poder mover dentro de esos 60.
  const { cuposParaReagendar } = await import("../lib/autogestionDatos.ts");
  const token = "c".repeat(36);
  const inicio = new Date(AHORA + 2 * 86_400_000).toISOString();
  const supa = crearBaseMemoria({
    ed_citas: [
      {
        id: "c",
        cliente_id: "c1",
        servicio_id: "s1",
        profesional_id: "pa",
        clase_id: null,
        gestion_token: token,
        nombre_contacto: "Ana",
        inicio,
        fin: new Date(AHORA + 2 * 86_400_000 + 3600_000).toISOString(),
        estado: "confirmada",
      },
    ],
    ed_servicios: [{ id: "s1", cliente_id: "c1", nombre: "Corte", duracion_min: 60, precio_clp: null, activo: true }],
    ed_profesionales: [{ id: "pa", cliente_id: "c1", nombre: "Marcela", activo: true }],
    ed_servicio_profesional: [{ servicio_id: "s1", profesional_id: "pa" }],
    ed_horarios: [1, 2, 3, 4, 5].map((d) => ({ id: `h${d}`, profesional_id: "pa", dia_semana: d, desde: "09:00", hasta: "18:00" })),
    ed_clientes: [
      {
        id: "c1",
        nombre: "Negocio",
        slug: "n",
        activo: true,
        permite_reagendar_online: true,
        permite_cancelar_online: true,
        cancelacion_min_horas: 4,
        anticipacion_min_horas: 2,
        horizonte_dias: 60,
      },
    ],
  });
  const r = await cuposParaReagendar(token, supa);
  assert.equal(r.ok, true);
  const ultimo = r.slots.reduce((m, s) => Math.max(m, Date.parse(s.inicio)), 0);
  const diasAdelante = (ultimo - Date.now()) / 86_400_000;
  assert.ok(diasAdelante > 30, `se ofrecen más de 30 días (se ofrecieron ${diasAdelante.toFixed(0)})`);
  assert.ok(diasAdelante <= 60, `y nunca más que el horizonte (se ofrecieron ${diasAdelante.toFixed(0)})`);
});

test("si la base rechaza la inscripción duplicada, se dice «ya estás inscrito»", async () => {
  // Lo que devuelve Postgres cuando choca el índice único de la migración 307.
  // Sin esta traducción la persona veía "algo salió mal" y volvía a intentar,
  // que es justo lo que no hay que hacer cuando ya tiene su lugar.
  const { inscribirEnClase } = await import("../lib/clases.ts");
  const supa = crearBaseMemoria(
    {
      ed_clases: [
        {
          id: "cl1",
          cliente_id: "c1",
          servicio_id: "s1",
          profesional_id: "pa",
          inicio: "2026-09-20T13:00:00.000Z",
          fin: "2026-09-20T14:00:00.000Z",
          cupo_maximo: 8,
          cupo_ocupado: 3,
          estado: "activa",
        },
      ],
      ed_citas: [],
    },
    { rpc: { ed_inscribir_en_clase: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) } },
  );
  const r = await inscribirEnClase({
    clienteId: "c1",
    claseId: "cl1",
    nombre: "Ana",
    telefono: "56911112222",
    chatId: "56911112222",
    supa,
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "ya_inscrito");
});
