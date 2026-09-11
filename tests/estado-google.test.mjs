/**
 * GOOGLE CALENDAR: EL ESTADO DICE LO QUE RESPONDIÓ GOOGLE (Fase 0).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { estadoConexionGoogle, ERROR_TOKEN_ILEGIBLE, errorLimpiablePorLectura } from "../lib/estadoGoogleCore.ts";

test("credenciales + interruptor sin errores = Conectado; con errores, NO", () => {
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: null }).estado, "conectado");
  const apagado = estadoConexionGoogle({ gcal_sync: false, gcal_ultimo_error: "Ese calendario ya está conectado en otra cuenta" });
  assert.equal(apagado.estado, "desconectado");
  assert.match(apagado.detalle, /otra cuenta/, "el motivo se muestra aunque no sincronice");
});

test("token revocado / ilegible → Necesita reconexión", () => {
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: "oauth: Token has been expired or revoked." }).estado, "necesita_reconexion");
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: "oauth: invalid_grant" }).estado, "necesita_reconexion");
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: ERROR_TOKEN_ILEGIBLE }).estado, "necesita_reconexion");
});

test("permisos o calendario no compartido → Error de acceso; red → Con errores", () => {
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: "no se pudo leer tu disponibilidad: Request had insufficient authentication scopes." }).estado, "error_acceso");
  assert.equal(estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: "sin acceso al calendario (notFound)" }).estado, "error_acceso");
  const red = estadoConexionGoogle({ gcal_sync: true, gcal_ultimo_error: "no se pudo leer tu disponibilidad: The operation was aborted due to timeout" });
  assert.equal(red.estado, "error");
  assert.match(red.detalle, /timeout/);
});

test("una lectura exitosa solo limpia errores de lectura, no los de escritura", () => {
  assert.equal(errorLimpiablePorLectura("no se pudo leer tu disponibilidad: timeout"), true);
  assert.equal(errorLimpiablePorLectura("oauth: invalid_grant"), true);
  assert.equal(errorLimpiablePorLectura("You need to have writer access to this calendar."), false);
  assert.equal(errorLimpiablePorLectura(null), false);
});
