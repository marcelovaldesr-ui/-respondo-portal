import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  agregar,
  costoPorResultado,
  cpc,
  cpm,
  ctr,
  roas,
  sonComparables,
  sumarResultados,
  NIVELES_DE,
} from "../lib/ads/canal.ts";
import {
  detectarSenales,
  motivoFaltante,
  profundidadDe,
  seccionesVisibles,
  senalesVacias,
  sePuedeResponder,
} from "../lib/ads/senales.ts";
import { MINIMOS, analizarAds, comparables, mediana, umbralGastoSinResultado } from "../lib/ads/analisis.ts";
import { armarEmbudoAdaptativo, tituloEmbudo } from "../lib/marketing/embudoAdaptativo.ts";
import {
  LIMITES,
  PISO_DIARIO_CAMPANA,
  armarTracking,
  destinosPosibles,
  hayIntencionDeBusqueda,
  planEnTexto,
  recortar,
  repartirPresupuesto,
  revisarPlan,
  slug,
} from "../lib/marketing/arquitectoCore.ts";
import { HERRAMIENTAS, herramientasDisponibles, preguntasPara, promptCopiloto } from "../lib/marketing/copilotoCore.ts";
import { panoramaDemo } from "../lib/marketing/demo.ts";
import { resolverRango } from "../lib/ads/periodos.ts";
import { formatearIdCuenta, soloDigitos, tipoCampanaLegible, tienePalabrasClave } from "../lib/ads/google.ts";
import { objetivoMetaLegible, resultadoDeAcciones, valorDeAcciones } from "../lib/ads/meta.ts";

/**
 * MARKETING FASE 6 — Marketing multicanal que funciona con las señales que hay.
 *
 * Lo que se prueba acá no es «que compile»: es cada decisión que, si se
 * revierte sin darse cuenta, vuelve a producir el problema que esta fase vino a
 * resolver —un negocio sin WhatsApp viendo un producto lleno de ceros— o
 * produce uno peor: una cifra falsa que se ve bien.
 *
 * Un test por decisión real. Nada de relleno.
 */

