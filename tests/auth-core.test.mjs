import assert from "node:assert/strict";
import test from "node:test";
import { correoVerificadoDeSesion } from "../lib/authCore.ts";

test("solo una sesión con correo confirmado se traduce a usuario del portal (Fase 0)", () => {
  assert.equal(correoVerificadoDeSesion({ email: " Dueno@Negocio.cl ", email_confirmed_at: "2026-09-01T00:00:00Z" }), "dueno@negocio.cl");
  assert.equal(correoVerificadoDeSesion({ email: "x@y.cl", confirmed_at: "2026-09-01T00:00:00Z" }), "x@y.cl");
  assert.equal(correoVerificadoDeSesion({ email: "victima@negocio.cl", email_confirmed_at: null }), null, "signUp sin confirmar no entra");
  assert.equal(correoVerificadoDeSesion(null), null);
  assert.equal(correoVerificadoDeSesion({ email: "", email_confirmed_at: "2026" }), null);
});
