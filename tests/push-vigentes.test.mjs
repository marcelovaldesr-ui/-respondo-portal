/**
 * AVISOS PUSH SOLO A USUARIOS VIGENTES DEL NEGOCIO (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { suscripcionesVigentes } from "../lib/push.ts";

test("un usuario dado de baja (o de otro negocio) no recibe avisos", () => {
  const subs = [
    { id: "1", email: "Activa@neg.cl" },
    { id: "2", email: "despedido@neg.cl" },
    { id: "3", email: null },
  ];
  assert.deepEqual(suscripcionesVigentes(subs, [{ email: "activa@neg.cl " }]).map((s) => s.id), ["1"]);
  assert.deepEqual(suscripcionesVigentes(subs, []), []);
});
