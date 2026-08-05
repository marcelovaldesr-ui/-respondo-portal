import assert from "node:assert/strict";
import test from "node:test";

import { tienePermiso } from "../lib/permisos.ts";

test("el dueño conserva todas las capacidades", () => {
  for (const permiso of [
    "operar_conversaciones",
    "editar_clientes",
    "gestionar_embudo",
    "operar_agenda",
    "configurar_agenda",
    "editar_conocimiento",
    "generar_insights",
    "gestionar_integraciones",
  ]) {
    assert.equal(tienePermiso({ rol: "dueno" }, permiso), true);
  }
});

test("staff opera clientes y agenda sin administrar configuración", () => {
  assert.equal(tienePermiso({ rol: "staff" }, "operar_conversaciones"), true);
  assert.equal(tienePermiso({ rol: "staff" }, "editar_clientes"), true);
  assert.equal(tienePermiso({ rol: "staff" }, "operar_agenda"), true);
  assert.equal(tienePermiso({ rol: "staff" }, "configurar_agenda"), false);
  assert.equal(tienePermiso({ rol: "staff" }, "editar_conocimiento"), false);
  assert.equal(tienePermiso({ rol: "staff" }, "gestionar_integraciones"), false);
});
