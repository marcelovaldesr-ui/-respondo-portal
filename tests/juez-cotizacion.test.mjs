import assert from "node:assert/strict";
import test from "node:test";

import {
  COTIZADO_FALLBACK,
  COTIZADO_MAX,
  construirPrompt,
  decidirConJuez,
  formatearHilo,
  interpretar,
  normalizarCotizado,
} from "../lib/juezCotizacionCore.ts";

/**
 * El juez decide si se paga o no una plantilla de MARKETING (~$85) para
 * retomar una cotización. Equivocarse tiene dos costos:
 *
 *  - de más: se le insiste a alguien que ya compró en el mesón, o que dijo que
 *    estaba caro. Se paga por quedar mal.
 *  - de menos: el juez se cae en silencio y NADIE vuelve a perseguir ninguna
 *    cotización — que es exactamente lo que le pasó al vigilante de reingresos
 *    durante días sin que nadie se enterara.
 *
 * Por eso el bloque más largo de este archivo es el del parser.
 */

// ── Del texto crudo del modelo a un veredicto ───────────────────────────────
//
// ⭐ ACÁ VIVIÓ EL BUG DEL "0 DE 94" (2-sep-2026): `generarJSON` devuelve un
// STRING y el vigilante lo trataba como objeto. Todo caía al lado seguro.

test("⭐ interpreta el JSON del modelo cuando viene como STRING", () => {
  const v = interpretar('{"abierta":true,"cotizado":"500 tarjetas","motivo":"nunca respondió"}');
  assert.equal(v.abierta, true);
  assert.equal(v.cotizado, "500 tarjetas");
  assert.equal(v.motivo, "nunca respondió");
});

test("⭐ el caso exacto que rompió al vigilante: string → decide ENVIAR", () => {
  // Si esto se rompe, el juez vuelve a decir "no pude determinarlo" en el 100%
  // de los casos y Beto no persigue ninguna cotización, sin ningún error.
  const d = decidirConJuez(interpretar('{"abierta": true, "cotizado": "gigantografía 2x1", "motivo": "le pasaron el precio y no contestó"}'));
  assert.equal(d.enviar, true);
  assert.equal(d.cotizado, "gigantografía 2x1");
});

test("interpreta un objeto ya parseado (por si alguien lo parsea antes)", () => {
  const v = interpretar({ abierta: false, cotizado: "", motivo: "pagó en el local" });
  assert.equal(v.abierta, false);
  assert.equal(v.motivo, "pagó en el local");
});

test("tolera las cercas de markdown ```json que el modelo agrega solo", () => {
  const v = interpretar('```json\n{"abierta":true,"cotizado":"1000 volantes","motivo":"x"}\n```');
  assert.equal(v.abierta, true);
  assert.equal(v.cotizado, "1000 volantes");
});

test("rescata el JSON aunque venga con una frase alrededor", () => {
  const v = interpretar('Claro, acá va: {"abierta":false,"cotizado":"","motivo":"dijo que estaba caro"} Espero que sirva.');
  assert.equal(v.abierta, false);
  assert.equal(v.motivo, "dijo que estaba caro");
});

test('acepta "true"/"false" como texto, que es como a veces responden', () => {
  assert.equal(interpretar('{"abierta":"true"}').abierta, true);
  assert.equal(interpretar('{"abierta":"false"}').abierta, false);
  assert.equal(interpretar('{"abierta":"sí"}').abierta, true);
});

test("basura → abierta null, y null NO envía (fail-closed)", () => {
  for (const basura of ["", "no soy JSON", "null", "[]", "42", undefined, null, 7, ["a"]]) {
    const v = interpretar(basura);
    assert.equal(v.abierta, null, `debería ser null para ${JSON.stringify(basura)}`);
    assert.equal(decidirConJuez(v).enviar, false);
  }
});

test('"quizás" no es true: cualquier valor ambiguo cae en null', () => {
  assert.equal(interpretar('{"abierta":"quizás"}').abierta, null);
  assert.equal(interpretar('{"abierta":1}').abierta, null);
  assert.equal(interpretar("{}").abierta, null);
});

// ── La reja del juez ────────────────────────────────────────────────────────

test("solo abierta === true envía", () => {
  assert.equal(decidirConJuez({ abierta: true, cotizado: "x y z", motivo: "" }).enviar, true);
  assert.equal(decidirConJuez({ abierta: false, cotizado: "x y z", motivo: "" }).enviar, false);
  assert.equal(decidirConJuez({ abierta: null, cotizado: "x y z", motivo: "" }).enviar, false);
});

test("«no se pudo determinar» y «ya se cerró» dan motivos DISTINTOS", () => {
  // No es cosmético: en la página de aprobación, Cecilia tiene que poder
  // distinguir «el juez dice que ya compró» de «el juez no pudo leerlo».
  const nulo = decidirConJuez({ abierta: null, cotizado: "", motivo: "" });
  const falso = decidirConJuez({ abierta: false, cotizado: "", motivo: "" });
  assert.notEqual(nulo.motivo, falso.motivo);
  assert.match(nulo.motivo, /no pudo/i);
});

