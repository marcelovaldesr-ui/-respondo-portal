import assert from "node:assert/strict";
import test from "node:test";

import {
  construirOperacionesGoogle,
  extraerIdsMutacion,
  microsPresupuesto,
  nombreCampanaGoogle,
  publicacionPreviaGoogle,
  requestIdGoogle,
  traducirErrorGoogleMutate,
  validarUrlFinal,
  GEO_CHILE,
} from "../lib/ads/googlePublicar.ts";
import { sanitizarMensajeError } from "../lib/ads/publicacion.ts";

const base = {
  clienteId: "66666666-6666-6666-6666-666666666666",
  borradorId: "b1",
  nombre: "TEST GOOGLE",
  presupuestoDiario: 2000,
  moneda: "CLP",
  urlFinal: "https://respon-do.com",
  palabrasClave: [
    { texto: "asistente whatsapp", concordancia: "frase" },
    { texto: "chatbot pymes", concordancia: "exacta" },
  ],
  titulares: ["Asistente para pymes", "Responde en segundos", "Agenda automática"],
  descripciones: ["Atiende, agenda y vende por WhatsApp.", "Implementación acompañada en Chile."],
};

const tipos = (ops) => ops.map((o) => Object.keys(o)[0]);

test("campaña: declara contains_eu_political_advertising (obligatorio en v25) y nace PAUSADA", () => {
  const r = construirOperacionesGoogle(base, "1234567890", "2026-09-22");
  assert.equal(r.ok, true);
  const camp = r.plan.operaciones.find((o) => o.campaignOperation).campaignOperation.create;
  assert.equal(camp.containsEuPoliticalAdvertising, "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING");
  assert.equal(camp.status, "PAUSED");
  assert.equal(camp.advertisingChannelType, "SEARCH");
  const grupo = r.plan.operaciones.find((o) => o.adGroupOperation).adGroupOperation.create;
  const ad = r.plan.operaciones.find((o) => o.adGroupAdOperation).adGroupAdOperation.create;
  assert.equal(grupo.status, "PAUSED");
  assert.equal(ad.status, "PAUSED");
  assert.equal(r.plan.nombreCampana, "RESPONDO_TEST_GOOGLE_2026-09-22");
});

test("orden atómico: presupuesto → campaña → país+idioma → grupo → palabras → anuncio", () => {
  const r = construirOperacionesGoogle(base, "1234567890", "2026-09-22");
  assert.deepEqual(tipos(r.plan.operaciones), [
    "campaignBudgetOperation",
    "campaignOperation",
    "campaignCriterionOperation",
    "campaignCriterionOperation",
    "adGroupOperation",
    "adGroupCriterionOperation",
    "adGroupCriterionOperation",
    "adGroupAdOperation",
  ]);
  const geo = r.plan.operaciones[2].campaignCriterionOperation.create.location.geoTargetConstant;
  assert.equal(geo, `geoTargetConstants/${GEO_CHILE}`);
});

test("presupuesto CLP: micros múltiplo de 1 peso (Google rechaza fracciones)", () => {
  assert.equal(microsPresupuesto(2000, "CLP"), 2_000_000_000);
  assert.equal(microsPresupuesto(2000.6, "CLP"), 2_001_000_000);
  assert.equal(microsPresupuesto(10.005, "USD") % 10_000, 0);
});

test("URL final: sin sitio del negocio NO se publica (antes caía a un dominio ajeno)", () => {
  for (const u of [null, "", "no es url", "javascript:alert(1)"]) {
    const r = construirOperacionesGoogle({ ...base, urlFinal: u }, "1234567890", "2026-09-22");
    assert.equal(r.ok, false, String(u));
    assert.equal(r.codigo, "SIN_URL_FINAL");
  }
  assert.equal(validarUrlFinal("impresoracolor.cl"), "https://impresoracolor.cl/");
});

test("no inventa textos: con menos de 3 titulares o 2 descripciones distintos, se niega", () => {
  const r1 = construirOperacionesGoogle({ ...base, titulares: ["A", "a", "B"] }, "1", "x");
  assert.equal(r1.ok, false);
  assert.equal(r1.codigo, "FALTAN_TITULARES");
  const r2 = construirOperacionesGoogle({ ...base, descripciones: ["uno"] }, "1", "x");
  assert.equal(r2.codigo, "FALTAN_DESCRIPCIONES");
  const r3 = construirOperacionesGoogle({ ...base, palabrasClave: [] }, "1", "x");
  assert.equal(r3.codigo, "SIN_PALABRAS_CLAVE");
});

test("nombre de campaña sin comillas: va dentro de una consulta GAQL", () => {
  assert.equal(nombreCampanaGoogle("O'Higgins \"promo\"", "2026-09-22"), "RESPONDO_OHiggins_promo_2026-09-22");
});

