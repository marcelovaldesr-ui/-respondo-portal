import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ejecutarAgendaKambak } from "../lib/kambakAgenda.ts";

/**
 * Base mínima que registra la consulta de `ed_citas`. La base en memoria de los demás
 * tests ignora las columnas pedidas, por eso acá se mira el texto del select.
 */
function baseFalsa({ errorCitas = null, citas = [] } = {}) {
  const consultas = [];
  const fila = (tabla) => {
    if (tabla === "ed_clientes") return { solo_mensajeria: true, id: "hijo-1" };
    return null;
  };
  const from = (tabla) => {
    const q = {
      tabla,
      select(cols) { this.cols = cols; return this; },
      eq() { return this; },
      gte() { return this; },
      lte() { return this; },
      order() { return this; },
      limit() {
        consultas.push({ tabla, cols: this.cols });
        return Promise.resolve(errorCitas ? { data: null, error: errorCitas } : { data: citas, error: null });
      },
      maybeSingle() { return Promise.resolve({ data: fila(tabla), error: null }); },
    };
    return q;
  };
  return { from, consultas };
}

const local = { slug: "las-taguitas-restaurante", nombre: "Las Tagüitas", rubro: "Restaurante" };
const datos = { desde: "2026-10-20", hasta: "2026-11-20" };

describe("citas.listar (lista de reservas del panel de Kambak)", () => {
  it("pide servicio y sector con la relación explícita para no chocar con las llaves de la migración 272", async () => {
    const base = baseFalsa({ citas: [{ id: "c1", estado: "agendada" }] });
    const r = await ejecutarAgendaKambak("padre", { accion: "citas.listar", local, datos }, base);
    assert.equal(r.status, 200);
    assert.equal(r.body.citas.length, 1);
    const cols = base.consultas.find((c) => c.tabla === "ed_citas").cols;
    assert.match(cols, /ed_servicios!servicio_id\(/);
    assert.match(cols, /ed_profesionales!profesional_id\(/);
    assert.doesNotMatch(cols, /ed_servicios\(|ed_profesionales\(/);
  });

  it("si la base falla responde error y no una lista vacía que parezca «sin reservas»", async () => {
    const base = baseFalsa({ errorCitas: { message: "more than one relationship was found" } });
    const r = await ejecutarAgendaKambak("padre", { accion: "citas.listar", local, datos }, base);
    assert.equal(r.status, 500);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.citas, undefined);
  });
});
