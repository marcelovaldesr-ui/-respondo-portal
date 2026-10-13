import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import {
  fichaCliente,
  guardarDatosCliente,
  claveTelefonoFicha,
} from "../lib/clientes.ts";

const CLIENTE_ID = "cli-barberia-1";

describe("fichaCliente — historial de citas por cliente", () => {
  let mem;

  beforeEach(() => {
    mem = crearBaseMemoria({
      ed_contactos: [
        {
          id: "ct-1",
          cliente_id: CLIENTE_ID,
          chat_id: "56911223344",
          nombre: "Matías Rojas",
          telefono: "56911223344",
          email: null,
          notas: "Degradado medio con navaja",
          etiquetas: ["frecuente"],
          datos: {},
          primera_vez: "2026-01-10T12:00:00.000Z",
          ultimo_mensaje: "2026-03-01T15:00:00.000Z",
        },
      ],
      ed_servicios: [
        {
          id: "srv-corte",
          cliente_id: CLIENTE_ID,
          nombre: "Corte + Barba",
          precio_clp: 18000,
        },
      ],
      ed_profesionales: [
        {
          id: "prof-diego",
          cliente_id: CLIENTE_ID,
          nombre: "Diego",
        },
      ],
      ed_citas: [
        {
          id: "cita-1",
          cliente_id: CLIENTE_ID,
          chat_id: "56911223344",
          nombre_contacto: "Matías Rojas",
          telefono: "56911223344",
          servicio_id: "srv-corte",
          profesional_id: "prof-diego",
          inicio: "2026-02-15T14:00:00.000Z",
          fin: "2026-02-15T14:45:00.000Z",
          estado: "completada",
          origen: "whatsapp",
          notas: "Pidió cejas al final",
          datos_extra: { "Largo lateral": "0.5" },
          creado_en: "2026-02-14T10:00:00.000Z",
        },
        {
          id: "cita-2",
          cliente_id: CLIENTE_ID,
          chat_id: null,
          nombre_contacto: "Matías Rojas",
          telefono: "+56 9 1122 3344",
          servicio_id: "srv-corte",
          profesional_id: "prof-diego",
          inicio: "2026-03-01T16:00:00.000Z",
          fin: "2026-03-01T16:45:00.000Z",
          estado: "no_show",
          origen: "web",
          notas: null,
          datos_extra: null,
          creado_en: "2026-02-28T10:00:00.000Z",
        },
      ],
    });
  });

  it("normaliza teléfonos chilenos a la misma clave de 9 dígitos", () => {
    assert.equal(claveTelefonoFicha("+56 9 1122 3344"), "911223344");
    assert.equal(claveTelefonoFicha("56911223344"), "911223344");
    assert.equal(claveTelefonoFicha("911223344"), "911223344");
  });

  it("incluye citas por chat_id y por teléfono normalizado con servicio, barbero y conteos", async () => {
    const f = await fichaCliente(CLIENTE_ID, "56911223344", mem);
    assert.ok(f);
    assert.equal(f.nombre, "Matías Rojas");
    assert.equal(f.citas.length, 2);
    assert.equal(f.visitasCompletadas, 1);
    assert.equal(f.inasistencias, 1);
    assert.equal(f.ultimaVisita, "2026-02-15T14:00:00.000Z");

    const completada = f.citas.find((c) => c.id === "cita-1");
    assert.ok(completada);
    assert.equal(completada.servicio, "Corte + Barba");
    assert.equal(completada.precioClp, 18000);
    assert.equal(completada.profesional, "Diego");
    assert.equal(completada.notas, "Pidió cejas al final");
    assert.deepEqual(completada.datosExtra, { "Largo lateral": "0.5" });

    const eventosCita = f.eventos.filter((e) => e.tipo === "cita");
    assert.equal(eventosCita.length, 2);
  });

  it("arma la ficha y permite guardar notas aunque el cliente solo haya reservado por web", async () => {
    mem.tablas.ed_citas.push({
      id: "cita-web-only",
      cliente_id: CLIENTE_ID,
      chat_id: null,
      nombre_contacto: "Lucas Soto",
      telefono: "56988776655",
      servicio_id: "srv-corte",
      profesional_id: "prof-diego",
      inicio: "2026-03-10T18:00:00.000Z",
      fin: "2026-03-10T18:45:00.000Z",
      estado: "confirmada",
      origen: "web",
      notas: null,
      datos_extra: null,
      creado_en: "2026-03-09T12:00:00.000Z",
    });

    const f = await fichaCliente(CLIENTE_ID, "56988776655", mem);
    assert.ok(f);
    assert.equal(f.nombre, "Lucas Soto");
    assert.equal(f.citas.length, 1);

    await guardarDatosCliente(
      CLIENTE_ID,
      "56988776655",
      {
        nombre: "Lucas Soto",
        notas: "Prefiere tijera arriba",
      },
      mem,
    );

    const fDespues = await fichaCliente(CLIENTE_ID, "56988776655", mem);
    assert.ok(fDespues);
    assert.equal(fDespues.notas, "Prefiere tijera arriba");
  });
});