test("extraerIdsMutacion: presupuesto, campaña, grupo, palabras y anuncio", () => {
  const json = {
    mutateOperationResponses: [
      { campaignBudgetResult: { resourceName: "customers/1/campaignBudgets/11" } },
      { campaignResult: { resourceName: "customers/1/campaigns/22" } },
      { campaignCriterionResult: { resourceName: "customers/1/campaignCriteria/22~2152" } },
      { adGroupResult: { resourceName: "customers/1/adGroups/33" } },
      { adGroupCriterionResult: { resourceName: "customers/1/adGroupCriteria/33~44" } },
      { adGroupCriterionResult: { resourceName: "customers/1/adGroupCriteria/33~45" } },
      { adGroupAdResult: { resourceName: "customers/1/adGroupAds/33~55" } },
    ],
  };
  assert.deepEqual(extraerIdsMutacion(json), {
    budgetId: "11",
    campaignId: "22",
    adGroupId: "33",
    adIds: ["55"],
    keywordIds: ["44", "45"],
  });
});

test("idempotencia persistente: un borrador ya publicado en Google no se vuelve a crear", () => {
  const plan = { publicacion: { plataforma: "google", campaignId: "22", cuentaId: "1", adIds: ["55"], budgetId: "11" } };
  const r = publicacionPreviaGoogle(plan, base.clienteId);
  assert.equal(r.ok, true);
  assert.equal(r.campaignId, "22");
  assert.equal(r.budgetId, "11");
  assert.equal(publicacionPreviaGoogle({ publicacion: { plataforma: "meta", campaignId: "9" } }, "x"), null);
  assert.equal(publicacionPreviaGoogle(null, "x"), null);
});

test("errores: v25 CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION → nivel de acceso", () => {
  const f = traducirErrorGoogleMutate(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" } }] }] } });
  assert.equal(f.codigo, "GOOGLE_NIVEL_ACCESO");
});

test("errores: nombre duplicado, cuenta inválida, política, palabra inválida, token vencido, campo requerido", () => {
  const e = (x) => ({ error: { details: [{ errors: [{ errorCode: x, message: "msg humano" }] }] } });
  assert.equal(traducirErrorGoogleMutate(400, e({ campaignError: "DUPLICATE_CAMPAIGN_NAME" })).codigo, "GOOGLE_NOMBRE_DUPLICADO");
  assert.equal(traducirErrorGoogleMutate(400, e({ requestError: "INVALID_CUSTOMER_ID" })).codigo, "GOOGLE_CUENTA_INVALIDA");
  assert.equal(traducirErrorGoogleMutate(400, e({ policyFindingError: "POLICY_FINDING" })).codigo, "GOOGLE_POLITICA");
  assert.equal(traducirErrorGoogleMutate(400, e({ criterionError: "KEYWORD_HAS_INVALID_CHARS" })).codigo, "GOOGLE_PALABRA_INVALIDA");
  assert.equal(traducirErrorGoogleMutate(401, { error: "invalid_grant" }).codigo, "GOOGLE_TOKEN_EXPIRADO");
  assert.equal(traducirErrorGoogleMutate(400, e({ fieldError: "REQUIRED" })).codigo, "GOOGLE_CAMPO_REQUERIDO");
});

test("errores: un fallo en la operación de presupuesto que NO es de presupuesto no se disfraza de presupuesto", () => {
  const f = traducirErrorGoogleMutate(400, {
    error: { details: [{ errors: [{ errorCode: { fieldError: "REQUIRED" }, location: { fieldPathElements: [{ fieldName: "campaign_budget_operation" }] } }] }] },
  });
  assert.equal(f.codigo, "GOOGLE_CAMPO_REQUERIDO");
});

test("errores: el mensaje al usuario no trae JSON ni secretos; request-id queda para soporte", () => {
  const cuerpo = { error: { message: "Bearer ya29.abc.def 1//0secret", details: [{ requestId: "RID-1", errors: [{ errorCode: { x: "Y" }, message: "algo raro con ya29.tok" }] }] } };
  const f = traducirErrorGoogleMutate(400, cuerpo);
  assert.ok(!f.mensaje.includes("ya29."));
  assert.ok(!f.mensaje.includes("{"));
  assert.ok(!f.detalleTecnico.includes("ya29.abc"));
  assert.ok(!f.detalleTecnico.includes("1//0secret"));
  assert.equal(requestIdGoogle(cuerpo), "RID-1");
});

test("sanitizar: access tokens de Google (ya29.) también se redactan", () => {
  assert.ok(!sanitizarMensajeError("token ya29.a0AfH6SMB_x-y.z").includes("ya29.a0"));
});

test("callback: sólo códigos públicos de Google viajan a la URL, nunca texto libre", async () => {
  const { codigoPublicoGoogle } = await import("../lib/ads/google.ts");
  assert.equal(codigoPublicoGoogle("invalid_client"), "invalid_client");
  assert.equal(codigoPublicoGoogle('{"error":{"details":[{"errors":[{"errorCode":{"authorizationError":"CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"}}]}]}}'), "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION");
  assert.equal(codigoPublicoGoogle("token 1//0abc ya29.xyz algo raro"), null);
  assert.equal(codigoPublicoGoogle(null), null);
});
