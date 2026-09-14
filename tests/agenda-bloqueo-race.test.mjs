/**
 * CITA ↔ BLOQUEO (auditoría externa 13-sep-2026, P2).
 *
 * El EXCLUDE de ed_citas (220/260) impide que dos CITAS del mismo profesional
 * se solapen, pero vive DENTRO de esa tabla: nada en la base impedía que una
 * cita se confirmara encima de un bloqueo (tabla aparte). lib/agenda.ts ya
 * excluye los bloqueos al CALCULAR los cupos ofrecidos (disponibilidad), pero
 * leer y después escribir no es una transacción — cabe una carrera real.
 *
 * La migración 308 (sql/308_agenda_bloqueo_atomico.sql) cierra la ventana en
 * la base: un trigger con advisory lock por negocio, verificado bajo
 * concurrencia REAL en scripts/_verificar_bloqueo_atomico.sh (no se puede
 * automatizar esa prueba con Postgres real dentro de este test unitario —
 * ver la nota al final de este archivo). Lo que SÍ se prueba acá, con el supa
 * falso, es que la CAPA DE CÓDIGO traduce el rechazo de la base (ED001) al
 * mismo resultado de negocio que ya existía para el EXCLUDE (23P01):
 * {ok:false, motivo:'cupo_tomado'} — para que reservarCupo() reintente con el
 * siguiente profesional exactamente igual que ante una carrera cita↔cita.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearCita, reagendar, reabrirCita } from "../lib/agenda.ts";
import { crearSupaFalso } from "./_supaFalso.mjs";

const CLIENTE = "cliente-1";
const SERVICIO = "servicio-1";
const PROFESIONAL = "prof-1";

function supaCrearCitaBloqueada() {
  return crearSupaFalso((ll) => {
    if (ll.tabla === "ed_servicios") return { data: { id: SERVICIO, duracion_min: 30, activo: true } };
    if (ll.tabla === "ed_profesionales") return { data: { id: PROFESIONAL, activo: true } };
    if (ll.tabla === "ed_citas" && ll.op === "insert") {
      // Lo que devolvería el trigger ed_citas_verificar_bloqueo() al rechazar.
      return { data: null, error: { code: "ED001", message: "Ese horario está bloqueado para este profesional." } };
    }
    return { data: null };
  });
}

test("⭐ crearCita: un bloqueo concurrente se traduce igual que 'cupo_tomado' (23P01)", async () => {
  const supa = supaCrearCitaBloqueada();
  const r = await crearCita(
    {
      clienteId: CLIENTE,
      servicioId: SERVICIO,
      profesionalId: PROFESIONAL,
      inicioIso: "2026-11-05T13:00:00.000Z",
      nombreContacto: "Cliente de prueba",
      origen: "web",
    },
    supa,
  );
  assert.deepEqual(r, { ok: false, motivo: "cupo_tomado" });
});

test("reagendar: mover una cita a un horario recién bloqueado también se rechaza como cupo_tomado", async () => {
  const supa = crearSupaFalso((ll) => {
    if (ll.tabla === "ed_citas" && ll.op === "select") {
      return {
        data: {
          id: "cita-1",
          profesional_id: PROFESIONAL,
          clase_id: null,
          ed_servicios: { duracion_min: 30 },
        },
      };
    }
    if (ll.tabla === "ed_citas" && ll.op === "update") {
      return { data: null, error: { code: "ED001", message: "bloqueado" } };
    }
    return { data: null };
  });
  const r = await reagendar(CLIENTE, "cita-1", "2026-11-05T13:00:00.000Z", supa);
  assert.deepEqual(r, { ok: false, motivo: "cupo_tomado" });
});

test("reabrirCita: reabrir hacia un horario ahora bloqueado también se rechaza como cupo_tomado", async () => {
  const supa = crearSupaFalso((ll) => {
    if (ll.tabla === "ed_citas" && ll.op === "update") {
      return { data: null, error: { code: "ED001", message: "bloqueado" } };
    }
    return { data: null };
  });
  const r = await reabrirCita(CLIENTE, "cita-1", supa);
  assert.deepEqual(r, { ok: false, motivo: "cupo_tomado" });
});

test("un error real de la base (no ED001/23P01) sigue reportándose como 'error', no como cupo_tomado", async () => {
  // Que el nuevo código no se trague errores genuinos disfrazándolos de "cupo
  // tomado" — motivo:'error' es lo que hace que el portal muestre el mensaje
  // correcto en vez de sugerir "prueba otra hora".
  const supa = crearSupaFalso((ll) => {
    if (ll.tabla === "ed_servicios") return { data: { id: SERVICIO, duracion_min: 30, activo: true } };
    if (ll.tabla === "ed_profesionales") return { data: { id: PROFESIONAL, activo: true } };
    if (ll.tabla === "ed_citas" && ll.op === "insert") {
      return { data: null, error: { code: "23505", message: "algo distinto" } };
    }
    return { data: null };
  });
  const r = await crearCita(
    {
      clienteId: CLIENTE,
      servicioId: SERVICIO,
      profesionalId: PROFESIONAL,
      inicioIso: "2026-11-05T13:00:00.000Z",
      nombreContacto: "Cliente de prueba",
      origen: "web",
    },
    supa,
  );
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "error");
});

/**
 * POR QUÉ NO HAY ACÁ UNA PRUEBA DE INTEGRACIÓN CONTRA POSTGRES REAL.
 *
 * Este proyecto corre sus tests con `node --test` sobre un supa FALSO
 * (tests/_supaFalso.mjs) — no hay infraestructura de base de datos real en
 * la suite (`npm test`), ni credenciales de Supabase disponibles para las
 * pruebas automatizadas. Levantar Postgres real DENTRO de `npm test` sería
 * agregar infraestructura de CI nueva, fuera del alcance de este fix.
 *
 * La aproximación más fuerte posible, tal como pide la auditoría, es
 * `scripts/_verificar_bloqueo_atomico.sh`: un script aparte que levanta su
 * PROPIO cluster Postgres desechable (no toca la base del proyecto), aplica
 * el esquema mínimo + la migración 308 tal cual, y con DOS conexiones
 * concurrentes reales —medidas con clock_timestamp()/\timing, no simuladas—
 * demuestra:
 *   1) que la condición de carrera era real SIN la migración 308 (una cita
 *      se crea en silencio dentro de un bloqueo activo, sin ningún error);
 *   2) que CON la migración, la transacción que llega segunda queda
 *      bloqueada por el advisory lock de la primera (tiempo de espera
 *      medido, no supuesto) y luego rechazada correctamente, en ambas
 *      direcciones (cita→bloqueo y bloqueo→cita).
 *
 * Se corrió a mano en este cierre (13-sep-2026) y los tres escenarios
 * pasaron. Queda como script versionado para volver a correrlo cuando se
 * quiera, sin depender de infraestructura de CI nueva.
 */
