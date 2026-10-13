import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { ejecutarAgendaKambak } from "../lib/kambakAgenda.ts";

describe("ejecutarAgendaKambak (gestión de agenda desde el panel de Kambak)", () => {
  it("rechaza cuentas que no son de solo_mensajeria", async () => {
    const mem = crearBaseMemoria({
      ed_clientes: [{ id: "cli-normal", nombre: "Normal", solo_mensajeria: false }],
    });
    const r = await ejecutarAgendaKambak(
      "cli-normal",
      { accion: "estado", local: { slug: "barberia-x", nombre: "Barbería X", rubro: "Barbería" } },
      mem,
    );
    assert.equal(r.status, 403);
    assert.equal(r.body.ok, false);
  });

  it("activa automáticamente un local de restaurante con su semilla y permite leer y editar su configuración", async () => {
    const mem = crearBaseMemoria({
      ed_clientes: [{ id: "kambak-parent", nombre: "Kambak", solo_mensajeria: true }],
      ed_servicios: [],
      ed_profesionales: [],
      ed_horarios: [],
      ed_servicio_campos: [],
      ed_bloqueos: [],
      ed_citas: [],
    });

    const local = { slug: "bistro-sur", nombre: "Bistró Sur", rubro: "Restaurante" };

    // 1. Estado inicial: no activo
    const rEstado0 = await ejecutarAgendaKambak("kambak-parent", { accion: "estado", local }, mem);
    assert.equal(rEstado0.status, 200);
    assert.equal(rEstado0.body.activo, false);

    // 2. Activar
    const rAct = await ejecutarAgendaKambak("kambak-parent", { accion: "activar", local }, mem);
    assert.equal(rAct.status, 200);
    assert.equal(rAct.body.activo, true);
    assert.equal(rAct.body.yaExistia, false);

    // 3. Leer configuración inicial creada por semilla
    const rCfg = await ejecutarAgendaKambak("kambak-parent", { accion: "config.leer", local }, mem);
    assert.equal(rCfg.status, 200);
    assert.equal(rCfg.body.cliente.slug, "bistro-sur");
    assert.equal(rCfg.body.cliente.rubro, "restaurante");
    assert.equal(rCfg.body.servicios.length, 1);
    assert.equal(rCfg.body.servicios[0].nombre, "Reserva de mesa");
    assert.equal(rCfg.body.profesionales.length, 1);
    assert.equal(rCfg.body.profesionales[0].nombre, "Salón principal");
    assert.equal(rCfg.body.campos.length, 1);
    assert.equal(rCfg.body.campos[0].etiqueta, "Cantidad de personas");

    // 4. Agregar un nuevo sector / profesional con comisión
    const rProf = await ejecutarAgendaKambak(
      "kambak-parent",
      { accion: "profesional.guardar", local, datos: { nombre: "Terraza cubierta", comisionPct: 10 } },
      mem,
    );
    assert.equal(rProf.status, 200);

    const rCfg2 = await ejecutarAgendaKambak("kambak-parent", { accion: "config.leer", local }, mem);
    assert.equal(rCfg2.body.profesionales.length, 2);
  });
});
