/**
 * GOOGLE CALENDAR (OAuth): un fallo real queda anotado, un token ilegible
 * también, y el siguiente éxito limpia el error. Sin red: fetch falso.
 *
 * (Fase 2) Además de anotar el error, ahora se DEVUELVE a quién no se pudo
 * comprobar: sus horas no se ofrecen en público. Antes esta prueba fijaba el
 * fail-open —«la agenda sigue ofreciendo horas»— que es justo lo que producía
 * dobles reservas encima del calendario personal del dueño.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-solo-para-tests";
process.env.GOOGLE_OAUTH_CLIENT_ID = "id-test";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secreto-test";
const { cifrarRefreshToken } = await import("../lib/googleOAuth.ts");
const { ocupadosDesdeGoogle } = await import("../lib/agendaGoogle.ts");
const { ERROR_TOKEN_ILEGIBLE, estadoConexionGoogle } = await import("../lib/estadoGoogleCore.ts");

function base() {
  return crearBaseMemoria({
    ed_profesionales: [
      { id: "p1", cliente_id: "c1", gcal_sync: true, gcal_modo: "oauth", gcal_oauth_refresh_cifrado: cifrarRefreshToken("refresh-1"), gcal_ultimo_error: null, gcal_id: null },
      { id: "p2", cliente_id: "c1", gcal_sync: true, gcal_modo: "oauth", gcal_oauth_refresh_cifrado: "basura.que.no.descifra", gcal_ultimo_error: null, gcal_id: null },
    ],
  });
}

async function conFetch(respuestas, fn) {
  const original = globalThis.fetch;
  const errorOriginal = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const r = respuestas(String(url));
    return new Response(JSON.stringify(r.json), { status: r.status });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    console.error = errorOriginal;
  }
}

test("freeBusy sin permiso → error anotado y estado 'Error de acceso'; token ilegible → 'Necesita reconexión'", async () => {
  const supa = base();
  const ocupados = await conFetch(
    (url) =>
      url.includes("oauth2.googleapis.com/token")
        ? { status: 200, json: { access_token: "at" } }
        : { status: 403, json: { error: { message: "Request had insufficient authentication scopes." } } },
    () => ocupadosDesdeGoogle(["p1", "p2"], "2026-09-11T00:00:00Z", "2026-09-12T00:00:00Z", supa),
  );
  assert.deepEqual(ocupados.ocupados, [], "sin datos de Google no hay ocupaciones que reportar");
  assert.deepEqual(
    ocupados.noVerificables.slice().sort(),
    ["p1", "p2"],
    "los dos quedan sin verificar: uno por permiso, otro por token ilegible",
  );
  const [p1, p2] = supa.tablas.ed_profesionales;
  assert.match(p1.gcal_ultimo_error, /insufficient/);
  assert.equal(estadoConexionGoogle(p1).estado, "error_acceso");
  assert.equal(p2.gcal_ultimo_error, ERROR_TOKEN_ILEGIBLE);
  assert.equal(estadoConexionGoogle(p2).estado, "necesita_reconexion");
});

test("cuando Google vuelve a responder bien, el error viejo de LECTURA se limpia (uno de escritura no)", async () => {
  const supa = base();
  supa.tablas.ed_profesionales[0].gcal_ultimo_error = "no se pudo leer tu disponibilidad: timeout";
  const ocupados = await conFetch(
    (url) =>
      url.includes("oauth2.googleapis.com/token")
        ? { status: 200, json: { access_token: "at" } }
        : { status: 200, json: { calendars: { primary: { busy: [{ start: "2026-09-11T13:00:00Z", end: "2026-09-11T14:00:00Z" }] } } } },
    () => ocupadosDesdeGoogle(["p1"], "2026-09-11T00:00:00Z", "2026-09-12T00:00:00Z", supa),
  );
  assert.equal(ocupados.ocupados.length, 1);
  assert.deepEqual(ocupados.noVerificables, [], "verificado: sus horas sí se pueden ofrecer");
  assert.equal(supa.tablas.ed_profesionales[0].gcal_ultimo_error, null);
  assert.equal(estadoConexionGoogle(supa.tablas.ed_profesionales[0]).estado, "conectado");

  const supa2 = base();
  supa2.tablas.ed_profesionales[0].gcal_ultimo_error = "You need to have writer access to this calendar.";
  await conFetch(
    (url) => (url.includes("oauth2.googleapis.com/token") ? { status: 200, json: { access_token: "at" } } : { status: 200, json: { calendars: { primary: { busy: [] } } } }),
    () => ocupadosDesdeGoogle(["p1"], "2026-09-11T00:00:00Z", "2026-09-12T00:00:00Z", supa2),
  );
  assert.match(supa2.tablas.ed_profesionales[0].gcal_ultimo_error, /writer access/);
});
