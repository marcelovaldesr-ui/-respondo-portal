import assert from "node:assert/strict";
import test from "node:test";

import { validarArchivoBase64 } from "../lib/archivos.ts";

test("acepta firmas reales de formatos permitidos", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const pdf = Buffer.from("%PDF-1.7\ncontenido", "ascii");
  assert.equal(validarArchivoBase64(png.toString("base64"), "image/png").ok, true);
  assert.equal(validarArchivoBase64(pdf.toString("base64"), "application/pdf").ok, true);
});

test("rechaza MIME falsificado y base64 incompleto", () => {
  const ejecutable = Buffer.from("MZprograma", "ascii").toString("base64");
  assert.equal(validarArchivoBase64(ejecutable, "image/jpeg").ok, false);
  assert.equal(validarArchivoBase64("%%%", "application/pdf").ok, false);
  assert.equal(validarArchivoBase64(Buffer.from("%PDF-x").toString("base64"), "text/html").ok, false);
});
