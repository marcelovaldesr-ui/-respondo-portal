import assert from "node:assert/strict";
import test from "node:test";

import { textoInformeFidelizacion } from "../lib/fidelizacionCore.ts";

/**
 * El texto que se le manda por WhatsApp al DUEÑO del negocio para que lo
 * reenvíe a gerencia. Un número mal comparado acá no es un bug de pantalla:
 * es un dato falso que un cliente usa para decidir si sigue pagando.
 */

function fid(p = {}) {
  return {
    citas: 10,
    porAsistente: 8,
    porEnlace: 1,
    porEquipo: 1,
    porcentajeSinIntervencion: 90,
    completadas: 7,
    noShow: 2,
    canceladas: 1,
    porcentajeNoShow: 22,
    personasAtendidas: 20,
    personasQueVolvieron: 8,
    tasaRetorno: 40,
    seguimientosEnviados: 5,
    seguimientosRespondidos: 2,
    tasaRespuesta: 40,
    reactivados: 1,
    ventanaReactivacionDias: 14,
    ...p,
  };
}

const BASE = { nombreNegocio: "RS-Shop", etiquetaPeriodo: "agosto 2026" };

test("sin período anterior, no inventa ninguna comparación", () => {
  const t = textoInformeFidelizacion({ ...BASE, actual: fid(), anterior: null });
  assert.match(t, /RS-Shop/);
  assert.match(t, /agosto 2026/);
  assert.match(t, /Horas agendadas: 10/);
  assert.doesNotMatch(t, /vs\. período anterior/);
});

test("⭐⭐ con período anterior, muestra la diferencia con signo correcto", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ citas: 10 }),
    anterior: fid({ citas: 6 }),
  });
  assert.match(t, /Horas agendadas: 10 \(\+4 vs\. período anterior\)/);
});

test("cuando bajó, el signo es negativo, no doble negativo", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ citas: 6 }),
    anterior: fid({ citas: 10 }),
  });
  assert.match(t, /Horas agendadas: 6 \(-4 vs\. período anterior\)/);
  assert.doesNotMatch(t, /--4/);
});

test("tasas se comparan en puntos, no en porcentaje del porcentaje", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ tasaRetorno: 45 }),
    anterior: fid({ tasaRetorno: 40 }),
  });
  assert.match(t, /Clientes que volvieron: 45%.*\+5 pts/);
});

test("mismo valor exacto dice 'igual', no '+0'", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ citas: 10 }),
    anterior: fid({ citas: 10 }),
  });
  assert.match(t, /Horas agendadas: 10 \(igual que el período anterior\)/);
  assert.doesNotMatch(t, /\+0/);
});

test("⭐ sin citas cerradas, omite la línea de inasistencia en vez de mostrar un 0% falso", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ completadas: 0, noShow: 0 }),
    anterior: null,
  });
  assert.doesNotMatch(t, /Inasistencia/);
});

test("sin seguimientos enviados, omite reactivados", () => {
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ seguimientosEnviados: 0, reactivados: 0 }),
    anterior: null,
  });
  assert.doesNotMatch(t, /Reactivados/);
});

test("⭐ inasistencia solo compara contra un anterior que TAMBIÉN tuvo citas cerradas", () => {
  // Si el mes anterior no cerró ninguna cita, comparar el % actual contra un
  // "0%" que en realidad es "no hay dato" mentiría igual que no comparar nada.
  const t = textoInformeFidelizacion({
    ...BASE,
    actual: fid({ completadas: 5, noShow: 1, porcentajeNoShow: 17 }),
    anterior: fid({ completadas: 0, noShow: 0, porcentajeNoShow: 0 }),
  });
  const lineaInasistencia = t.split("\n").find((l) => l.startsWith("Inasistencia"));
  assert.ok(lineaInasistencia, "la línea debe existir (el actual sí cerró citas)");
  assert.doesNotMatch(lineaInasistencia, /vs\. período anterior/);
});

test("el texto nunca queda vacío y siempre trae el negocio y el período", () => {
  const t = textoInformeFidelizacion({ ...BASE, actual: fid(), anterior: fid() });
  assert.ok(t.length > 20);
  assert.match(t, /RS-Shop/);
  assert.match(t, /agosto 2026/);
});
