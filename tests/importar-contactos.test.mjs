import assert from "node:assert/strict";
import test from "node:test";

import {
  parsearCsv,
  detectarColumnas,
  normalizarTelefono,
  motivoTelefono,
  parsearFecha,
  prolijarNombre,
  importarDesdeCsv,
} from "../lib/importarContactos.ts";

/**
 * Importador de la lista de clientes.
 *
 * Lo que se prueba acá no es el "camino feliz" sino el archivo real que manda
 * un negocio: teléfonos fijos mezclados, fechas en dd/mm/aaaa, nombres en
 * mayúsculas con la coma del apellido, filas vacías al final y el mismo cliente
 * repetido con dos visitas.
 *
 * El criterio de todo el archivo: ante la duda se descarta y se informa. Un
 * mensaje que no sale es un problema; un mensaje que sale al número equivocado
 * con el nombre de otra persona es otra cosa.
 */

test("normaliza los formatos de celular chileno que sí se pueden reconocer", () => {
  assert.equal(normalizarTelefono("+56 9 8576 1941"), "56985761941");
  assert.equal(normalizarTelefono("9 8576 1941"), "56985761941");
  assert.equal(normalizarTelefono("56985761941"), "56985761941");
  assert.equal(normalizarTelefono("0056985761941"), "56985761941");
  assert.equal(normalizarTelefono("  +56985761941  "), "56985761941");
});

test("rechaza lo que no puede reconocer sin adivinar", () => {
  assert.equal(normalizarTelefono("42 252 4930"), null, "un fijo no sirve para WhatsApp");
  assert.equal(normalizarTelefono("85761941"), null, "8 dígitos: podría faltarle el 9 o ser un fijo");
  assert.equal(normalizarTelefono(""), null);
  assert.equal(normalizarTelefono("no tiene"), null);
});

test("el motivo del rechazo dice qué revisar", () => {
  assert.match(motivoTelefono("85761941"), /9 inicial/);
  assert.match(motivoTelefono("42 252 4930"), /celular/);
  assert.match(motivoTelefono(""), /sin teléfono/);
});

test("fechas en los formatos que llegan de verdad", () => {
  assert.equal(parsearFecha("03/04/2026"), "2026-04-03", "en Chile es 3 de abril");
  assert.equal(parsearFecha("3-4-2026"), "2026-04-03");
  assert.equal(parsearFecha("2026-04-03"), "2026-04-03");
  assert.equal(parsearFecha("03/04/26"), "2026-04-03");
  assert.equal(parsearFecha("45000"), "2023-03-15", "serial de Excel");
});

test("rechaza fechas imposibles en vez de correrlas al mes siguiente", () => {
  assert.equal(parsearFecha("31/02/2026"), null);
  assert.equal(parsearFecha("13/13/2026"), null);
  assert.equal(parsearFecha("ayer"), null);
  assert.equal(parsearFecha(""), null);
});

test("el CSV no se parte con una coma dentro de comillas", () => {
  const filas = parsearCsv('nombre,fono\n"Pérez, Juan",+56985761941\n');
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[1], ["Pérez, Juan", "+56985761941"]);
});

test("detecta el punto y coma que usa Excel en español", () => {
  const filas = parsearCsv("nombre;fono\nJuan;+56985761941\n");
  assert.deepEqual(filas[1], ["Juan", "+56985761941"]);
});

test("reconoce las columnas aunque el negocio las llame como quiera", () => {
  const col = detectarColumnas([
    "Nombre Cliente",
    "N° de contacto",
    "Moto Modelo",
    "Fecha última atención",
    "Trabajo realizado",
    "KM",
  ]);
  assert.equal(col.nombre, "Nombre Cliente");
  assert.equal(col.telefono, "N° de contacto");
  assert.equal(col.vehiculo, "Moto Modelo");
  assert.equal(col.ultimaAtencion, "Fecha última atención");
  assert.equal(col.ultimoTrabajo, "Trabajo realizado");
  assert.equal(col.kilometraje, "KM");
});

test("'fecha de nacimiento' no se roba la última atención", () => {
  // Sin la lista de exclusión, Beto calcularía la mantención sobre el
  // cumpleaños del cliente y le escribiría a medio padrón.
  const col = detectarColumnas(["Nombre", "Fono", "Fecha de nacimiento"]);
  assert.equal(col.ultimaAtencion, null);
});

test("importa un archivo real con basura mezclada", () => {
  const csv = [
    "Nombre;Teléfono;Moto;Fecha última atención;Trabajo realizado",
    "PEREZ GONZALEZ, JUAN;+56 9 8576 1941;KTM 390 Duke 2023;03/04/2026;Mantención 10.000 km",
    "Ana Silva;9 1234 5678;Husqvarna 701;15/01/2026;Cambio de aceite",
    "Local Chillán;42 252 4930;;01/01/2026;",
    "Sin Fono;;;;",
    "Juan Perez;+56 9 8576 1941;KTM 390 Duke 2023;20/06/2026;Cambio de neumáticos",
    ";;;;",
  ].join("\n");

  const r = importarDesdeCsv(csv);

  assert.equal(r.contactos.length, 2, "solo dos teléfonos son usables");
  assert.equal(r.descartadas.length, 2, "el fijo y la fila sin teléfono");

  const juan = r.contactos.find((c) => c.chatId === "56985761941");
  assert.ok(juan);
  assert.equal(juan.ultimaAtencion, "2026-06-20", "el duplicado se queda con la visita más nueva");
  assert.equal(juan.datos.vehiculo, "KTM 390 Duke 2023");
  assert.equal(juan.telefono, "+56985761941");

  for (const d of r.descartadas) {
    assert.ok(d.motivo.length > 5, "cada descarte tiene que explicar por qué");
  }
});

test("los nombres gritados quedan legibles", () => {
  assert.equal(prolijarNombre("PEREZ GONZALEZ, JUAN CARLOS"), "Juan Carlos Perez Gonzalez");
  assert.equal(prolijarNombre("Ana Silva"), "Ana Silva", "no toca lo que ya estaba bien");
  assert.equal(prolijarNombre("  juan   perez  "), "juan perez");
});

test("un archivo sin filas no revienta", () => {
  assert.deepEqual(importarDesdeCsv("").contactos, []);
  assert.deepEqual(importarDesdeCsv("nombre;fono").contactos, []);
});
