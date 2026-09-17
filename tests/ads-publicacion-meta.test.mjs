import assert from "node:assert/strict";
import test from "node:test";

import {
  traducirErrorMeta,
  linkMetaAdsManager,
} from "../lib/ads/metaPublicar.ts";
import {
  generarClaveIdempotencia,
  verificarIdempotencia,
  registrarInicioPublicacion,
  registrarFinPublicacion,
  limpiarIdempotencia,
  sanitizarMensajeError,
} from "../lib/ads/publicacion.ts";

test("traducirErrorMeta: error 100 subcode 33 se traduce a permiso faltante de ads_management", () => {
  const errorCrudo = {
    error: {
      message:
        "Unsupported post request. Object with ID 'act_1625722292606602' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
      type: "GraphMethodException",
      code: 100,
      error_subcode: 33,
      fbtrace_id: "A3PIUVy0NVNbmk43K_TgJ1W",
    },
  };

  const falla = traducirErrorMeta(400, errorCrudo);
  assert.equal(falla.codigo, "META_PERMISO_FALTANTE");
  assert.equal(falla.tipo, "permiso");
  assert.ok(falla.mensaje.includes("ads_management"), "debe mencionar ads_management");
  assert.ok(falla.accionSugerida?.length, "debe sugerir acción concreta");
});

test("traducirErrorMeta: error 190 se traduce a token expirado/reconectar", () => {
  const errorCrudo = {
    error: {
      message: "Error validating access token: Session has expired on...",
      type: "OAuthException",
      code: 190,
    },
  };

  const falla = traducirErrorMeta(401, errorCrudo);
  assert.equal(falla.codigo, "META_TOKEN_EXPIRADO");
  assert.ok(falla.mensaje.includes("expirado o fue revocado"));
});

test("traducirErrorMeta: error de página faltante se detecta claramente", () => {
  const errorCrudo = {
    error: {
      message: "Invalid parameter: Page is required to represent the business on Instagram.",
      code: 100,
    },
  };

  const falla = traducirErrorMeta(400, errorCrudo);
  assert.equal(falla.codigo, "META_PAGINA_FALTANTE");
  assert.ok(falla.mensaje.includes("Página de Facebook comercial"));
});

test("sanitizarMensajeError: nunca expone tokens reales de Meta ni Bearer headers", () => {
  const textoConToken =
    "Error with token EAABwzL1380ABA... in Authorization: Bearer EAABwzL1380ABAdsaf8923 and client_secret=super_secret_123";
  const saneado = sanitizarMensajeError(textoConToken);

  assert.ok(!saneado.includes("EAABwzL1380ABAdsaf8923"), "no debe contener el token completo");
  assert.ok(!saneado.includes("super_secret_123"), "no debe contener el client secret");
  assert.ok(saneado.includes("[REDACTED_META_TOKEN]") || saneado.includes("[REDACTED]"));
});

test("idempotencia: previene doble mutación y devuelve resultado existente", () => {
  limpiarIdempotencia();

  const clienteId = "cliente-test-uuid";
  const borradorId = "borrador-test-uuid";
  const clave = generarClaveIdempotencia(clienteId, borradorId, "meta");

  // Al inicio: no está en progreso
  assert.equal(verificarIdempotencia(clave).enProgreso, false);

  // Se inicia
  registrarInicioPublicacion(clave);
  assert.equal(verificarIdempotencia(clave).enProgreso, true);

  // Se finaliza
  const resultadoFake = {
    ok: true,
    plataforma: "meta",
    clienteId,
    cuentaId: "act_1625722292606602",
    campaignId: "meta_camp_12345",
    adGroupOrAdSetId: "meta_adset_67890",
    status: "pausada",
    createdAt: new Date().toISOString(),
    idempotencyKey: clave,
    mensaje: "Creada con éxito",
  };
  registrarFinPublicacion(clave, resultadoFake);

  const consulta = verificarIdempotencia(clave);
  assert.equal(consulta.enProgreso, false);
  assert.ok(consulta.resultado);
  assert.equal(consulta.resultado?.campaignId, "meta_camp_12345");
});

test("linkMetaAdsManager: genera URL válida con act_ y campaign_id", () => {
  const url1 = linkMetaAdsManager("act_1625722292606602", "12021000000000");
  assert.ok(url1.includes("act=1625722292606602"));
  assert.ok(url1.includes("selected_campaign_ids=12021000000000"));

  const url2 = linkMetaAdsManager("1625722292606602");
  assert.ok(url2.includes("act=1625722292606602"));
});

test("publicarCampanaEnMeta: rechaza presupuesto <= 0 sin hacer llamadas", async () => {
  const { publicarCampanaEnMeta } = await import("../lib/ads/metaPublicar.ts");
  limpiarIdempotencia();

  // Cliente ficticio pero con presupuesto 0
  const res = await publicarCampanaEnMeta({
    clienteId: "00000000-0000-0000-0000-000000000000",
    borradorId: "borrador-test",
    nombre: "Test Presupuesto",
    objetivo: "conversaciones",
    destino: "whatsapp",
    presupuestoDiario: 0,
    moneda: "CLP",
    copies: [{ titular: "T", texto: "X" }],
  });

  assert.equal(res.ok, false);
  assert.ok(res.mensaje.includes("presupuesto diario debe ser mayor a 0"));
});

