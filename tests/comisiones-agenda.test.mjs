import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizarPorcentajeComision,
  calcularComisionesProfesionales,
} from "../lib/comisionesAgenda.ts";

test("normalizarPorcentajeComision acota entre 0 y 100", () => {
  assert.equal(normalizarPorcentajeComision(null), 0);
  assert.equal(normalizarPorcentajeComision(""), 0);
  assert.equal(normalizarPorcentajeComision(-10), 0);
  assert.equal(normalizarPorcentajeComision("45"), 45);
  assert.equal(normalizarPorcentajeComision(120), 100);
});

test("calcularComisionesProfesionales suma solo citas completadas y separa comisión vs local", () => {
  const profesionales = [
    { id: "p1", nombre: "Diego", comisionPct: 50 },
    { id: "p2", nombre: "Matías", comisionPct: 40 },
  ];
  const citas = [
    {
      id: "c1",
      profesionalId: "p1",
      estado: "completada",
      inicio: "2026-10-10T14:00:00.000Z",
      precioClp: 18000,
    },
    {
      id: "c2",
      profesionalId: "p1",
      estado: "completada",
      inicio: "2026-10-11T14:00:00.000Z",
      precioClp: 12000,
    },
    {
      id: "c3",
      profesionalId: "p1",
      estado: "confirmada",
      inicio: "2026-10-12T14:00:00.000Z",
      precioClp: 12000,
    },
    {
      id: "c4",
      profesionalId: "p2",
      estado: "completada",
      inicio: "2026-10-11T16:00:00.000Z",
      precioClp: 15000,
    },
    {
      id: "c5",
      profesionalId: "p2",
      estado: "no_show",
      inicio: "2026-10-11T18:00:00.000Z",
      precioClp: 8000,
    },
  ];

  const res = calcularComisionesProfesionales({ profesionales, citas });

  assert.equal(res.totalAtenciones, 3);
  assert.equal(res.totalVendidoClp, 45000);
  // Diego: 30.000 * 50% = 15.000 | Matías: 15.000 * 40% = 6.000
  assert.equal(res.totalComisionClp, 21000);
  assert.equal(res.totalRetencionLocalClp, 24000);

  const diego = res.filas.find((f) => f.profesionalId === "p1");
  assert.equal(diego?.atenciones, 2);
  assert.equal(diego?.totalVendidoClp, 30000);
  assert.equal(diego?.comisionClp, 15000);

  const matias = res.filas.find((f) => f.profesionalId === "p2");
  assert.equal(matias?.atenciones, 1);
  assert.equal(matias?.totalVendidoClp, 15000);
  assert.equal(matias?.comisionClp, 6000);
});
