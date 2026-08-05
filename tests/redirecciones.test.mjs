import assert from "node:assert/strict";
import test from "node:test";

import { rutaInterna } from "../lib/redirecciones.ts";

test("conserva rutas locales y sus parámetros", () => {
  assert.equal(rutaInterna("/agenda?dia=hoy"), "/agenda?dia=hoy");
});

test("rechaza URL externa, protocol-relative y backslashes", () => {
  assert.equal(rutaInterna("https://evil.example"), "/inicio");
  assert.equal(rutaInterna("//evil.example/ruta"), "/inicio");
  assert.equal(rutaInterna("/\\evil.example"), "/inicio");
});
