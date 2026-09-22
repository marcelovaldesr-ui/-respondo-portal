import assert from "node:assert/strict";
import test from "node:test";

import {
  traducirErrorGoogleMutate,
  linkGoogleAds,
} from "../lib/ads/googlePublicar.ts";
import {
  generarClaveIdempotencia,
  verificarIdempotencia,
  registrarInicioPublicacion,
  registrarFinPublicacion,
  limpiarIdempotencia,
  sanitizarMensajeError,
} from "../lib/ads/publicacion.ts";

test("traducirErrorGoogleMutate: error de ACCESS_LEVEL se traduce a nivel de acceso del proyecto Cloud", () => {
  const errorCrudo = {
    error: {
      code: 403,
      message: "The developer token is not approved. ACCESS_LEVEL_ERROR: TEST_ONLY",
      status: "PERMISSION_DENIED",
    },
  };

  const falla = traducirErrorGoogleMutate(403, errorCrudo);
  assert.equal(falla.codigo, "GOOGLE_NIVEL_ACCESO");
  assert.ok(falla.mensaje.includes("nivel de acceso de prueba"));
  assert.ok(falla.accionSugerida?.includes("Google Cloud"));
});

test("traducirErrorGoogleMutate: error de longitud de texto se traduce claramente", () => {
  const errorCrudo = {
    error: {
      code: 400,
      message: "Headline: STRING_LENGTH_TOO_LONG. Maximum is 30 characters.",
    },
  };

  const falla = traducirErrorGoogleMutate(400, errorCrudo);
  assert.equal(falla.codigo, "GOOGLE_LONGITUD_TEXTO");
  assert.ok(falla.mensaje.includes("30 caracteres"));
});

test("traducirErrorGoogleMutate: error de permiso denegado en la cuenta", () => {
  const errorCrudo = {
    error: {
      code: 403,
      message: "USER_PERMISSION_DENIED: User does not have access to this customer.",
    },
  };

  const falla = traducirErrorGoogleMutate(403, errorCrudo);
  assert.equal(falla.codigo, "GOOGLE_PERMISO_DENEGADO");
  assert.ok(falla.mensaje.includes("permisos de administrador o edición"));
});

test("linkGoogleAds: limpia caracteres no numéricos y genera link correcto", () => {
  const url = linkGoogleAds("123-456-7890", "999888777");
  assert.equal(url, "https://ads.google.com/aw/campaigns?campaignId=999888777&ocid=1234567890");

  const urlOverview = linkGoogleAds("123-456-7890");
  assert.equal(urlOverview, "https://ads.google.com/aw/overview?ocid=1234567890");
});

test("sanitizarMensajeError: nunca expone refresh tokens de Google ni secrets", () => {
  const texto = 'Failed with refresh_token 1//0gD7asfd_9123-asdf and clientSecret: "super_secret"';
  const limpio = sanitizarMensajeError(texto);

  assert.ok(!limpio.includes("1//0gD7asfd_9123-asdf"));
  assert.ok(!limpio.includes("super_secret"));
  assert.ok(limpio.includes("[REDACTED_GOOGLE_TOKEN]") || limpio.includes("[REDACTED]"));
});

test("idempotencia Google: almacena y recupera estado de publicación para Google Ads", () => {
  limpiarIdempotencia();

  const clienteId = "cliente-google-uuid";
  const borradorId = "borrador-google-uuid";
  const clave = generarClaveIdempotencia(clienteId, borradorId, "google");

  registrarInicioPublicacion(clave);
  assert.equal(verificarIdempotencia(clave).enProgreso, true);

  const resGoogle = {
    ok: true,
    plataforma: "google",
    clienteId,
    cuentaId: "1234567890",
    campaignId: "goog_camp_111",
    adGroupOrAdSetId: "goog_group_222",
    status: "pausada",
    createdAt: new Date().toISOString(),
    idempotencyKey: clave,
    mensaje: "Creada con éxito en Google Ads",
  };

  registrarFinPublicacion(clave, resGoogle);
  const check = verificarIdempotencia(clave);
  assert.equal(check.enProgreso, false);
  assert.equal(check.resultado?.campaignId, "goog_camp_111");
  assert.equal(check.resultado?.plataforma, "google");
});

test("publicarCampanaEnGoogle: rechaza presupuesto <= 0 sin hacer llamadas", async () => {
  const { publicarCampanaEnGoogle } = await import("../lib/ads/googlePublicar.ts");
  limpiarIdempotencia();

  const res = await publicarCampanaEnGoogle({
    clienteId: "00000000-0000-0000-0000-000000000000",
    borradorId: "borrador-test",
    nombre: "Test Google",
    presupuestoDiario: 0,
    moneda: "CLP",
    urlFinal: "https://respon-do.com",
    palabrasClave: [{ texto: "impresion", concordancia: "frase" }],
    titulares: ["Impresión rápida", "Calidad garantizada", "Cotiza hoy"],
    descripciones: ["Servicio profesional", "Contáctanos"],
  });

  assert.equal(res.ok, false);
  assert.ok(res.mensaje.includes("presupuesto diario debe ser mayor a 0"));
});

