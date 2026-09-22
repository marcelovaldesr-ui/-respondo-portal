/**
 * ORÍGENES CONFIABLES (Fase 1): canónico + lista explícita, sin comodines,
 * localhost solo fuera de producción.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ORIGEN_POR_DEFECTO,
  esOrigenConfiable,
  esOrigenFacebook,
  normalizarOrigen,
  origenCanonico,
  origenParaEnlace,
  origenesConfiables,
  peticionDelPortal,
  urlPortal,
} from "../lib/origenes.ts";

const PROD = { NEXT_PUBLIC_SITE_URL: "https://respondo-portal.vercel.app", NODE_ENV: "production" };

test("normalizar: solo orígenes exactos", () => {
  assert.equal(normalizarOrigen("https://portal.respon-do.com/"), "https://portal.respon-do.com");
  assert.equal(normalizarOrigen("https://*.vercel.app"), null);
  assert.equal(normalizarOrigen("https://portal.respon-do.com/login"), null);
  assert.equal(normalizarOrigen("http://portal.respon-do.com"), null);
  assert.equal(normalizarOrigen("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizarOrigen("https://user:pw@portal.respon-do.com"), null);
  assert.equal(normalizarOrigen("javascript:alert(1)"), null);
  assert.equal(normalizarOrigen(""), null);
});

test("canónico: variable o respaldo; localhost nunca en producción", () => {
  assert.equal(origenCanonico(PROD), "https://respondo-portal.vercel.app");
  assert.equal(origenCanonico({ NODE_ENV: "production" }), ORIGEN_POR_DEFECTO);
  assert.equal(origenCanonico({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NODE_ENV: "production" }), ORIGEN_POR_DEFECTO);
  assert.equal(origenCanonico({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NODE_ENV: "development" }), "http://localhost:3000");
  assert.equal(urlPortal("/reservar/x", PROD), "https://respondo-portal.vercel.app/reservar/x");
});

test("previews y copias no son confiables; staging explícito sí", () => {
  const env = { ...PROD, NEXT_PUBLIC_ORIGENES_PERMITIDOS: "https://staging.respon-do.com, https://*.vercel.app, http://localhost:3000" };
  assert.deepEqual(origenesConfiables(env), ["https://respondo-portal.vercel.app", "https://staging.respon-do.com"]);
  assert.equal(esOrigenConfiable("https://respondo-portal-git-rama-marcelo.vercel.app", env), false);
  assert.equal(esOrigenConfiable("https://staging.respon-do.com", env), true);
  assert.equal(esOrigenConfiable("http://localhost:3000", env), false, "localhost no vale en un build de producción");
  assert.equal(esOrigenConfiable("http://localhost:3000", { ...env, NODE_ENV: "development" }), true);
});

test("enlace de login: vuelve al origen solo si es confiable", () => {
  assert.equal(origenParaEnlace("https://respondo-portal.vercel.app", PROD), "https://respondo-portal.vercel.app");
  assert.equal(origenParaEnlace("https://copia-maliciosa.vercel.app", PROD), "https://respondo-portal.vercel.app");
  assert.equal(origenParaEnlace("http://localhost:3000", { ...PROD, NODE_ENV: "development" }), "http://localhost:3000");
});

test("petición del portal: mismo origen o confiable; cruzada no", () => {
  const req = (h) => ({ url: "https://respondo-portal.vercel.app/auth/salir", headers: { get: (n) => h[n] ?? null } });
  assert.equal(peticionDelPortal(req({ origin: "https://respondo-portal.vercel.app" }), PROD), true);
  assert.equal(peticionDelPortal(req({ origin: "https://evil.example" }), PROD), false);
  assert.equal(peticionDelPortal(req({ origin: "null" }), PROD), false);
  assert.equal(peticionDelPortal(req({ "sec-fetch-site": "cross-site" }), PROD), false);
  assert.equal(peticionDelPortal(req({ "sec-fetch-site": "same-origin" }), PROD), true);
  assert.equal(peticionDelPortal(req({}), PROD), true);
});

test("Facebook: dominio exacto, no sufijo suelto", () => {
  assert.equal(esOrigenFacebook("https://www.facebook.com"), true);
  assert.equal(esOrigenFacebook("https://facebook.com"), true);
  assert.equal(esOrigenFacebook("https://evilfacebook.com"), false);
  assert.equal(esOrigenFacebook("http://www.facebook.com"), false);
});
