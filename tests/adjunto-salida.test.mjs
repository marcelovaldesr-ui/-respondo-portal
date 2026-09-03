import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMAGEN_META_BYTES,
  MAX_SALIDA_BYTES,
  nombreSeguroSalida,
  revisarAdjuntoSalida,
} from "../lib/adjuntoSalida.ts";

/**
 * Este archivo decide si algo que llegó del navegador se manda al WhatsApp de un
 * cliente real. Equivocarse acá no es un bug de interfaz: es mandarle basura a
 * alguien desde el número del negocio — y WhatsApp suspende números por eso.
 */

const jpeg = (extra = 0) => new Uint8Array([0xff, 0xd8, 0xff, ...new Array(extra).fill(0)]);
const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const pdf = () => new Uint8Array([...Buffer.from("%PDF-1.7")]);
const webp = () =>
  new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);

test("acepta los formatos que sabemos enviar y mostrar de vuelta", () => {
  for (const [bytes, mime] of [
    [jpeg(20), "image/jpeg"],
    [png(), "image/png"],
    [webp(), "image/webp"],
    [pdf(), "application/pdf"],
  ]) {
    const r = revisarAdjuntoSalida({ bytes, mime, nombre: "foto" });
    assert.equal(r.ok, true, `${mime} debería aceptarse`);
  }
});

test("RECHAZA un ejecutable disfrazado de imagen", () => {
  // El caso que importa: el `Content-Type` lo escribe el navegador y se puede
  // falsear. Lo único confiable es el comienzo del binario.
  const mz = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]); // cabecera de .exe
  const r = revisarAdjuntoSalida({ bytes: mz, mime: "image/jpeg", nombre: "gato.jpg" });
  assert.equal(r.ok, false);
  assert.match(r.error, /no coincide/i);
});

test("rechaza tipos que no están en la lista blanca", () => {
  const r = revisarAdjuntoSalida({
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    mime: "application/zip",
    nombre: "cosas.zip",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /imágenes|PDF/i);
});

test("rechaza el archivo vacío con un mensaje que se entiende", () => {
  const r = revisarAdjuntoSalida({ bytes: new Uint8Array(), mime: "image/png", nombre: "x.png" });
  assert.equal(r.ok, false);
  assert.match(r.error, /vacío/i);
});

test("rechaza lo que supera el tope, diciendo el tope", () => {
  const grande = new Uint8Array(MAX_SALIDA_BYTES + 1);
  grande.set([0xff, 0xd8, 0xff]);
  const r = revisarAdjuntoSalida({ bytes: grande, mime: "image/jpeg", nombre: "enorme.jpg" });
  assert.equal(r.ok, false);
  assert.match(r.error, /16 MB/);
});

test("el mime con parámetros igual se reconoce", () => {
  // Los navegadores mandan cosas como "image/jpeg; charset=binary".
  const r = revisarAdjuntoSalida({ bytes: jpeg(10), mime: "image/JPEG; charset=binary", nombre: "a.jpg" });
  assert.equal(r.ok, true);
  assert.equal(r.mime, "image/jpeg");
});

test("distingue imagen de documento (cambia cómo lo ve el cliente)", () => {
  // Mandar una foto como documento es válido para Meta y se ve mal: aparece
  // como archivo adjunto en vez de mostrarse en la conversación.
  assert.equal(revisarAdjuntoSalida({ bytes: jpeg(5), mime: "image/jpeg", nombre: "f.jpg" }).esImagen, true);
  assert.equal(revisarAdjuntoSalida({ bytes: pdf(), mime: "application/pdf", nombre: "d.pdf" }).esImagen, false);
});

test("el nombre del archivo se sanea: viaja al teléfono de una persona", () => {
  assert.equal(nombreSeguroSalida("../../etc/passwd"), "passwd");
  assert.equal(nombreSeguroSalida("C:\\\\Users\\\\marce\\\\foto.png"), "foto.png");
  assert.equal(nombreSeguroSalida(""), "archivo");
  assert.equal(nombreSeguroSalida("   "), "archivo");
  assert.ok(nombreSeguroSalida("a".repeat(500)).length <= 80);
  // Los ESPACIOS se conservan: son normales en un nombre de archivo y quitarlos
  // haría que al cliente le llegue "Cotizacion_final.pdf" cuando el negocio la
  // guardó como "Cotización final". Lo que se reemplaza es el acento, que es lo
  // que rompe en algunos sistemas.
  assert.equal(nombreSeguroSalida("Cotización final-2.pdf"), "Cotizaci_n final-2.pdf");
});

test("por Meta solo JPEG/PNG de hasta 5 MB van como imagen; el resto, como documento", () => {
  // Meta rechaza WEBP/GIF con type:"image" y fotos de más de 5 MB. Antes se
  // mandaba todo como imagen y el archivo "salía" pero no llegaba.
  assert.equal(revisarAdjuntoSalida({ bytes: jpeg(5), mime: "image/jpeg", nombre: "f.jpg" }).imagenParaMeta, true);
  assert.equal(revisarAdjuntoSalida({ bytes: png(), mime: "image/png", nombre: "f.png" }).imagenParaMeta, true);
  const w = revisarAdjuntoSalida({ bytes: webp(), mime: "image/webp", nombre: "s.webp" });
  assert.equal(w.esImagen, true);
  assert.equal(w.imagenParaMeta, false);
  const grande = new Uint8Array(MAX_IMAGEN_META_BYTES + 1);
  grande.set([0xff, 0xd8, 0xff]);
  const g = revisarAdjuntoSalida({ bytes: grande, mime: "image/jpeg", nombre: "enorme.jpg" });
  assert.equal(g.ok, true, "sigue siendo válido: va como documento");
  assert.equal(g.imagenParaMeta, false);
  assert.equal(revisarAdjuntoSalida({ bytes: pdf(), mime: "application/pdf", nombre: "d.pdf" }).imagenParaMeta, false);
});
