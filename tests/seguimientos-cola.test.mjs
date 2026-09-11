/**
 * LA COLA DE SEGUIMIENTOS NO SE ATASCA NI MANDA A DESTIEMPO (Fase 0, 11-sep-2026).
 *
 * Simula `ed_seguimientos` en memoria (sin base) y corre el motor real
 * (`procesarSeguimientos`) con un transporte falso: nada sale a ningún cliente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { procesarSeguimientos } from "../lib/seguimientos.ts";
import { crearSupaFalso } from "./_supaFalso.mjs";

// 12:00 de Chile en septiembre (UTC-3 en horario de verano chileno desde el 6-sep).
const AHORA = new Date("2026-09-11T15:00:00Z");

function baseFalsa({ filas, citas = {}, empleados = { e1: "c1", e2: "c2" }, enviadosHoy = [] }) {
  const tabla = filas.map((f) => ({ enviado_en: null, intento: 0, max_intentos: 1, plantilla_meta: "texto_libre", ...f }));
  const supa = crearSupaFalso((ll) => {
    const val = (col) => ll.filtros.find((f) => f[1] === col)?.[2];
    if (ll.tabla === "ed_seguimientos") {
      if (ll.op === "update") {
        const fila = tabla.find((t) => t.id === val("id"));
        if (fila && !(ll.filtros.some((f) => f[0] === "is" && f[1] === "enviado_en") && fila.enviado_en)) Object.assign(fila, ll.payload);
        return { data: null };
      }
      if (ll.op === "insert") return { data: null };
      if (ll.select === "empleado_id") return { data: enviadosHoy };
      // Lectura de la cola: pendientes vencidos, más viejos primero.
      const hasta = val("programado_para") ?? ll.filtros.find((f) => f[0] === "lte")?.[2];
      const pend = tabla
        .filter((t) => !t.enviado_en && Date.parse(t.programado_para) <= Date.parse(hasta))
        .sort((a, b) => Date.parse(a.programado_para) - Date.parse(b.programado_para));
      return { data: pend.slice(0, ll.limit ?? 1000).map((x) => ({ ...x })) };
    }
    if (ll.tabla === "ed_empleados") {
      if (ll.unico) return { data: { cliente_id: empleados[val("id")] } };
      return { data: Object.entries(empleados).map(([id, cliente_id]) => ({ id, cliente_id })) };
    }
    if (ll.tabla === "ed_contactos") return { data: { etiquetas: [] } };
    if (ll.tabla === "ed_citas") {
      const c = citas[val("id")];
      return { data: c && c.cliente_id === val("cliente_id") ? c : null };
    }
    return { data: null };
  });
  return { supa, tabla };
}

const hace = (min) => new Date(AHORA.getTime() - min * 60_000).toISOString();

test("filas pospuestas por ventana cerrada no tapan a las que sí pueden salir (aunque sean 60)", async () => {
  const filas = [];
  for (let i = 0; i < 60; i++) filas.push({ id: `pos-${i}`, empleado_id: "e1", chat_id: `x${i}`, tipo: "cliente_inactivo", variables: { texto: "hola" }, programado_para: hace(1000 - i) });
  filas.push({ id: "sale-e2", empleado_id: "e2", chat_id: "y", tipo: "mantencion_toca", variables: { texto: "hola", params: ["a"] }, plantilla_meta: "mantencion_toca", programado_para: hace(10) });
  const { supa, tabla } = baseFalsa({ filas });
  const enviar = async (emp) => (emp === "e1" ? { ok: false, omitido: true, error: "ventana" } : { ok: true, waId: "w" });

  let total = 0;
  for (let pasada = 0; pasada < 3 && total === 0; pasada++) {
    total += (await procesarSeguimientos({ supa, ahora: AHORA, enviar })).enviados;
  }
  assert.equal(total, 1, "la fila de otro negocio salió en a lo sumo 2 pasadas");
  const pos = tabla.find((t) => t.id === "pos-0");
  assert.equal(pos.enviado_en, null, "lo pospuesto NO se marca como enviado");
  assert.ok(Date.parse(pos.programado_para) > AHORA.getTime(), "lo pospuesto se corre hacia adelante");
  assert.equal(pos.variables.pospuesto_desde, AHORA.toISOString());
});

test("un texto libre pospuesto más de 7 días se cierra con motivo", async () => {
  const filas = [{ id: "viejo", empleado_id: "e1", chat_id: "x", tipo: "cliente_inactivo", programado_para: hace(5), variables: { texto: "hola", pospuesto_desde: new Date(AHORA.getTime() - 8 * 86400_000).toISOString() } }];
  const { supa, tabla } = baseFalsa({ filas });
  await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => ({ ok: false, omitido: true }) });
  assert.ok(tabla[0].enviado_en);
  assert.match(tabla[0].variables.descartado, /ventana de 24 h cerrada/);
});

test("tope diario alcanzado: la fila pasa a mañana 10:00 de Chile, no queda al frente", async () => {
  const enviadosHoy = Array.from({ length: 15 }, () => ({ empleado_id: "e1" }));
  const filas = [{ id: "topada", empleado_id: "e1", chat_id: "x", tipo: "mantencion_toca", variables: { texto: "t" }, programado_para: hace(30) }];
  const { supa, tabla } = baseFalsa({ filas, enviadosHoy });
  const r = await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => ({ ok: true }) });
  assert.equal(r.enviados, 0);
  assert.equal(tabla[0].enviado_en, null);
  assert.equal(tabla[0].programado_para, "2026-09-12T13:00:00.000Z", "10:00 de Chile (UTC-3) del día siguiente");
});

test("recordatorio de una cita que ya empezó se descarta, nunca se manda tarde", async () => {
  const citas = { cita1: { cliente_id: "c1", estado: "agendada", inicio: hace(60), fin: hace(0) } };
  const filas = [{ id: "rec", empleado_id: "e1", chat_id: "x", tipo: "recordatorio_cita", variables: { texto: "Te esperamos hoy a las 09:00", cita_id: "cita1" }, programado_para: hace(240) }];
  const { supa, tabla } = baseFalsa({ filas, citas });
  let enviados = 0;
  await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => { enviados++; return { ok: true }; } });
  assert.equal(enviados, 0);
  assert.match(tabla[0].variables.descartado, /ya empezó/);
});

test("la cita se busca acotada al negocio del empleado (una cita de otro negocio no valida)", async () => {
  const citas = { cita1: { cliente_id: "c2", estado: "agendada", inicio: new Date(AHORA.getTime() + 5 * 3600_000).toISOString(), fin: new Date(AHORA.getTime() + 6 * 3600_000).toISOString() } };
  const filas = [{ id: "rec", empleado_id: "e1", chat_id: "x", tipo: "recordatorio_cita", variables: { texto: "t", cita_id: "cita1" }, programado_para: hace(1) }];
  const { supa, tabla } = baseFalsa({ filas, citas });
  let enviados = 0;
  await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => { enviados++; return { ok: true }; } });
  assert.equal(enviados, 0);
  assert.match(tabla[0].variables.descartado, /no encontrada/);
});

test("un recordatorio vigente sí sale, y la tanda sigue topada en 10 intentos reales", async () => {
  const futuro = (h) => new Date(AHORA.getTime() + h * 3600_000).toISOString();
  const citas = { ok: { cliente_id: "c2", estado: "confirmada", inicio: futuro(3), fin: futuro(4) } };
  const filas = [{ id: "vigente", empleado_id: "e2", chat_id: "z", tipo: "recordatorio_cita", variables: { texto: "t", cita_id: "ok" }, programado_para: hace(40) }];
  for (let i = 0; i < 30; i++) filas.push({ id: `m${i}`, empleado_id: "e2", chat_id: `z${i}`, tipo: "t", variables: { texto: "t" }, programado_para: hace(30 - i / 10) });
  const { supa, tabla } = baseFalsa({ filas, citas });
  const r = await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => ({ ok: true }) });
  assert.equal(r.enviados, 10);
  assert.ok(tabla.find((t) => t.id === "vigente").enviado_en);
});

test("no_contactar y filas sin texto se cierran CON motivo (no parecen envíos)", async () => {
  const filas = [
    { id: "sin", empleado_id: "e1", chat_id: "x", tipo: "t", variables: {}, programado_para: hace(3) },
  ];
  const { supa, tabla } = baseFalsa({ filas });
  await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => ({ ok: true }) });
  assert.equal(tabla[0].variables.descartado, "sin texto");
});

test("fuera de horario hábil no hace nada", async () => {
  const { supa } = baseFalsa({ filas: [{ id: "a", empleado_id: "e1", chat_id: "x", tipo: "t", variables: { texto: "t" }, programado_para: hace(1) }] });
  const r = await procesarSeguimientos({ supa, ahora: new Date("2026-09-11T02:00:00Z"), enviar: async () => ({ ok: true }) });
  assert.equal(r.enviados, 0);
  assert.equal(supa.llamadas.length, 0);
});

test("el tope diario cuenta solo envíos reales (excluye descartados) y un fallo de envío queda como error del negocio", async () => {
  const filas = [{ id: "f", empleado_id: "e1", chat_id: "x", tipo: "mantencion_toca", variables: { texto: "t" }, programado_para: hace(5), max_intentos: 2 }];
  const { supa } = baseFalsa({ filas });
  const r = await procesarSeguimientos({ supa, ahora: AHORA, enviar: async () => ({ ok: false, error: "HTTP 500" }) });
  const conteo = supa.llamadas.find((l) => l.tabla === "ed_seguimientos" && l.select === "empleado_id");
  assert.ok(conteo.filtros.some((f) => f[0] === "is" && f[1] === "variables->>descartado" && f[2] === null), "el conteo del tope filtra descartados");
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].clienteId, "c1");
  assert.match(r.errores[0].error, /HTTP 500/);
  assert.ok(!JSON.stringify(r.errores).includes("\"x\""), "el error no lleva el chat_id");
});

test("fuera de horario se informa como 'sin trabajo', no como éxito ni fallo", async () => {
  const { supa } = baseFalsa({ filas: [] });
  const r = await procesarSeguimientos({ supa, ahora: new Date("2026-09-11T02:00:00Z"), enviar: async () => ({ ok: true }) });
  assert.equal(r.fueraDeHorario, true);
  assert.deepEqual(r.errores, []);
});
