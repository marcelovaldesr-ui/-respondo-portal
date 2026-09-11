/**
 * AVISOS PUSH SOLO A USUARIOS VIGENTES DEL NEGOCIO (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { suscripcionesVigentes, sujetoVapid } from "../lib/push.ts";

test("un usuario dado de baja (o de otro negocio) no recibe avisos", () => {
  const subs = [
    { id: "1", email: "Activa@neg.cl" },
    { id: "2", email: "despedido@neg.cl" },
    { id: "3", email: null },
  ];
  assert.deepEqual(suscripcionesVigentes(subs, [{ email: "activa@neg.cl " }]).map((s) => s.id), ["1"]);
  assert.deepEqual(suscripcionesVigentes(subs, []), []);
});

test("VAPID_SUBJECT: un correo sin mailto: se corrige en vez de apagar todos los avisos", () => {
  assert.equal(sujetoVapid("hola@negocio.cl"), "mailto:hola@negocio.cl");
  assert.equal(sujetoVapid("  hola@negocio.cl \n"), "mailto:hola@negocio.cl");
  assert.equal(sujetoVapid("mailto:hola@negocio.cl"), "mailto:hola@negocio.cl");
  assert.equal(sujetoVapid("https://respondo-portal.vercel.app"), "https://respondo-portal.vercel.app");
  assert.equal(sujetoVapid(""), "mailto:hola@respon-do.com");
  assert.equal(sujetoVapid(undefined), "mailto:hola@respon-do.com");
  assert.equal(sujetoVapid("Respondo <hola@negocio.cl>"), "mailto:hola@respon-do.com");
  assert.equal(sujetoVapid("http://inseguro.cl"), "mailto:hola@respon-do.com");
});
