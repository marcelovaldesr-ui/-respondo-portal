import assert from "node:assert/strict";
import test from "node:test";

import {
  armarConversaciones,
  armarPrompt,
  normalizarRespuesta,
  palabrasClave,
  panoramaEnTexto,
  quien,
  sinAcentos,
  validarPregunta,
  MAX_PREGUNTA,
} from "../lib/isabelCore.ts";

/**
 * Lo que se prueba acá es lo que decide QUÉ ve Isabel. Una respuesta mala del
 * modelo se corrige con el prompt; un contexto mal armado hace que conteste
 * seguro sobre algo que nunca leyó, que es el error que cuesta la confianza.
 */

test("las palabras de relleno no sirven para buscar", () => {
  assert.deepEqual(palabrasClave("¿qué es lo que más me piden?"), ["piden"]);
  assert.deepEqual(palabrasClave("hay algo para mi"), []);
});

test("las palabras se devuelven como las escribió el dueño, con acentos", () => {
  // Importa: `ilike` distingue acentos, así que si acá se perdiera la tilde,
  // buscar «cotización» no encontraría nada.
  assert.deepEqual(palabrasClave("cuántas cotizaciones quedaron sin respuesta"), [
    "cuántas",
    "cotizaciones",
    "quedaron",
    "respuesta",
  ]);
});

test("un número largo SÍ es una búsqueda: el folio del presupuesto", () => {
  assert.deepEqual(palabrasClave("qué pasó con el presupuesto 5292"), ["pasó", "presupuesto", "5292"]);
});

test("no se repite la misma palabra escrita distinto", () => {
  const claves = palabrasClave("reclamo, reclamos y RECLAMO");
  assert.deepEqual(claves, ["reclamo", "reclamos"]);
});

test("sinAcentos deja la palabra comparable", () => {
  assert.equal(sinAcentos("Cotización"), "cotizacion");
  assert.equal(sinAcentos("PENDÓN"), "pendon");
});

test("los roles se traducen a algo que el modelo entiende", () => {
  assert.equal(quien("cliente"), "CLIENTE");
  assert.equal(quien("empleado"), "ASISTENTE");
  assert.equal(quien("humano"), "EQUIPO");
  assert.equal(quien("cualquier_cosa"), "EQUIPO");
});

const msg = (chatId, rol, texto, creadoEn, nombre) => ({ chatId, rol, texto, creadoEn, nombre });

test("las conversaciones se agrupan por chat y quedan en orden cronológico", () => {
  const texto = armarConversaciones([
    msg("569111", "empleado", "Le cotizo en 20 minutos", "2026-09-02T12:00:00Z"),
    msg("569111", "cliente", "Hola, quiero 500 flyers", "2026-09-02T11:00:00Z", "Ana"),
  ]);

  const lineas = texto.split("\n");
  assert.match(lineas[0], /Ana/);
  assert.match(lineas[1], /CLIENTE: Hola, quiero 500 flyers/);
  assert.match(lineas[2], /ASISTENTE: Le cotizo/);
});

test("la conversación más reciente va primero", () => {
  const texto = armarConversaciones([
    msg("vieja", "cliente", "mensaje viejo", "2026-01-01T10:00:00Z", "Vieja"),
    msg("nueva", "cliente", "mensaje nuevo", "2026-09-09T10:00:00Z", "Nueva"),
  ]);
  assert.ok(texto.indexOf("Nueva") < texto.indexOf("Vieja"));
});

test("se recorta por conversación, no de golpe al final", () => {
  const muchos = [];
  for (let i = 0; i < 40; i++) {
    muchos.push(msg("a", "cliente", `mensaje ${i}`, `2026-09-0${(i % 9) + 1}T10:00:00Z`));
    muchos.push(msg("b", "cliente", `otro ${i}`, `2026-09-0${(i % 9) + 1}T11:00:00Z`));
  }
  const texto = armarConversaciones(muchos, { maxMensajes: 3 });
  // Las dos conversaciones siguen presentes, cada una recortada.
  assert.ok(texto.includes("…a"), "la conversación a no puede desaparecer");
  assert.ok(texto.includes("…b"), "la conversación b no puede desaparecer");
});