const RAIZ = path.resolve(import.meta.dirname, "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");
/** Código sin comentarios: los comentarios citan a propósito los patrones viejos. */
const codigo = (p) =>
  leer(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const clp = (valor) => ({ valor, moneda: "CLP" });

function campana(over = {}) {
  return {
    proveedor: "meta",
    nivel: "campana",
    id: "c1",
    nombre: "Campaña",
    estado: "activa",
    objetivo: "Mensajes",
    impresiones: 10_000,
    clics: 200,
    gasto: clp(100_000),
    resultados: { cantidad: 20, tipo: "mensajes" },
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   1. LAS SEÑALES — el cimiento nuevo
   ══════════════════════════════════════════════════════════════════════════ */

test("las señales se detectan de hechos, no de una preferencia guardada", () => {
  const ayp = detectarSenales({
    hayCuentaPublicitaria: true,
    plataformaReportaResultados: true,
    hayConversacionesAtribuidas: false,
    hayIngresosAtribuidos: false,
  });
  assert.equal(ayp.ads, true);
  assert.equal(ayp.conversaciones, false);
  assert.equal(profundidadDe(ayp), "conversiones");

  const impresora = detectarSenales({
    hayCuentaPublicitaria: true,
    plataformaReportaResultados: true,
    hayConversacionesAtribuidas: true,
    hayIngresosAtribuidos: true,
  });
  assert.equal(profundidadDe(impresora), "ingresos");

  const respondo = detectarSenales({
    hayCuentaPublicitaria: false,
    plataformaReportaResultados: false,
    hayConversacionesAtribuidas: false,
    hayIngresosAtribuidos: false,
  });
  assert.equal(profundidadDe(respondo), "ninguna");
});

test("sin conversaciones no existe la sección Personas, y con ellas sí", () => {
  const sinConv = { ...senalesVacias(), ads: true, conversiones: true };
  assert.equal(seccionesVisibles(sinConv).personas, false);
  // Atribución sigue existiendo: con solo ads el embudo tiene tres escalones.
  assert.equal(seccionesVisibles(sinConv).atribucion, true);

  const conConv = { ...sinConv, conversaciones: true };
  assert.equal(seccionesVisibles(conConv).personas, true);
});

test("«Búsqueda» nunca aparece por omisión: depende del proveedor, no de la señal", () => {
  const todas = { ads: true, conversiones: true, conversaciones: true, ingresos: true };
  assert.equal(seccionesVisibles(todas).busqueda, false);
});

test("cada señal faltante explica qué no se sabe y qué sí se puede ofrecer", () => {
  const motivo = motivoFaltante("conversaciones");
  assert.match(motivo, /no recibe las conversaciones/i);
  // No basta con decir que falta: tiene que decir qué SÍ se puede responder.
  assert.match(motivo, /más barato|resultado/i);
});

test("una pregunta que necesita conversaciones no se puede responder sin ellas", () => {
  const soloAds = { ...senalesVacias(), ads: true, conversiones: true };
  assert.equal(sePuedeResponder(soloAds, "cuanto_gaste"), true);
  assert.equal(sePuedeResponder(soloAds, "que_campana_trae_compradores"), false);
  assert.equal(sePuedeResponder(soloAds, "calidad_del_lead"), false);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. NORMALIZACIÓN ENTRE PLATAFORMAS — lo que NO se debe mezclar
   ══════════════════════════════════════════════════════════════════════════ */

test("dos resultados de tipos distintos no se comparan ni se suman", () => {
  const mensajes = { cantidad: 10, tipo: "mensajes" };
  const web = { cantidad: 10, tipo: "conversiones_web" };
  assert.equal(sonComparables(mensajes, web), false);
  assert.equal(sumarResultados([mensajes, web]), null);
  assert.deepEqual(sumarResultados([mensajes, { cantidad: 5, tipo: "mensajes" }]), {
    tipo: "mensajes",
    cantidad: 15,
  });
});

test("un resultado «desconocido» no es comparable ni siquiera con otro desconocido", () => {
  const a = { cantidad: 4, tipo: "desconocido" };
  assert.equal(sonComparables(a, { cantidad: 9, tipo: "desconocido" }), false);
  assert.equal(sumarResultados([a]), null);
});

test("agregar con monedas mezcladas devuelve null, nunca un total inventado", () => {
  const filas = [campana({ gasto: clp(1000) }), campana({ id: "c2", gasto: { valor: 5, moneda: "USD" } })];
  assert.equal(agregar(filas).gasto, null);
});

test("el alcance NO se suma entre campañas: una persona alcanzada dos veces es una", () => {
  const filas = [campana({ alcance: 800 }), campana({ id: "c2", alcance: 500 })];
  // Se devuelve el máximo observado como piso honesto, no 1.300.
  assert.equal(agregar(filas).alcanceMinimo, 800);
});

test("el ROAS se niega a calcular con monedas distintas", () => {
  assert.equal(roas({ gasto: clp(1000), valorResultados: { valor: 5000, moneda: "USD" } }), null);
  assert.equal(roas({ gasto: clp(1000), valorResultados: clp(5000) }), 5);
});

test("las métricas derivadas se calculan en un solo lugar y con una sola definición", () => {
  const c = campana({ impresiones: 1000, clics: 50, gasto: clp(25_000) });
  assert.equal(ctr(c), 5);
  assert.equal(cpc(c).valor, 500);
  assert.equal(cpm(c).valor, 25_000);
  assert.equal(costoPorResultado(c).valor, 1250);
  // Sin denominador no hay división: null, no Infinity ni 0.
  assert.equal(ctr({ impresiones: 0, clics: 0 }), null);
  assert.equal(cpc({ clics: 0, gasto: clp(100) }), null);
  assert.equal(costoPorResultado({ gasto: clp(100), resultados: null }), null);
});

test("cada plataforma declara los niveles que de verdad puede entregar", () => {
  assert.equal(NIVELES_DE.meta.includes("termino"), false, "Meta no tiene términos de búsqueda");
  assert.equal(NIVELES_DE.google.includes("termino"), true);
  assert.equal(NIVELES_DE.google.includes("conjunto"), false, "Google no tiene conjuntos, tiene grupos");
});

/* ══════════════════════════════════════════════════════════════════════════
   3. META: resultados desde `actions` sin sopa de métricas
   ══════════════════════════════════════════════════════════════════════════ */

test("de las acciones de Meta se elige el resultado por prioridad, no el primero", () => {
  const acciones = [
    { action_type: "link_click", value: "300" },
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "12" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
  ];
  // La compra manda sobre el mensaje: es el resultado de negocio.
  assert.deepEqual(resultadoDeAcciones(acciones), { cantidad: 3, tipo: "compras" });
});

test("una acción que no sabemos definir NO se convierte en resultado", () => {
  assert.equal(resultadoDeAcciones([{ action_type: "video_view", value: "900" }]), null);
  assert.equal(resultadoDeAcciones(null), null);
});

test("el valor declarado solo suma compras", () => {
  const valores = [
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "35000" },
    { action_type: "landing_page_view", value: "999999" },
  ];
  assert.deepEqual(valorDeAcciones(valores, "CLP"), { valor: 35000, moneda: "CLP" });
  assert.equal(valorDeAcciones([], "CLP"), null);
});

test("el objetivo de Meta se traduce a palabras del dueño", () => {
  assert.equal(objetivoMetaLegible("OUTCOME_LEADS"), "Clientes potenciales");
  assert.equal(objetivoMetaLegible(""), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   4. GOOGLE: identificadores, tipos de campaña y conversiones «duras»
   ══════════════════════════════════════════════════════════════════════════ */

test("un id de Google con guiones y uno sin guiones son la misma cuenta", () => {
  assert.equal(soloDigitos("123-456-7890"), "1234567890");
  assert.equal(formatearIdCuenta("1234567890"), "123-456-7890");
});

test("las campañas sin palabras clave se identifican antes de recomendar sobre ellas", () => {
  assert.equal(tienePalabrasClave("SEARCH"), true);
  assert.equal(tienePalabrasClave("PERFORMANCE_MAX"), false);
  assert.equal(tienePalabrasClave("SMART"), false);
  assert.equal(tipoCampanaLegible("PERFORMANCE_MAX"), "Máximo rendimiento");
});

test("Google usa conversiones duras, nunca all_conversions", () => {
  const fuente = codigo("lib/ads/google.ts");
  assert.match(fuente, /metrics\.conversions/);
  assert.doesNotMatch(fuente, /all_conversions/, "all_conversions incluye acciones blandas del perfil de Maps");
});

test("la versión de la API y el endpoint de streaming están fijos y documentados", () => {
  const fuente = leer("lib/ads/google.ts");
  assert.match(fuente, /googleads\.googleapis\.com\/v25/);
  assert.match(fuente, /googleAds:searchStream/);
  // searchStream devuelve un ARRAY de trozos: parsearlo como objeto da vacío sin error.
  assert.match(codigo("lib/ads/google.ts"), /Array\.isArray\(cuerpo\)/);
});

test("Google Ads tiene credenciales propias: no toca el proyecto Cloud de la Agenda", () => {
  const fuente = codigo("lib/ads/google.ts");
  assert.match(fuente, /GOOGLE_ADS_CLIENT_ID/);
  assert.doesNotMatch(fuente, /GOOGLE_OAUTH_CLIENT_ID/, "agregar el scope adwords al proyecto de Calendar reabre su verificación");
  assert.match(fuente, /access_type: "offline"/);
  assert.match(fuente, /prompt: "consent"/);
});

test("el token de desarrollador NO se exige: Google lo apagó el 9-sep-2026", () => {
  const fuente = codigo("lib/ads/google.ts");
  // La integración se habilita con el cliente OAuth. Exigir el token de
  // desarrollador dejaría el botón apagado para siempre por un requisito que
  // Google eliminó: el nivel de acceso vive ahora en el proyecto de Cloud.
  assert.match(fuente, /if \(!clientId \|\| !clientSecret\) return null/);
  assert.doesNotMatch(fuente, /!clientId \|\| !clientSecret \|\| !developerToken/);
  // Si está configurado se sigue mandando: no cuesta nada y la API lo ignora.
  assert.match(fuente, /encabezadosApp/);
  // Y el mensaje de error manda al lugar correcto, que ya no es un token.
  assert.match(fuente, /proyecto de Google Cloud todavía tiene acceso de prueba/);
});

test("el refresh token de Google se guarda cifrado y con propósito propio", () => {
  const fuente = codigo("lib/ads/google.ts");
  assert.match(fuente, /ads-google-token/);
  assert.match(codigo("lib/cifrado.ts"), /"ads-google-token"/);
  assert.match(codigo("lib/cifrado.ts"), /"ads-google-estado"/);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. EL MOTOR DE ANÁLISIS — evidencia o silencio
   ══════════════════════════════════════════════════════════════════════════ */

const ctx = (filas, filasAntes = []) => ({ filas, filasAntes, periodo: "últimos 30 días", dias: 30 });

test("con la medición muda, el análisis se detiene y lo dice", () => {
  const sinConversiones = campana({ clics: 400, resultados: null });
  const r = analizarAds(ctx([sinConversiones]));
  assert.ok(r.insights.some((i) => i.clave === "medicion_muda"));
  // Y no se opina de rendimiento sobre datos que sabemos incompletos.
  assert.equal(r.insights.length, 1);
  assert.ok(r.recomendaciones.every((x) => x.accion === "revisar"));
});

test("no se recomienda pausar algo con 3 clics: se declara dato insuficiente", () => {
  const buena = campana({ id: "ok", gasto: clp(100_000), resultados: { cantidad: 25, tipo: "mensajes" } });
  const nueva = campana({ id: "nueva", nombre: "Recién lanzada", clics: 3, gasto: clp(40_000), resultados: null });
  const r = analizarAds(ctx([buena, nueva]));
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("pausar_")), false);
  assert.ok(r.insuficientes.some((i) => i.que.includes("Recién lanzada")));
  assert.match(r.insuficientes.find((i) => i.que.includes("Recién lanzada")).queFalta, new RegExp(String(MINIMOS.clics)));
});

test("el umbral de gasto sale de la propia cuenta, no de un número en pesos", () => {
  // Cuenta que consigue resultados a $5.000: el umbral es 3× eso.
  const filas = [campana({ gasto: clp(100_000), resultados: { cantidad: 20, tipo: "mensajes" } })];
  assert.equal(umbralGastoSinResultado(filas), 15_000);
  // Sin resultados todavía, se usa el costo por clic ×10.
  assert.equal(umbralGastoSinResultado([campana({ gasto: clp(10_000), clics: 100, resultados: null })]), 1000);
  // Sin nada, no hay umbral: no se afirma.
  assert.equal(umbralGastoSinResultado([campana({ gasto: clp(0), clics: 0, resultados: null })]), null);
});

test("no hay umbrales universales de CTR: se compara contra el período anterior del propio negocio", () => {
  const fuente = codigo("lib/ads/analisis.ts");
  assert.doesNotMatch(fuente, /ctr[^\n]*<\s*2\b/i, "un CTR «bajo 2%» es falso en la mitad de las cuentas");
  const ahora = campana({ impresiones: 50_000, clics: 300 });
  const antes = campana({ impresiones: 50_000, clics: 600 });
  const r = analizarAds(ctx([ahora], [antes]));
  assert.ok(r.insights.some((i) => i.clave.startsWith("ctr_")));
});

test("el costo por resultado solo se compara con volumen en AMBOS períodos", () => {
  const pocas = campana({ resultados: { cantidad: 3, tipo: "mensajes" } });
  const pocasAntes = campana({ resultados: { cantidad: 2, tipo: "mensajes" }, gasto: clp(40_000) });
  const r = analizarAds(ctx([pocas], [pocasAntes]));
  assert.equal(r.insights.some((i) => i.clave.startsWith("costo_resultado_")), false);
  assert.ok(r.insuficientes.some((i) => i.clave.startsWith("cpa_")));

  const muchas = campana({ resultados: { cantidad: 20, tipo: "mensajes" }, gasto: clp(200_000) });
  const muchasAntes = campana({ resultados: { cantidad: 20, tipo: "mensajes" }, gasto: clp(100_000) });
  const r2 = analizarAds(ctx([muchas], [muchasAntes]));
  assert.ok(r2.insights.some((i) => i.clave.startsWith("costo_resultado_")));
});

test("no se compara el costo de una campaña de mensajes con una de compras", () => {
  const mensajes = campana({ id: "m", objetivo: "Mensajes", resultados: { cantidad: 20, tipo: "mensajes" } });
  const compras = campana({ id: "v", objetivo: "Ventas", resultados: { cantidad: 20, tipo: "compras" } });
  assert.equal(comparables(mensajes, compras), false);
});

test("«no hay nada que cambiar» es una respuesta válida del motor", () => {
  const sana = campana({ resultados: { cantidad: 30, tipo: "mensajes" }, gasto: clp(60_000) });
  const r = analizarAds(ctx([sana]));
  assert.equal(r.recomendaciones.length, 0);
  assert.equal(r.nadaQueCambiar, true);
});

test("una campaña ya pausada no recibe la recomendación de pausarla", () => {
  const muerta = campana({ id: "z", estado: "pausada", clics: 120, gasto: clp(500_000), resultados: null });
  const viva = campana({ id: "v", resultados: { cantidad: 40, tipo: "mensajes" }, gasto: clp(100_000) });
  const r = analizarAds(ctx([muerta, viva]));
  assert.equal(r.recomendaciones.some((x) => x.clave === "pausar_meta|campana|z"), false);
});

test("cada recomendación trae evidencia, confianza, riesgo y con qué se calculó", () => {
  const cara = campana({ id: "cara", clics: 60, gasto: clp(300_000), resultados: null });
  const barata = campana({ id: "ok", resultados: { cantidad: 30, tipo: "mensajes" }, gasto: clp(60_000) });
  const r = analizarAds(ctx([cara, barata]));
  const rec = r.recomendaciones[0];
  assert.ok(rec.evidencia.length > 10);
  assert.ok(["alta", "media", "baja"].includes(rec.confianza));
  assert.ok(rec.riesgo.length > 10);
  assert.ok(rec.datosUsados.length > 0);
});

test("las recomendaciones se ordenan por la plata que tocan", () => {
  // Las dos por sobre el umbral derivado de la cuenta; si no, la chica ni
  // siquiera se recomienda (y eso ya lo prueba el test del umbral).
  const chica = campana({ id: "a", clics: 40, gasto: clp(200_000), resultados: null });
  const grande = campana({ id: "b", clics: 90, gasto: clp(900_000), resultados: null });
  const otra = campana({ id: "c", resultados: { cantidad: 30, tipo: "mensajes" }, gasto: clp(60_000) });
  const r = analizarAds(ctx([chica, grande, otra]));
  const pausas = r.recomendaciones.filter((x) => x.accion === "pausar");
  assert.ok(pausas.length >= 2);
  assert.ok(pausas[0].plataEnJuego >= pausas[1].plataEnJuego);
});

test("mediana con pares, para no comparar contra un promedio que un outlier arrastra", () => {
  assert.equal(mediana([1, 2, 3]), 2);
  assert.equal(mediana([1, 2, 3, 100]), 2.5);
  assert.equal(mediana([]), null);
});

/* ── Google: términos y la negativa que ciega un grupo ────────────────────── */

const termino = (nombre, over = {}) => ({
  proveedor: "google",
  nivel: "termino",
  id: nombre,
  nombre,
  campanaId: "g1",
  campanaNombre: "Búsqueda",
  impresiones: 500,
  clics: 20,
  gasto: clp(60_000),
  resultados: null,
  ...over,
});

const palabra = (nombre, over = {}) => ({
  proveedor: "google",
  nivel: "palabra",
  id: nombre,
  nombre,
  campanaId: "g1",
  grupoId: "gg1",
  grupoNombre: "Grupo",
  impresiones: 900,
  clics: 40,
  gasto: clp(30_000),
  resultados: { cantidad: 4, tipo: "conversiones_web" },
  extra: { concordancia: "PHRASE" },
  ...over,
});

test("NO se propone excluir un término que bloquearía una palabra clave activa", () => {
  const base = campana({
    proveedor: "google",
    objetivo: "Búsqueda",
    resultados: { cantidad: 30, tipo: "conversiones_web" },
    gasto: clp(300_000),
  });
  const filas = [base, palabra("impresion de planos"), termino("impresion de planos a1")];
  const r = analizarAds(ctx(filas));
  assert.equal(
    r.recomendaciones.some((x) => x.clave === "negativa_impresion de planos a1"),
    false,
    "es exactamente la negativa que dejó ciego un grupo entero en una cuenta real",
  );
  assert.ok(r.insuficientes.some((i) => i.clave.startsWith("negativa_riesgosa_")));
});

test("un término que gasta sin convertir y no choca con nada SÍ se propone excluir", () => {
  const base = campana({
    proveedor: "google",
    objetivo: "Búsqueda",
    resultados: { cantidad: 30, tipo: "conversiones_web" },
    gasto: clp(300_000),
  });
  const filas = [base, palabra("imprenta chillan"), termino("trabajos de imprenta sueldo")];
  const r = analizarAds(ctx(filas));
  assert.ok(r.recomendaciones.some((x) => x.clave === "negativa_trabajos de imprenta sueldo"));
});

test("un término que convierte y no es palabra propia se muestra como oportunidad", () => {
  const base = campana({
    proveedor: "google",
    objetivo: "Búsqueda",
    resultados: { cantidad: 30, tipo: "conversiones_web" },
    gasto: clp(300_000),
  });
  const filas = [base, palabra("imprenta chillan"), termino("imprenta chillan precios", { resultados: { cantidad: 8, tipo: "conversiones_web" } })];
  const r = analizarAds(ctx(filas));
  assert.ok(r.insights.some((i) => i.clave === "termino_gana_imprenta chillan precios"));
});

/* ══════════════════════════════════════════════════════════════════════════
   6. EL EMBUDO ADAPTATIVO
   ══════════════════════════════════════════════════════════════════════════ */

const entradaEmbudo = {
  impresiones: 50_000,
  clics: 900,
  resultados: 60,
  tipoResultado: "conversiones_web",
  conversaciones: 40,
  calificados: 25,
  avanzados: 12,
  ventas: 6,
};

test("sin conversaciones el embudo tiene tres escalones completos, no seis con ceros", () => {
  const soloAds = { ...senalesVacias(), ads: true, conversiones: true };
  const e = armarEmbudoAdaptativo(entradaEmbudo, soloAds);
  assert.deepEqual(e.map((x) => x.clave), ["impresiones", "clics", "resultados"]);
  // Y el escalón se llama por el TIPO de resultado, no «Resultados» a secas.
  assert.equal(e[2].etiqueta, "Conversiones del sitio");
});

test("con todas las señales el embudo llega hasta la venta", () => {
  const todas = { ads: true, conversiones: true, conversaciones: true, ingresos: true };
  const e = armarEmbudoAdaptativo(entradaEmbudo, todas);
  assert.deepEqual(e.map((x) => x.clave), [
    "impresiones",
    "clics",
    "resultados",
    "conversaciones",
    "calificados",
    "avanzados",
    "ventas",
  ]);
});

test("la tasa se calcula contra el escalón anterior QUE EXISTE", () => {
  const sinResultados = { ...senalesVacias(), ads: true, conversaciones: true };
  const e = armarEmbudoAdaptativo({ ...entradaEmbudo, resultados: null, tipoResultado: null }, sinResultados);
  const conversaciones = e.find((x) => x.clave === "conversaciones");
  // 40 de 900 clics = 4,4%. Si se comparara contra un índice fijo, saldría otra cosa.
  assert.ok(Math.abs(conversaciones.tasa - (40 / 900) * 100) < 0.001);
});

test("el titular del embudo no promete una segunda mitad que no existe", () => {
  const soloAds = { ...senalesVacias(), ads: true, conversiones: true };
  assert.equal(tituloEmbudo(soloAds).derecha, null);
  const todas = { ads: true, conversiones: true, conversaciones: true, ingresos: true };
  assert.equal(tituloEmbudo(todas).derecha, "LO QUE HACE EL CLIENTE");
});

/* ══════════════════════════════════════════════════════════════════════════
   7. EL COPILOTO — honesto sobre lo que no puede saber
   ══════════════════════════════════════════════════════════════════════════ */

const panoramaSoloAds = () => panoramaDemo(resolverRango("30d"), "meta");
const panoramaCompleto = () => panoramaDemo(resolverRango("30d"), "completo");

test("las herramientas que necesitan conversaciones no se le pasan a un negocio sin ellas", () => {
  const p = panoramaSoloAds();
  const { usables, faltantes } = herramientasDisponibles(p);
  assert.equal(usables.some((h) => h.nombre === "calidadDeLeads"), false);
  assert.ok(faltantes.some((f) => f.nombre === "calidadDeLeads"));
  // Y las de publicidad sí están: el copiloto sirve igual.
  assert.ok(usables.some((h) => h.nombre === "rendimientoPorCampanaPublicitaria"));
});

test("el prompt le dice al modelo qué NO puede saber, en vez de pasarle una herramienta vacía", () => {
  const p = panoramaSoloAds();
  const prompt = promptCopiloto({ pregunta: "¿qué campaña trae mejores clientes?", panorama: p, contextoMarca: "", hilo: [] });
  assert.match(prompt, /LO QUE HOY NO PODEMOS SABER/);
  assert.match(prompt, /no recibe las conversaciones/i);
  assert.match(prompt, /NUNCA contestes una pregunta distinta/);
});

test("con todas las señales, el prompt no inventa faltantes", () => {
  const prompt = promptCopiloto({ pregunta: "¿cómo vamos?", panorama: panoramaCompleto(), contextoMarca: "", hilo: [] });
  assert.doesNotMatch(prompt, /LO QUE HOY NO PODEMOS SABER/);
});

test("el prompt prohíbe sumar resultados de tipos distintos", () => {
  const prompt = promptCopiloto({ pregunta: "resumen", panorama: panoramaCompleto(), contextoMarca: "", hilo: [] });
  assert.match(prompt, /NO sumes ni compares resultados de tipos distintos/);
});

test("las preguntas sugeridas no ofrecen lo que no se puede responder", () => {
  const sugeridas = preguntasPara(panoramaSoloAds());
  assert.equal(sugeridas.some((q) => /mejores clientes/i.test(q)), false);
  assert.ok(sugeridas.some((q) => /presupuesto|rindiendo|rindien/i.test(q)));
});

test("toda herramienta declara qué señal exige, o ninguna", () => {
  for (const h of HERRAMIENTAS) {
    if (h.exige !== undefined) {
      assert.ok(["ads", "conversiones", "conversaciones", "ingresos"].includes(h.exige), h.nombre);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   8. EL ARQUITECTO DE CAMPAÑAS
   ══════════════════════════════════════════════════════════════════════════ */

test("el destino ya no es WhatsApp por defecto: depende de lo que el negocio puede medir", () => {
  const sinWhatsapp = destinosPosibles({ ...senalesVacias(), ads: true }, false);
  const wa = sinWhatsapp.find((d) => d.destino === "whatsapp");
  assert.equal(wa.posible, false);
  assert.match(wa.motivo, /no tiene WhatsApp conectado/i);
  assert.equal(sinWhatsapp.find((d) => d.destino === "sitio_web").posible, true);
});

test("el tipo del borrador dejó de tener «whatsapp» escrito a fuego", () => {
  const fuente = codigo("lib/marketing/tipos.ts");
  assert.doesNotMatch(fuente, /destino:\s*"whatsapp"/, "era el supuesto de toda la sección escrito en el tipo");
  assert.match(fuente, /destino:\s*Destino/);
});

test("la intención de búsqueda se decide con una heurística auditable, no con un modelo", () => {
  assert.equal(hayIntencionDeBusqueda("Quiero clientes que necesiten abogado laboral en Santiago"), true);
  assert.equal(hayIntencionDeBusqueda("Quiero dar a conocer mi marca de ropa nueva"), false);
});

test("con intención de búsqueda, la mayor parte del presupuesto va a Google", () => {
  const r = repartirPresupuesto(600_000, ["meta", "google"], true);
  const g = r.find((x) => x.canal === "google");
  const m = r.find((x) => x.canal === "meta");
  assert.ok(g.parte > m.parte);
  assert.equal(g.diario + m.diario, Math.round((600_000 * 0.65) / 30) + Math.round((600_000 * 0.35) / 30));
});

test("un presupuesto chico NO se reparte entre dos canales: se concentra", () => {
  const r = repartirPresupuesto(90_000, ["meta", "google"], true);
  assert.equal(r.length, 1, "repartido, cada campaña quedaría bajo el piso y ninguna aprendería nada");
  assert.ok(r[0].diario >= PISO_DIARIO_CAMPANA);
});

test("sin presupuesto declarado el plan no inventa un diario", () => {
  const r = repartirPresupuesto(null, ["meta"], false);
  assert.equal(r[0].diario, null);
});

test("el tracking dice lo que NO se va a poder medir", () => {
  const soloAds = { ...senalesVacias(), ads: true, conversiones: true };
  const t = armarTracking("abogado laboral santiago", "whatsapp", "meta", soloAds);
  assert.ok(t.loQueNoSeMide.some((x) => /no trae las conversaciones/i.test(x)));

  const web = armarTracking("abogado laboral santiago", "sitio_web", "google", soloAds);
  assert.equal(web.utm.source, "google");
  assert.equal(web.utm.campaign, "abogado-laboral-santiago");
});

test("los UTM son deterministas: el mismo objetivo da el mismo slug", () => {
  assert.equal(slug("Impresión de Planos A1 — Chillán"), "impresion-de-planos-a1-chillan");
  assert.equal(slug("Impresión de Planos A1 — Chillán"), slug("impresión de planos a1 — chillán"));
});

test("los textos se recortan a los límites reales de cada plataforma", () => {
  const largo = "x".repeat(200);
  assert.ok(recortar(largo, LIMITES.meta.titular).length <= LIMITES.meta.titular);
  assert.ok(recortar(largo, LIMITES.google.titular).length <= LIMITES.google.titular);
});

const planBase = () => ({
  objetivoNegocio: "Clientes de derecho laboral en Santiago",
  presupuestoMensual: 300_000,
  moneda: "CLP",
  duracionDias: 30,
  estrategiaCanal: [{ canal: "google", parte: 1, porQue: "Hay búsqueda explícita" }],
  campanas: [
    {
      canal: "google",
      nombre: "Búsqueda · Laboral",
      objetivo: "Búsqueda",
      presupuestoDiario: 10_000,
      destino: "sitio_web",
      destinoDetalle: "https://ejemplo.cl",
      conjuntos: [],
      grupos: [
        {
          nombre: "Despido injustificado",
          palabras: [
            { texto: "abogado laboral santiago", concordancia: "frase" },
            { texto: "despido injustificado", concordancia: "exacta" },
          ],
          negativasSugeridas: ["gratis"],
          titulares: ["Abogado laboral", "Primera consulta", "Estudio en Santiago"],
          descripciones: ["Evaluamos tu caso", "Respuesta en 24 horas"],
        },
      ],
    },
  ],
  angulos: [
    { nombre: "Problema", tipo: "problema", gancho: "¿Te despidieron?", titular: "¿Te despidieron?", texto: "t", cta: "Más información", direccionVisual: "v" },
    { nombre: "Confianza", tipo: "confianza", gancho: "Estudio con 12 años", titular: "Estudio laboral", texto: "t", cta: "Más información", direccionVisual: "v" },
  ],
  tracking: { utm: null, loQueSeMide: [], loQueNoSeMide: [] },
  hipotesis: { enunciado: "h", senalPrincipal: "Costo por conversión", senalesSecundarias: [], senalRespondo: null },
  advertencias: [],
});

test("un plan de Google válido pasa la revisión", () => {
  assert.deepEqual(revisarPlan(planBase()), []);
});

test("la revisión atrapa una negativa que bloquearía una palabra del propio grupo", () => {
  const plan = planBase();
  plan.campanas[0].grupos[0].negativasSugeridas = ["laboral"];
  const problemas = revisarPlan(plan);
  assert.ok(problemas.some((p) => /bloquearía la palabra clave/i.test(p.problema)));
});

test("la revisión exige los mínimos de titulares y descripciones de Google", () => {
  const plan = planBase();
  plan.campanas[0].grupos[0].titulares = ["uno"];
  plan.campanas[0].grupos[0].descripciones = [];
  const problemas = revisarPlan(plan);
  assert.ok(problemas.some((p) => /titulares/i.test(p.problema)));
  assert.ok(problemas.some((p) => /descripciones/i.test(p.problema)));
});

test("un solo ángulo no se puede comparar contra nada", () => {
  const plan = planBase();
  plan.angulos = [plan.angulos[0]];
  assert.ok(revisarPlan(plan).some((p) => p.campo === "creatividades"));
});

test("el plan en texto trae todo lo que la plataforma va a pedir", () => {
  const texto = planEnTexto(planBase());
  assert.match(texto, /ESTRATEGIA DE CANAL/);
  assert.match(texto, /Palabras: abogado laboral santiago \[frase\]/);
  assert.match(texto, /ÁNGULOS CREATIVOS/);
  assert.match(texto, /HIPÓTESIS/);
});

/* ══════════════════════════════════════════════════════════════════════════
   9. LA DEMOSTRACIÓN — tres negocios, un solo dominio
   ══════════════════════════════════════════════════════════════════════════ */

test("la demo solo-Meta no muestra conversaciones ni leads", () => {
  const p = panoramaSoloAds();
  assert.equal(p.senales.conversaciones, false);
  assert.equal(p.leads.length, 0);
  assert.equal(p.campanas.some((c) => c.proveedor === "google"), false);
  assert.ok(p.filasAds.length > 0, "pero sí muestra publicidad");
});

test("la demo de Google trae palabras clave y términos", () => {
  const p = panoramaDemo(resolverRango("30d"), "google");
  assert.ok(p.filasAds.some((f) => f.nivel === "termino"));
  assert.ok(p.filasAds.some((f) => f.nivel === "palabra"));
  assert.equal(p.filasAds.some((f) => f.proveedor === "meta"), false);
});

test("la demo completa conserva el circuito cerrado", () => {
  const p = panoramaCompleto();
  assert.equal(p.senales.conversaciones, true);
  assert.equal(p.senales.ingresos, true);
  assert.ok(p.leads.length > 0);
  assert.ok(p.embudo.some((e) => e.clave === "ventas"));
});

test("la demo no muestra campos que producción no podría llenar", () => {
  const p = panoramaSoloAds();
  // Sin conversaciones no hay hallazgos de atribución inventados.
  assert.equal(p.hallazgos.length, 0);
  assert.equal(p.sinAnuncio, 0);
});

/* ══════════════════════════════════════════════════════════════════════════
   10. SEGURIDAD Y AISLAMIENTO (lo que no puede relajarse)
   ══════════════════════════════════════════════════════════════════════════ */

test("ninguna ruta nueva de Google acepta el cliente_id desde el navegador", () => {
  for (const ruta of ["app/api/ads/google/conectar/route.ts", "app/api/ads/google/callback/route.ts"]) {
    const fuente = codigo(ruta);
    assert.doesNotMatch(fuente, /searchParams\.get\("clienteId"\)/, ruta);
  }
  const callback = codigo("app/api/ads/google/callback/route.ts");
  assert.match(callback, /verificarEstado\(estado, "ads-google-estado"\)/);
  assert.match(callback, /vinculoValido\(/, "el state tiene que haber salido de este navegador");
});

test("las acciones de Google sacan el cliente de la sesión y filtran por él", () => {
  const fuente = codigo("app/(marketing)/marketing/integraciones/acciones.ts");
  assert.match(fuente, /elegirCuentaGoogle/);
  // Todo update de la conexión lleva su filtro por cliente y por proveedor.
  const bloques = fuente.split("export async function").filter((b) => /Google/.test(b));
  for (const b of bloques) {
    if (!/from\("ed_ads_conexion"\)/.test(b)) continue;
    assert.match(b, /\.eq\("cliente_id", usuario\.clienteId\)/);
    assert.match(b, /\.eq\("proveedor", "google"\)/);
  }
});

test("el token de Google nunca sale del módulo ni se registra", () => {
  const fuente = codigo("lib/ads/google.ts");
  // El refresh token no se imprime en ningún log.
  assert.doesNotMatch(fuente, /console\.(log|error)\([^)]*refreshToken/);
  assert.doesNotMatch(fuente, /console\.(log|error)\([^)]*token\b/);
});

test("Respondo sigue sin publicar campañas por API en ninguna plataforma", () => {
  assert.match(codigo("lib/marketing/capacidades.ts"), /PUEDE_PUBLICAR_EN_META = false/);
  const google = codigo("lib/ads/google.ts");
  assert.doesNotMatch(google, /:mutate|googleAds:mutate/, "solo lectura");
  assert.doesNotMatch(google, /method:\s*"POST"[\s\S]{0,200}mutate/);
});

test("el plan se guarda por la capa de aislamiento, no con db() a mano", () => {
  const fuente = codigo("app/(marketing)/marketing/arquitecto/acciones.ts");
  assert.doesNotMatch(fuente, /db\(\)\s*\.from\("ed_mk_campanas"\)/);
  assert.match(fuente, /modificarEn\(usuario\.clienteId, "ed_mk_campanas"/);
});

/* ══════════════════════════════════════════════════════════════════════════
   11. FALLAS EXTERNAS: una plataforma caída no tumba la otra
   ══════════════════════════════════════════════════════════════════════════ */

test("cada canal falla por su cuenta y el otro sigue mostrando datos", () => {
  const fuente = codigo("lib/ads/canales.ts");
  assert.match(fuente, /Promise\.all/);
  // Cada resultado se envuelve con su falla; no hay un throw global.
  assert.match(fuente, /fallas:/);
  assert.doesNotMatch(fuente, /throw new Error/);
});

test("el mensaje de error nombra al proveedor correcto", async () => {
  const { mensajeDeFalla } = await import("../lib/ads/canales.ts");
  const meta = mensajeDeFalla("meta", "token_vencido");
  const google = mensajeDeFalla("google", "token_vencido");
  assert.match(meta, /Meta/);
  assert.doesNotMatch(google, /\bMeta\b/, "decirle «reconecta Meta» a quien perdió Google lo manda a la pantalla equivocada");
});

test("los niveles profundos de Google no se piden en la carga del inicio", () => {
  const fuente = codigo("lib/marketing/datos.ts");
  assert.match(fuente, /rendimientoMulticanal\(clienteId, rango, \["campana"\]\)/);
  assert.doesNotMatch(fuente, /NIVELES_BUSQUEDA/, "cinco consultas para dibujar seis KPI");
});

test("la migración nueva es aditiva y conserva los estados viejos", () => {
  const sql = leer("sql/309_ads_google_y_planes.sql");
  assert.match(sql, /add column if not exists cuenta_padre_id/);
  assert.match(sql, /add column if not exists plan jsonb/);
  // El check nuevo tiene que seguir aceptando lo que ya existe en la base.
  for (const estado of ["borrador", "lista", "requiere_meta", "requiere_permiso", "publicada"]) {
    assert.match(sql, new RegExp(`'${estado}'`), `el estado ${estado} tiene que seguir siendo válido`);
  }
  assert.match(sql, /'requiere_conexion'/);
});
