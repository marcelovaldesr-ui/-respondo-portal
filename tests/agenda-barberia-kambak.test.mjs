import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { plantillasParaRubro } from "../lib/plantillas.ts";
import { PLANTILLAS as PLANTILLAS_RUBRO } from "../lib/plantillasRubro.ts";
import { cambiarEstado } from "../lib/agenda.ts";
import { firmar } from "../lib/puenteSalida.ts";
import { generarMantenciones } from "../lib/generadorSeguimientos.ts";

describe("agenda barbería ↔ Kambak y activación de rubros", () => {
  it("activa las plantillas de cita para barberia y restaurante", () => {
    const barberia = plantillasParaRubro("barberia").map((p) => p.nombre);
    const restaurante = plantillasParaRubro("restaurante").map((p) => p.nombre);

    assert.ok(barberia.includes("cita_confirmacion"));
    assert.ok(barberia.includes("cita_recordatorio"));
    assert.ok(restaurante.includes("cita_confirmacion"));
    assert.ok(restaurante.includes("cita_recordatorio"));
    assert.ok(PLANTILLAS_RUBRO.barberia);
    assert.ok(PLANTILLAS_RUBRO.restaurante);
  });

  it("al completar una cita actualiza ultima_atencion y dispara el webhook firmado cita.completada a Kambak", async () => {
    const mem = crearBaseMemoria({
      ed_clientes: [
        {
          id: "cli-barber",
          nombre: "Barbería La Clásica",
          slug: "barberia-la-clasica",
          activo: true,
        },
      ],
      ed_servicios: [
        {
          id: "srv-fade",
          cliente_id: "cli-barber",
          nombre: "Corte + Barba",
        },
      ],
      ed_integraciones: [
        {
          id: "int-kambak",
          cliente_id: "cli-barber",
          url: "https://www.kambak.cl/api/hooks/respondo",
          secreto: "secreto-compartido-123",
          eventos: ["cita.completada"],
          activo: true,
        },
      ],
      ed_citas: [
        {
          id: "cita-99",
          cliente_id: "cli-barber",
          servicio_id: "srv-fade",
          profesional_id: "prof-1",
          chat_id: "56911223344",
          telefono: "56911223344",
          nombre_contacto: "Matías Rojas",
          inicio: "2026-03-10T14:00:00.000Z",
          fin: "2026-03-10T14:45:00.000Z",
          estado: "confirmada",
        },
      ],
      ed_contactos: [],
    });

    const llamadasWebhook = [];
    const r = await cambiarEstado("cli-barber", "cita-99", "completada", mem, {
      fetchImpl: async (url, init) => {
        llamadasWebhook.push({ url, init });
        return new Response(JSON.stringify({ ok: true, stamped: true }), { status: 200 });
      },
    });

    assert.equal(r.ok, true);
    assert.equal(r.encontrada, true);

    // 1. Verifica que ed_contactos quedó con ultima_atencion y ultimo_servicio
    assert.equal(mem.tablas.ed_contactos.length, 1);
    assert.equal(mem.tablas.ed_contactos[0].ultima_atencion, "2026-03-10T14:45:00.000Z");
    assert.equal(mem.tablas.ed_contactos[0].datos.ultimo_servicio, "Corte + Barba");

    // 2. Verifica que el webhook firmado salió a Kambak con el contrato de cita.completada
    assert.equal(llamadasWebhook.length, 1);
    assert.equal(llamadasWebhook[0].url, "https://www.kambak.cl/api/hooks/respondo");
    const rawBody = llamadasWebhook[0].init.body;
    const firmaEsperada = firmar(rawBody, "secreto-compartido-123");
    assert.equal(llamadasWebhook[0].init.headers["x-respondo-signature"], firmaEsperada);

    const parsed = JSON.parse(rawBody);
    assert.equal(parsed.type, "cita.completada");
    assert.equal(parsed.data.slug, "barberia-la-clasica");
    assert.equal(parsed.data.citaId, "cita-99");
    assert.equal(parsed.data.phone, "56911223344");
  });

  it("permite que Beto programe seguimiento usando datos.ultimo_servicio sin exigir moto", async () => {
    const mem = crearBaseMemoria({
      ed_clientes: [{ id: "cli-barber", nombre: "Barbería La Clásica" }],
      ed_empleados: [{ id: "emp-beto", cliente_id: "cli-barber", rol: "rita", activo: true }],
      ed_contactos: [
        {
          id: "ct-1",
          cliente_id: "cli-barber",
          chat_id: "56911223344",
          nombre: "Matías Rojas",
          etiquetas: [],
          ultima_atencion: "2026-02-10T14:45:00.000Z",
          datos: { ultimo_servicio: "Corte + Barba" },
        },
      ],
      ed_seguimientos: [],
    });

    const res = await generarMantenciones({
      clienteId: "cli-barber",
      intervaloMeses: 1,
      margenAntesMeses: 0,
      margenDespuesMeses: 1,
      ahora: new Date("2026-03-15T12:00:00.000Z"),
      supa: mem,
      simular: true,
    });

    assert.equal(res.programados, 1);
    assert.equal(res.candidatos.length, 1);
    assert.equal(res.candidatos[0].vehiculo, "Corte + Barba");
  });
});