// ── La variable {{3}} de la plantilla ───────────────────────────────────────

test("cotizado vacío → la fórmula neutra, que ARMA la frase de la plantilla", () => {
  const d = decidirConJuez({ abierta: true, cotizado: "", motivo: "" });
  assert.equal(d.cotizado, COTIZADO_FALLBACK);
  // El cuerpo aprobado dice "por la cotización de {{3}} que nos pediste".
  const frase = `por la cotización de ${d.cotizado} que nos pediste`;
  assert.equal(frase, "por la cotización de lo que nos consultaste que nos pediste");
  assert.doesNotMatch(frase, /cotización de (tu|la) cotización/);
});

test("quita el «la cotización de» que el modelo repite, para no duplicar la frase", () => {
  assert.equal(normalizarCotizado("la cotización de 500 tarjetas"), "500 tarjetas");
  assert.equal(normalizarCotizado("Cotización de 1000 volantes"), "1000 volantes");
  assert.equal(normalizarCotizado("el presupuesto para un pendón"), "un pendón");
});

test("los parámetros de Meta no admiten saltos ni espacios dobles", () => {
  assert.equal(normalizarCotizado("500 tarjetas\ncon logo\ta color"), "500 tarjetas con logo a color");
  assert.equal(normalizarCotizado("  dos   pendones  "), "dos pendones");
});

test("recorta a 60 caracteres sin cortar una palabra por la mitad", () => {
  const largo = normalizarCotizado(
    "quinientas tarjetas de presentación a color en papel opalina de 300 gramos con laminado mate",
  );
  assert.ok(largo.length <= COTIZADO_MAX, `largo=${largo.length}`);
  assert.doesNotMatch(largo, /\s$/);
  assert.ok(largo.startsWith("quinientas tarjetas"));
});

test("⭐ al cortar por largo no queda una preposición colgando", () => {
  // Los dos casos exactos que salieron en la simulación del 9-sep contra
  // Impresora Color. Dentro de la plantilla quedaban como «por la cotización de
  // … 24 páginas, a que nos pediste»: se lee como un mensaje roto.
  const a = normalizarCotizado("10 cuentos con tapa dura, papel brillante, 24 páginas, a todo color");
  assert.ok(a.length <= COTIZADO_MAX);
  assert.doesNotMatch(a, /[\s,]+(a|de|y|con|para|por|la|el)$/i, `quedó colgando: "${a}"`);

  const b = normalizarCotizado("anillado de 700 páginas a color y anillado de 70 páginas a color");
  assert.ok(b.length <= COTIZADO_MAX);
  assert.doesNotMatch(b, /[\s,]+(a|de|y|con|para|por|la|el)$/i, `quedó colgando: "${b}"`);

  // Y la frase de la plantilla tiene que seguir leyéndose entera.
  assert.match(
    `por la cotización de ${a} que nos pediste`,
    /^por la cotización de 10 cuentos con tapa dura.* que nos pediste$/,
  );
});

test("un cotizado de una letra es ruido del modelo, no un producto", () => {
  assert.equal(normalizarCotizado("x"), "");
  assert.equal(normalizarCotizado("-"), "");
  assert.equal(decidirConJuez({ abierta: true, cotizado: normalizarCotizado("x"), motivo: "" }).cotizado, COTIZADO_FALLBACK);
});

test("quita comillas y puntuación de sobra", () => {
  assert.equal(normalizarCotizado('"500 tarjetas."'), "500 tarjetas");
  assert.equal(normalizarCotizado("«dos pendones»,"), "dos pendones");
});

// ── El hilo que ve el juez ──────────────────────────────────────────────────

test("distingue al asistente de una PERSONA del negocio", () => {
  // Si Cecilia contestó en persona, el juez tiene que poder verlo: puede haber
  // cerrado el trato por teléfono o en el mesón.
  const t = formatearHilo([
    { rol: "cliente", texto: "hola, cuánto salen 500 tarjetas?" },
    { rol: "empleado", texto: "te cotizo al tiro" },
    { rol: "humano", texto: "son $25.000 con IVA" },
  ]);
  assert.match(t, /CLIENTE: hola/);
  assert.match(t, /NEGOCIO \(asistente\): te cotizo/);
  assert.match(t, /NEGOCIO \(persona\): son \$25\.000/);
});

test("un mensaje sin texto (una foto) no queda como una línea en blanco", () => {
  assert.match(formatearHilo([{ rol: "cliente", texto: "" }]), /\(adjunto sin texto\)/);
});

test("el prompt trae el hilo, los días y pide el JSON exacto", () => {
  const p = construirPrompt({
    negocio: "Impresora Color",
    mensajes: [{ rol: "cliente", texto: "cuánto vale un pendón" }],
    diasEsperando: 12,
  });
  assert.match(p, /Impresora Color/);
  assert.match(p, /12 días/);
  assert.match(p, /"abierta": true\|false/);
  // La instrucción que evita "la cotización de la cotización de…".
  assert.match(p, /NO incluyas la palabra "cotización"/);
  // Ante la duda, false: el lado barato de equivocarse.
  assert.match(p, /Si tienes dudas, responde false/);
});
