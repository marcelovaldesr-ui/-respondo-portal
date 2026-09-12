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

// ─── Fase 1: cierre de sesión y equipos compartidos ─────────────────────────
import { decidirSincronizacion, huellaEndpoint, borrarSuscripcionPorHuella } from "../lib/push.ts";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

test("re-sincronizar no traspasa la suscripción de otra cuenta", () => {
  const yo = { email: "Ana@neg.cl", clienteId: "c1" };
  assert.equal(decidirSincronizacion({ email: "ana@neg.cl", cliente_id: "c1" }, yo), "propia");
  assert.equal(decidirSincronizacion({ email: "pedro@neg.cl", cliente_id: "c1" }, yo), "ajena");
  assert.equal(decidirSincronizacion({ email: "ana@neg.cl", cliente_id: "c2" }, yo), "ajena", "misma persona, otro negocio");
  assert.equal(decidirSincronizacion(null, yo), "sin_registro");
});

test("al salir se borra SOLO la suscripción de este navegador y de esta cuenta", async () => {
  const supa = crearBaseMemoria({
    ed_push_suscripciones: [
      { id: "a", cliente_id: "c1", email: "ana@neg.cl", endpoint: "https://push/este" },
      { id: "b", cliente_id: "c1", email: "ana@neg.cl", endpoint: "https://push/telefono" },
      { id: "c", cliente_id: "c2", email: "ana@neg.cl", endpoint: "https://push/este" },
    ],
  });
  const n = await borrarSuscripcionPorHuella(supa, { email: "ana@neg.cl", clienteId: "c1" }, huellaEndpoint("https://push/este"));
  assert.equal(n, 1);
  assert.deepEqual(supa.tablas.ed_push_suscripciones.map((f) => f.id), ["b", "c"]);
  assert.equal(await borrarSuscripcionPorHuella(supa, { email: "ana@neg.cl", clienteId: "c1" }, "no-es-hex"), 0);
});