test("un texto larguísimo se corta y no revienta el contexto", () => {
  const texto = armarConversaciones([msg("a", "cliente", "x".repeat(5000), "2026-09-01T10:00:00Z")], {
    maxChars: 100,
  });
  assert.ok(texto.length < 400);
});

test("sin mensajes devuelve vacío, no una cabecera fantasma", () => {
  assert.equal(armarConversaciones([]), "");
});

test("el panorama se lee como frases, no como JSON", () => {
  const t = panoramaEnTexto({
    dias: 30,
    conversaciones: 41,
    mensajes: 388,
    esperando: 2,
    citasProximas: 5,
    cobrosPendientes: 3,
    cobradoMes: 890000,
    porEtapa: [{ etapa: "cotizado", total: 7 }],
    porEtiqueta: [{ etiqueta: "reclamo", total: 2 }],
  });
  assert.match(t, /41 conversaciones/);
  assert.match(t, /\$890\.000/);
  assert.match(t, /cotizado: 7/);
});

test("el panorama sin datos lo dice, no muestra vacíos", () => {
  const t = panoramaEnTexto({
    dias: 30,
    conversaciones: 0,
    mensajes: 0,
    esperando: 0,
    citasProximas: 0,
    cobrosPendientes: 0,
    cobradoMes: 0,
    porEtapa: [],
    porEtiqueta: [],
  });
  assert.match(t, /Embudo: sin datos/);
});

test("el prompt lleva la pregunta y el panorama, y no deja huecos sin rellenar", () => {
  const p = armarPrompt({
    negocio: "Impresora Color",
    rubro: "imprenta",
    hoy: "jueves 10 de septiembre de 2026",
    panorama: "Últimos 30 días: 41 conversaciones",
    fichas: "· [precios] Flyers: $30 c/u",
    conversaciones: "--- Ana ---",
    pregunta: "¿alguien reclamó?",
  });

  assert.ok(p.includes("Impresora Color"));
  assert.ok(p.includes("¿alguien reclamó?"));
  assert.ok(p.includes("41 conversaciones"));
  assert.ok(!p.includes("{{"), "quedó un hueco sin reemplazar en el prompt");
});

test("el prompt no deja huecos aunque falte todo", () => {
  const p = armarPrompt({
    negocio: "",
    rubro: "",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "algo",
  });
  assert.ok(!p.includes("{{"));
  assert.ok(p.includes("no hay fichas cargadas"));
});

test("se acepta la respuesta buena del modelo", () => {
  const r = normalizarRespuesta(
    JSON.stringify({
      respuesta: "Sí, reclamó una persona el lunes.",
      apoyos: ["Ana, 8 de septiembre: «llegó mal impreso»"],
      seguridad: "alta",
    }),
  );
  assert.equal(r.seguridad, "alta");
  assert.equal(r.apoyos.length, 1);
});

test("si el modelo contesta en prosa igual sirve, con seguridad media", () => {
  const r = normalizarRespuesta("No hubo reclamos esta semana.");
  assert.equal(r.respuesta, "No hubo reclamos esta semana.");
  assert.equal(r.seguridad, "media");
  assert.deepEqual(r.apoyos, []);
});

test("una respuesta vacía se descarta en vez de mostrarse en blanco", () => {
  assert.equal(normalizarRespuesta(JSON.stringify({ respuesta: "" })), null);
  assert.equal(normalizarRespuesta(""), null);
});

test("«no sé» se conserva: es una respuesta válida, no una falla", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: "Con lo que tengo cargado no puedo saberlo.", seguridad: "no_se" }),
  );
  assert.equal(r.seguridad, "no_se");
});

test("una seguridad inventada por el modelo se degrada a media", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: "Algo", seguridad: "certísima" }),
  );
  assert.equal(r.seguridad, "media");
});

test("una respuesta que vino como lista se junta en una sola", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: ["Sí.", "Fue el lunes."], seguridad: "alta" }),
  );
  assert.equal(r.respuesta, "Sí. Fue el lunes.");
});

test("la pregunta se valida antes de gastar una llamada al modelo", () => {
  assert.equal(validarPregunta("  ").ok, false);
  assert.equal(validarPregunta("x".repeat(MAX_PREGUNTA + 1)).ok, false);

  const ok = validarPregunta("  ¿alguien   reclamó? ");
  assert.equal(ok.ok, true);
  assert.equal(ok.texto, "¿alguien reclamó?");
});
