import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import {
  armarMensajeResumenDiario,
  enviarResumenesDiariosAgenda,
  esVentanaResumenMatutino,
} from "../lib/resumenDiarioAgenda.ts";
import { horaChileAUtc } from "../lib/agendaCore.ts";

describe("resumenDiarioAgenda — resumen matutino al dueño por WhatsApp", () => {
  it("reconoce la ventana matutina de Chile (08:00 a 09:59)", () => {
    assert.equal(esVentanaResumenMatutino(horaChileAUtc(2026, 3, 15, 8, 30)), true);
    assert.equal(esVentanaResumenMatutino(horaChileAUtc(2026, 3, 15, 9, 59)), true);
    assert.equal(esVentanaResumenMatutino(horaChileAUtc(2026, 3, 15, 7, 55)), false);
    assert.equal(esVentanaResumenMatutino(horaChileAUtc(2026, 3, 15, 10, 0)), false);
  });

  it("arma el texto con desglose por barbero, ingreso estimado y alerta de citas por cerrar", () => {
    const texto = armarMensajeResumenDiario({
      nombreNegocio: "Barbería La Clásica",
      claveHoy: "2026-03-15",
      citasHoy: [
        {
          id: "c1",
          nombreContacto: "Matías",
          inicio: horaChileAUtc(2026, 3, 15, 10, 0).toISOString(),
          fin: horaChileAUtc(2026, 3, 15, 10, 45).toISOString(),
          estado: "confirmada",
          servicio: "Corte + Barba",
          precioClp: 18000,
          profesional: "Diego",
        },
        {
          id: "c2",
          nombreContacto: "Lucas",
          inicio: horaChileAUtc(2026, 3, 15, 11, 30).toISOString(),
          fin: horaChileAUtc(2026, 3, 15, 12, 0).toISOString(),
          estado: "agendada",
          servicio: "Corte",
          precioClp: 12000,
          profesional: "Diego",
        },
      ],
      porCerrarAyer: 2,
    });

    assert.ok(texto);
    assert.match(texto, /Barbería La Clásica/);
    assert.match(texto, /2 reservas hoy/);
    assert.match(texto, /1 confirmada, 1 por confirmar/);
    assert.match(texto, /\$30\.000/);
    assert.match(texto, /Diego\* \(2\): 10:00 Matías \(Corte \+ Barba\), 11:30 Lucas \(Corte\)/);
    assert.match(texto, /2\* horas pasadas sin cerrar/);
  });

  it("envía una sola vez al día por negocio y no molesta si no hay actividad", async () => {
    const ahora = horaChileAUtc(2026, 3, 15, 8, 15);
    const enviados = [];

    const mem = crearBaseMemoria(
      {
        ed_clientes: [
          {
            id: "cli-barber",
            nombre: "Barbería Norte",
            activo: true,
            transporte: "cloud",
            telefono_escalacion: "56999887766",
            whatsapp_negocio: null,
            canal_escalacion: "whatsapp",
          },
          {
            id: "cli-vacio",
            nombre: "Barbería Sin Citas",
            activo: true,
            transporte: "cloud",
            telefono_escalacion: "56911112222",
            whatsapp_negocio: null,
            canal_escalacion: "whatsapp",
          },
        ],
        ed_servicios: [
          { id: "s1", cliente_id: "cli-barber", nombre: "Fade", precio_clp: 15000 },
        ],
        ed_profesionales: [
          { id: "p1", cliente_id: "cli-barber", nombre: "Tomás" },
        ],
        ed_citas: [
          {
            id: "cita-hoy",
            cliente_id: "cli-barber",
            nombre_contacto: "Pedro",
            inicio: horaChileAUtc(2026, 3, 15, 15, 0).toISOString(),
            fin: horaChileAUtc(2026, 3, 15, 15, 45).toISOString(),
            estado: "confirmada",
            servicio_id: "s1",
            profesional_id: "p1",
          },
        ],
        ed_latidos: [],
      },
      {
        unicos: {
          ed_latidos: [{ cols: ["clave"] }],
        },
      },
    );

    const r1 = await enviarResumenesDiariosAgenda({
      ahora,
      supa: mem,
      enviar: async (cli, texto) => {
        enviados.push({ cli, texto });
        return { ok: true };
      },
    });

    assert.equal(r1.enviados, 1);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].cli.destino, "56999887766");
    assert.match(enviados[0].texto, /15:00 Pedro \(Fade\)/);

    // Segunda pasada en la misma mañana: idempotente, no vuelve a enviar.
    const r2 = await enviarResumenesDiariosAgenda({
      ahora: horaChileAUtc(2026, 3, 15, 8, 20),
      supa: mem,
      enviar: async (cli, texto) => {
        enviados.push({ cli, texto });
        return { ok: true };
      },
    });

    assert.equal(r2.enviados, 0);
    assert.equal(enviados.length, 1);
  });
});
