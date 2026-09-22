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
import {
  MINIMOS,
  analizarAds,
  comparables,
  estaActiva,
  evaluarNegativa,
  mediana,
  negativaBloquea,
  tokens,
  umbralGastoSinResultado,
} from "../lib/ads/analisis.ts";
import { armarEmbudoAdaptativo, tituloEmbudo } from "../lib/marketing/embudoAdaptativo.ts";
import {
  CLICS_DIARIOS_PARA_APRENDER,
  LIMITES,
  PISOS_DIARIOS_SEMILLA,
  armarTracking,
  cpcDe,
  pisoDiarioDe,
  semillasDeEntorno,
  destinosPosibles,
  hayIntencionDeBusqueda,
  planEnTexto,
  recortar,
  repartirPresupuesto,
  revisarPlan,
  slug,
} from "../lib/marketing/arquitectoCore.ts";
import { MONEDA_DESCONOCIDA, formatearMonto } from "../lib/ads/moneda.ts";
import { ERRORES } from "../lib/ads/proveedor.ts";
import { mensajeDeFalla } from "../lib/ads/canales.ts";
import {
  CATEGORIAS_BLANDAS,
  composicionDesdeFilas,
  fusionarComposicion,
  gaqlComposicion,
  leerComposicion,
  tipoDeCategoria,
} from "../lib/ads/googleConversiones.ts";
import { escalaDePresupuesto, HERRAMIENTAS, herramientasDisponibles, preguntasPara, promptCopiloto } from "../lib/marketing/copilotoCore.ts";
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

const usd = (valor) => ({ valor, moneda: "USD" });

test("con la medición muda se avisa, y NO se opina de conversiones", () => {
  const sinConversiones = campana({ clics: 400, resultados: null });
  const r = analizarAds(ctx([sinConversiones]));
  assert.ok(r.insights.some((i) => i.clave === "medicion_muda"));
  assert.ok(r.recomendaciones.every((x) => x.accion === "revisar"));
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("pausar_")), false);
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("escalar_")), false);
});

/* ── BUG-05: inteligencia de conversión ≠ inteligencia de entrega ─────────── */

test("BUG-05 · con la medición muda sobreviven CTR, CPM y desgaste creativo", () => {
  // Antes esto devolvía UN solo insight y cortaba: el negocio con la medición
  // rota —el que más lo necesita— se quedaba sin ver que su anuncio se gastó.
  const ahora = campana({
    clics: 400,
    impresiones: 40_000,
    frecuencia: 4.2,
    resultados: null,
    gasto: clp(300_000),
  });
  const antes = campana({
    clics: 1_200,
    impresiones: 40_000,
    frecuencia: 2.1,
    resultados: null,
    gasto: clp(150_000),
  });
  const r = analizarAds(ctx([ahora], [antes]));

  assert.ok(r.insights.some((i) => i.clave === "medicion_muda"), "la alerta de medición sigue primero");
  assert.ok(r.insights.some((i) => i.clave.startsWith("ctr_")), "el CTR no depende de las conversiones");
  assert.ok(r.insights.some((i) => i.clave.startsWith("cpm_")), "el CPM tampoco");
  assert.ok(r.insights.some((i) => i.clave.startsWith("desgaste_")), "ni la frecuencia");
  assert.ok(r.insuficientes.some((i) => i.clave === "sin_conversiones_medidas"));
  // Pero nada que dependa de conversiones.
  assert.equal(
    r.recomendaciones.some((x) => ["escalar", "reducir"].includes(x.accion)),
    false,
  );
});

test("BUG-05 · con la medición muda, el reparto del gasto entre términos sigue siendo un hecho", () => {
  const base = campana({ proveedor: "google", objetivo: "Búsqueda", clics: 400, resultados: null, gasto: clp(300_000) });
  const filas = [
    base,
    termino("imprenta chillan", { gasto: clp(200_000), clics: 120, resultados: null }),
    termino("imprenta barata", { gasto: clp(50_000), clics: 30, resultados: null }),
    termino("imprenta cerca", { gasto: clp(50_000), clics: 30, resultados: null }),
  ];
  const r = analizarAds(ctx(filas));
  assert.ok(r.insights.some((i) => i.clave === "termino_concentra_imprenta chillan"));
});

/* ── BUG-04: nunca se suman escalares de monedas distintas ────────────────── */

test("BUG-04 · dos cuentas en monedas distintas se analizan por separado", () => {
  const clpGrande = campana({ id: "clp-1", proveedor: "google", nombre: "Búsqueda CLP", gasto: clp(900_000), resultados: { cantidad: 30, tipo: "conversiones_web" } });
  const clpChica = campana({ id: "clp-2", proveedor: "google", nombre: "Display CLP", gasto: clp(100_000), resultados: { cantidad: 4, tipo: "conversiones_web" } });
  const enDolares = campana({ id: "usd-1", nombre: "Meta USD", gasto: usd(5_000), resultados: { cantidad: 200, tipo: "mensajes" } });

  const r = analizarAds(ctx([clpGrande, clpChica, enDolares]));

  assert.ok(
    r.insuficientes.some((i) => i.clave === "monedas_mezcladas" && /CLP/.test(i.queFalta) && /USD/.test(i.queFalta)),
    "hay que DECIR que no se suman, no sumarlas en silencio",
  );

  const conc = r.insights.find((i) => i.clave.startsWith("concentracion_"));
  assert.ok(conc, "dentro de CLP sí hay concentración real");
  assert.match(conc.evidencia, /\$900\.000 de \$1\.000\.000/, "el total es el de SU moneda, no 1.005.000");

  // Ninguna cifra en pesos puede llevar el símbolo de dólares ni al revés.
  for (const rec of r.recomendaciones) {
    const suya = [clpGrande, clpChica, enDolares].find((c) => c.id === rec.entidad.id);
    assert.equal(rec.moneda, suya.gasto.moneda);
  }
});

test("BUG-04 · el umbral se niega a existir si le pasan monedas mezcladas", () => {
  const mezcla = [
    campana({ id: "a", gasto: clp(100_000), resultados: { cantidad: 20, tipo: "mensajes" } }),
    campana({ id: "b", gasto: usd(150), resultados: { cantidad: 5, tipo: "mensajes" } }),
  ];
  assert.equal(umbralGastoSinResultado(mezcla), null);
});

test("BUG-04 · una cuenta sin moneda declarada no se convierte en pesos", () => {
  const anonima = campana({ gasto: { valor: 100_000, moneda: "" }, clics: 400, resultados: null });
  const r = analizarAds(ctx([anonima]));
  assert.ok(r.insuficientes.some((i) => i.clave === "moneda_desconocida"));
  assert.equal(
    JSON.stringify(r).includes("$100.000"),
    false,
    "sin moneda conocida la cifra sale sin símbolo: «100.000», no «$100.000»",
  );
});

/* ── BUG-06: la fatiga necesita una caída MATERIAL ────────────────────────── */

test("BUG-06 · un CTR de 2,50% a 2,49% NO es desgaste creativo", () => {
  const antes = campana({ impresiones: 40_000, clics: 1_000 }); // 2,50%
  const ahora = campana({ impresiones: 40_000, clics: 996, frecuencia: 4.1 }); // 2,49%
  const r = analizarAds(ctx([ahora], [antes]));
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("rotar_")), false);
  const d = r.insights.find((i) => i.clave.startsWith("desgaste_"));
  assert.ok(d, "la frecuencia alta sí es un hecho y se reporta");
  assert.match(d.evidencia, /ruido/i);
  assert.equal(d.tono, "neutro");
});

test("BUG-06 · una caída material de CTR con frecuencia alta SÍ es desgaste", () => {
  const antes = campana({ impresiones: 40_000, clics: 1_200 }); // 3,0%
  const ahora = campana({ impresiones: 40_000, clics: 600, frecuencia: 4.1 }); // 1,5%
  const r = analizarAds(ctx([ahora], [antes]));
  assert.ok(r.recomendaciones.some((x) => x.clave.startsWith("rotar_")));
  assert.equal(r.insights.find((i) => i.clave.startsWith("desgaste_")).tono, "alerta");
});

test("BUG-06 · sin volumen en el período anterior no se afirma desgaste", () => {
  const antes = campana({ impresiones: 200, clics: 6 });
  const ahora = campana({ impresiones: 40_000, clics: 600, frecuencia: 4.1 });
  const r = analizarAds(ctx([ahora], [antes]));
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("rotar_")), false);
  assert.match(r.insights.find((i) => i.clave.startsWith("desgaste_")).evidencia, /volumen suficiente/i);
});

test("BUG-06 · el umbral de materialidad es reemplazable", () => {
  const antes = campana({ impresiones: 40_000, clics: 1_000 });
  const ahora = campana({ impresiones: 40_000, clics: 900, frecuencia: 4.1 }); // −10%
  assert.equal(
    analizarAds(ctx([ahora], [antes])).recomendaciones.some((x) => x.clave.startsWith("rotar_")),
    false,
  );
  const exigente = analizarAds({ ...ctx([ahora], [antes]), umbrales: { caidaCtrMaterial: 5 } });
  assert.ok(exigente.recomendaciones.some((x) => x.clave.startsWith("rotar_")));
});

/* ── BUG-07: no se recomienda tocar lo que está pausado ───────────────────── */

test("BUG-07 · no se propone escalar una campaña pausada", () => {
  const ahora = campana({ estado: "pausada", gasto: clp(100_000), resultados: { cantidad: 40, tipo: "mensajes" } });
  const antes = campana({ estado: "pausada", gasto: clp(200_000), resultados: { cantidad: 40, tipo: "mensajes" } });
  const r = analizarAds(ctx([ahora], [antes]));
  assert.ok(r.insights.some((i) => i.clave.startsWith("costo_resultado_")), "el hecho se reporta igual");
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("escalar_")), false);

  const viva = analizarAds(ctx([{ ...ahora, estado: "activa" }], [antes]));
  assert.ok(viva.recomendaciones.some((x) => x.clave.startsWith("escalar_")), "activa sí se puede escalar");
});

test("BUG-07 · no se propone reducir ni rotar una campaña terminada", () => {
  const cara = campana({ id: "cara", estado: "terminada", gasto: clp(400_000), resultados: { cantidad: 5, tipo: "mensajes" } });
  const pares = [1, 2, 3].map((n) =>
    campana({ id: `p${n}`, gasto: clp(100_000), resultados: { cantidad: 25, tipo: "mensajes" } }),
  );
  const r = analizarAds(ctx([cara, ...pares]));
  assert.ok(r.insights.some((i) => i.clave === "caro_vs_pares_meta|campana|cara"));
  assert.equal(r.recomendaciones.some((x) => x.clave === "reducir_meta|campana|cara"), false);
});

test("BUG-07 · estaActiva distingue lo que se puede tocar", () => {
  assert.equal(estaActiva({ estado: "activa" }), true);
  assert.equal(estaActiva({ estado: "desconocido" }), true, "sin dato no se asume pausada");
  assert.equal(estaActiva({ estado: "pausada" }), false);
  assert.equal(estaActiva({ estado: "terminada" }), false);
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

const baseBusqueda = () =>
  campana({
    proveedor: "google",
    objetivo: "Búsqueda",
    resultados: { cantidad: 30, tipo: "conversiones_web" },
    gasto: clp(300_000),
  });

test("NO se propone excluir un término que ES una palabra clave activa", () => {
  const filas = [baseBusqueda(), palabra("impresion de planos"), termino("impresion de planos")];
  const r = analizarAds(ctx(filas));
  assert.equal(
    r.recomendaciones.some((x) => x.clave === "negativa_impresion de planos"),
    false,
    "excluir el término idéntico a la palabra clave la deja sin servir",
  );
  assert.ok(r.insuficientes.some((i) => i.clave.startsWith("negativa_riesgosa_")));
});

/* ── BUG-09: el modelo de negativas, no un `includes` ─────────────────────── */

test("BUG-09 · una negativa de UNA palabra avisa qué mataría en concordancia amplia", () => {
  // El caso real de junio de 2026: la negativa «sublimacion» dejó ciego un
  // grupo entero. En exacta es segura; en amplia mata «sublimacion textil».
  const v = evaluarNegativa("sublimacion", ["sublimacion textil", "sublimacion en tazones"]);
  assert.equal(v.concordancia, "exacta", "solo la exacta no deja sin servir a esas palabras");
  assert.deepEqual(v.bloqueaEnAmplia, ["sublimacion textil", "sublimacion en tazones"]);

  const filas = [baseBusqueda(), palabra("sublimacion textil"), termino("sublimacion")];
  const r = analizarAds(ctx(filas));
  const rec = r.recomendaciones.find((x) => x.clave === "negativa_sublimacion");
  assert.ok(rec, "se propone, pero acotada");
  assert.match(rec.que, /concordancia exacta/i);
  assert.match(rec.porQue, /AMPLIA/);
  assert.match(rec.porQue, /sublimacion textil/);
});

test("BUG-09 · un substring que no es una palabra ya NO cuenta como choque", () => {
  // `"autor".includes("auto")` es true y bloqueaba la propuesta. En Google no
  // existe ese choque: son dos palabras distintas.
  assert.equal(negativaBloquea("auto", "frase", "autor de libros"), false);
  assert.equal(negativaBloquea("impresion", "frase", "impresiones grandes"), false);
  assert.equal(negativaBloquea("planos", "frase", "impresion de planos"), true);

  const filas = [baseBusqueda(), palabra("autor de libros"), termino("auto usado barato")];
  const r = analizarAds(ctx(filas));
  assert.ok(
    r.recomendaciones.some((x) => x.clave === "negativa_auto usado barato"),
    "no choca con nada: tiene que proponerse",
  );
});

test("BUG-09 · una palabra clave PAUSADA no puede vetar una negativa", () => {
  const filas = [
    baseBusqueda(),
    palabra("sublimacion textil", { estado: "pausada" }),
    palabra("imprenta chillan"),
    termino("sublimacion"),
  ];
  const r = analizarAds(ctx(filas));
  const rec = r.recomendaciones.find((x) => x.clave === "negativa_sublimacion");
  assert.ok(rec, "la pausada no está trayendo tráfico: no se puede cegar");
  assert.match(rec.que, /concordancia frase/i, "sin palabras activas que choquen, la frase es segura");
});

test("BUG-09 · las tildes no crean términos nuevos ni choques falsos", () => {
  assert.deepEqual(tokens("Impresión de Planos A1"), ["impresion", "de", "planos", "a1"]);
  const filas = [
    baseBusqueda(),
    palabra("impresión de planos"),
    termino("Impresion De Planos", { resultados: { cantidad: 8, tipo: "conversiones_web" } }),
  ];
  const r = analizarAds(ctx(filas));
  assert.equal(
    r.insights.some((i) => i.clave === "termino_gana_Impresion De Planos"),
    false,
    "ya es palabra clave propia, solo cambia la tilde",
  );
});

test("BUG-09 · un término ya excluido en la cuenta no se vuelve a proponer", () => {
  const filas = [
    baseBusqueda(),
    palabra("imprenta chillan"),
    termino("trabajos de imprenta sueldo", { extra: { estadoTermino: "EXCLUDED" } }),
  ];
  const r = analizarAds(ctx(filas));
  assert.equal(r.recomendaciones.some((x) => x.clave.startsWith("negativa_")), false);
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

test("el presupuesto sugerido sale del gasto de la cuenta y de SU moneda", () => {
  // Decía «entre $2.000 y $10.000» en duro: pesos chilenos escritos a fuego,
  // que en una cuenta en dólares proponen gastar diez mil dólares al día.
  const p = panoramaCompleto();
  const enDolares = {
    ...p,
    campanas: [],
    filasAds: p.filasAds.map((f) =>
      f.nivel === "campana" ? { ...f, gasto: { ...f.gasto, moneda: "USD" } } : f,
    ),
  };
  const escala = escalaDePresupuesto(enDolares);
  assert.equal(escala.moneda, "USD");
  const prompt = promptCopiloto({ pregunta: "créame una campaña", panorama: enDolares, contextoMarca: "", hilo: [] });
  assert.doesNotMatch(prompt, /\$2\.000|\$10\.000/);
  assert.match(prompt, /presupuesto diario sugerido entre .*USD y .*USD/);
});

test("sin gasto observado el prompt prohíbe inventar una cifra de presupuesto", () => {
  const p = panoramaCompleto();
  const sinGasto = { ...p, filasAds: [], campanas: [] };
  assert.equal(escalaDePresupuesto(sinGasto), null);
  const prompt = promptCopiloto({ pregunta: "créame una campaña", panorama: sinGasto, contextoMarca: "", hilo: [] });
  assert.match(prompt, /NO sugieras ninguna cifra de presupuesto/);
});

test("dos monedas a la vez no se suman ni se convierten: no se sugiere presupuesto", () => {
  // Meta en CLP y Google en USD: una sola cifra ahí sería mentira en las dos.
  const p = panoramaCompleto();
  const campanas = p.filasAds.filter((f) => f.nivel === "campana");
  if (campanas.length >= 2) {
    const mezcla = {
      ...p,
      campanas: [],
      filasAds: p.filasAds.map((f, i) =>
        f.nivel === "campana" && i % 2 === 0 ? { ...f, gasto: { ...f.gasto, moneda: "USD" } } : f,
      ),
    };
    assert.equal(escalaDePresupuesto(mezcla), null);
  }
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

const pisoCLP = pisoDiarioDe({ moneda: "CLP" });

test("con intención de búsqueda, la mayor parte del presupuesto va a Google", () => {
  const r = repartirPresupuesto(clp(600_000), ["meta", "google"], true, pisoCLP);
  const g = r.find((x) => x.canal === "google");
  const m = r.find((x) => x.canal === "meta");
  assert.ok(g.parte > m.parte);
  assert.equal(g.diario.valor + m.diario.valor, 600_000 / 30);
  assert.equal(g.diario.moneda, "CLP", "el diario lleva su moneda, no es un escalar");
});

test("un presupuesto chico NO se reparte entre dos canales: se concentra", () => {
  const r = repartirPresupuesto(clp(90_000), ["meta", "google"], true, pisoCLP);
  assert.equal(r.length, 1, "repartido, cada campaña quedaría bajo el piso y ninguna aprendería nada");
  assert.ok(r[0].diario.valor >= pisoCLP.monto.valor);
});

test("sin presupuesto declarado el plan no inventa un diario", () => {
  const r = repartirPresupuesto(null, ["meta"], false, pisoCLP);
  assert.equal(r[0].diario, null);
});

/* ── BUG-01: el piso es aprendizaje, no una constante en pesos ────────────── */

test("BUG-01 · un presupuesto sano en dólares NO colapsa a un solo canal", () => {
  // US$600 al mes = US$20 al día. Con el piso viejo (2.000 «lo que fuera»)
  // 20 < 2000 y el reparto se concentraba en un canal sin que nadie lo pidiera.
  const piso = pisoDiarioDe({ moneda: "USD", cpc: { valor: 0.5, moneda: "USD" } });
  assert.ok(piso, "con CPC observado en USD sí hay piso");
  assert.equal(piso.monto.moneda, "USD");
  assert.equal(piso.monto.valor, 0.5 * CLICS_DIARIOS_PARA_APRENDER);

  const r = repartirPresupuesto({ valor: 600, moneda: "USD" }, ["meta", "google"], true, piso);
  assert.equal(r.length, 2, "US$20 al día alcanza para dos canales: 13 y 7 contra un piso de 4");
});

test("BUG-01 · un plan en dólares no queda trabado por un piso en pesos", () => {
  const plan = planBase();
  plan.moneda = "USD";
  plan.presupuestoMensual = { valor: 600, moneda: "USD" };
  plan.campanas[0].presupuestoDiario = { valor: 20, moneda: "USD" };
  plan.piso = pisoDiarioDe({ moneda: "USD", cpc: { valor: 0.5, moneda: "USD" } });
  const problemas = revisarPlan(plan);
  assert.equal(problemas.length, 0, `no debería haber problemas: ${JSON.stringify(problemas)}`);
});

test("BUG-01 · sin moneda conocida no se exige piso, y no se inventa CLP", () => {
  assert.equal(pisoDiarioDe({ moneda: MONEDA_DESCONOCIDA }), null);
  assert.equal(pisoDiarioDe({ moneda: "" }), null);
  const plan = planBase();
  plan.moneda = MONEDA_DESCONOCIDA;
  plan.presupuestoMensual = { valor: 600, moneda: MONEDA_DESCONOCIDA };
  plan.campanas[0].presupuestoDiario = { valor: 20, moneda: MONEDA_DESCONOCIDA };
  plan.piso = null;
  assert.equal(revisarPlan(plan).length, 0);
  // Y el monto se escribe sin símbolo: «20» no es «$20».
  assert.equal(formatearMonto({ valor: 20, moneda: MONEDA_DESCONOCIDA }), "20");
});

test("BUG-01 · el piso observado manda sobre la semilla configurada", () => {
  const conHistoria = pisoDiarioDe({ moneda: "CLP", cpc: clp(400) });
  assert.equal(conHistoria.origen, "observado");
  assert.equal(conHistoria.monto.valor, 400 * CLICS_DIARIOS_PARA_APRENDER);
  const sinHistoria = pisoDiarioDe({ moneda: "CLP" });
  assert.equal(sinHistoria.origen, "configurado");
  assert.equal(sinHistoria.monto.valor, PISOS_DIARIOS_SEMILLA.CLP);
});

test("BUG-01 · un CPC en otra moneda se ignora: no se inventa tipo de cambio", () => {
  const p = pisoDiarioDe({ moneda: "CLP", cpc: { valor: 0.5, moneda: "USD" } });
  assert.equal(p.origen, "configurado", "el CPC en dólares no puede fijar un piso en pesos");
});

test("BUG-01 · el CPC se calcula por moneda y nunca mezcla monedas", () => {
  const filas = [
    { gasto: clp(100_000), clics: 500 },
    { gasto: { valor: 200, moneda: "USD" }, clics: 100 },
    { gasto: { valor: 9_999, moneda: MONEDA_DESCONOCIDA }, clics: 9_999 },
  ];
  assert.equal(cpcDe(filas, "CLP").valor, 200);
  assert.equal(cpcDe(filas, "USD").valor, 2);
  assert.equal(cpcDe(filas, MONEDA_DESCONOCIDA), null);
  assert.equal(cpcDe(filas, "EUR"), null, "sin filas en esa moneda no hay CPC");
});

test("BUG-01 · el mínimo por moneda es configuración reemplazable", () => {
  const s = semillasDeEntorno("USD:5, EUR:4,basura, XXX:0");
  assert.equal(s.USD, 5);
  assert.equal(s.EUR, 4);
  assert.equal(s.CLP, PISOS_DIARIOS_SEMILLA.CLP, "la semilla de fábrica se conserva");
  assert.equal(s.XXX, undefined, "un piso de cero no es un piso");
  assert.equal(pisoDiarioDe({ moneda: "USD", semillas: s }).monto.valor, 5);
});

test("BUG-01 · una moneda sin piso configurado y sin historia no exige nada", () => {
  assert.equal(pisoDiarioDe({ moneda: "JPY" }), null);
  const r = repartirPresupuesto({ valor: 90_000, moneda: "JPY" }, ["meta", "google"], true, null);
  assert.equal(r.length, 2, "no saber el piso no es «está bajo el piso»");
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
  presupuestoMensual: { valor: 300_000, moneda: "CLP" },
  moneda: "CLP",
  piso: pisoDiarioDe({ moneda: "CLP" }),
  duracionDias: 30,
  estrategiaCanal: [{ canal: "google", parte: 1, porQue: "Hay búsqueda explícita" }],
  campanas: [
    {
      canal: "google",
      nombre: "Búsqueda · Laboral",
      objetivo: "Búsqueda",
      presupuestoDiario: { valor: 10_000, moneda: "CLP" },
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

test("Respondo solo publica en Meta en PAUSA y la lectura de Google sigue sin mutar", () => {
  // Desde 6ed3084 Respondo SÍ publica en Meta (lib/ads/metaPublicar.ts), pero
  // nunca activo: campaña, conjunto y anuncio nacen en PAUSED y ningún camino
  // manda ACTIVE. Este test antes exigía que no se publicara nada y quedó viejo.
  const publicador = codigo("lib/ads/metaPublicar.ts");
  assert.equal((publicador.match(/status: "PAUSED"/g) ?? []).length, 3, "campaña, adset y anuncio en PAUSED");
  assert.doesNotMatch(publicador, /"ACTIVE"/);
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

/* ══════════════════════════════════════════════════════════════════════════
   BUG-08 — QUÉ SON, DE VERDAD, LAS CONVERSIONES DE GOOGLE
   ══════════════════════════════════════════════════════════════════════════ */

const filaComposicion = (campanaId, categoria, conversiones) => ({
  campaign: { id: campanaId },
  segments: { conversionActionCategory: categoria },
  metrics: { conversions: conversiones },
});

test("BUG-08 · segmentar por acción de conversión NO duplica gasto ni clics", () => {
  // Tres categorías para la MISMA campaña. Si la composición se hubiera pedido
  // como un segmento de la consulta principal, Google habría devuelto tres
  // filas y el agrupador habría triplicado el gasto.
  const composicion = composicionDesdeFilas([
    filaComposicion("g-1", "PURCHASE", 10),
    filaComposicion("g-1", "PHONE_CALL_LEAD", 3),
    filaComposicion("g-1", "SUBMIT_LEAD_FORM", 2),
  ]);
  const fila = {
    proveedor: "google",
    nivel: "campana",
    id: "g-1",
    nombre: "Búsqueda",
    estado: "activa",
    impresiones: 9_800,
    clics: 451,
    gasto: clp(52_300),
    resultados: { cantidad: 15, tipo: "desconocido" },
  };
  const [fusionada] = fusionarComposicion([fila], composicion);

  assert.equal(fusionada.gasto.valor, 52_300, "el gasto no se toca");
  assert.equal(fusionada.clics, 451);
  assert.equal(fusionada.impresiones, 9_800);
  assert.equal(fusionada.resultados.cantidad, 15, "la cantidad buena es la de la consulta sin segmentar");
});

test("BUG-08 · la consulta de composición no pide costo, clics ni impresiones", () => {
  const q = gaqlComposicion({ desde: "2026-08-01", hasta: "2026-08-30" });
  assert.match(q, /segments\.conversion_action_category/);
  assert.match(q, /metrics\.conversions/);
  for (const prohibido of ["cost_micros", "metrics.clicks", "metrics.impressions"]) {
    assert.equal(q.includes(prohibido), false, `${prohibido} no puede viajar en la consulta segmentada`);
  }
});

test("BUG-08 · una cuenta que mide llamadas no se rotula «conversiones del sitio»", () => {
  const c = composicionDesdeFilas([
    filaComposicion("g-1", "PHONE_CALL_LEAD", 40),
    filaComposicion("g-1", "PURCHASE", 2),
  ]);
  const lectura = leerComposicion(c.get("g-1").porCategoria);
  assert.equal(lectura.tipo, "llamadas");
  assert.match(lectura.desglose, /phone_call_lead/);
});

test("BUG-08 · conversiones de varios tipos son una MEZCLA y no se comparan", () => {
  const c = composicionDesdeFilas([
    filaComposicion("g-1", "PURCHASE", 10),
    filaComposicion("g-1", "PHONE_CALL_LEAD", 10),
  ]);
  const lectura = leerComposicion(c.get("g-1").porCategoria);
  assert.equal(lectura.tipo, "mezcla");
  assert.equal(
    sonComparables({ cantidad: 20, tipo: "mezcla" }, { cantidad: 20, tipo: "mezcla" }),
    false,
    "media venta y media llamada no tienen costo por resultado",
  );
  assert.equal(sumarResultados([{ cantidad: 5, tipo: "mezcla" }, { cantidad: 5, tipo: "mezcla" }]), null);
  assert.equal(
    sumarResultados([{ cantidad: 5, tipo: "mezcla" }, { cantidad: 5, tipo: "compras" }]).cantidad,
    5,
    "la mezcla se descarta del total, igual que un desconocido: no se suma a las compras",
  );
});

test("BUG-08 · dos categorías que miden lo mismo NO son una mezcla", () => {
  const c = composicionDesdeFilas([
    filaComposicion("g-1", "SUBMIT_LEAD_FORM", 10),
    filaComposicion("g-1", "REQUEST_QUOTE", 10),
  ]);
  assert.equal(leerComposicion(c.get("g-1").porCategoria).tipo, "leads");
});

test("BUG-08 · sin composición disponible el rótulo es honesto, no «web»", () => {
  const fila = {
    proveedor: "google",
    nivel: "campana",
    id: "g-1",
    nombre: "Búsqueda",
    gasto: clp(50_000),
    impresiones: 100,
    clics: 10,
    resultados: { cantidad: 15, tipo: "desconocido" },
  };
  const [igual] = fusionarComposicion([fila], new Map());
  assert.equal(igual.resultados.tipo, "desconocido");
  assert.equal(
    sonComparables(igual.resultados, { cantidad: 15, tipo: "conversiones_web" }),
    false,
    "no sabemos qué mide: no se compara con nada",
  );
  // Y el proveedor ya no escribe «conversiones_web» a ciegas.
  assert.equal(
    /tipo: "conversiones_web" as const/.test(codigo("lib/ads/google.ts")),
    false,
  );
});

test("BUG-08 · las acciones blandas de Google se reconocen y se pesan", () => {
  assert.ok(CATEGORIAS_BLANDAS.has("PAGE_VIEW"));
  assert.equal(tipoDeCategoria("PAGE_VIEW"), "desconocido");
  assert.equal(tipoDeCategoria("GET_DIRECTIONS"), "desconocido");
  assert.equal(tipoDeCategoria("PURCHASE"), "compras");
  assert.equal(tipoDeCategoria("UNA_CATEGORIA_QUE_GOOGLE_INVENTE_MAÑANA"), "desconocido");

  const c = composicionDesdeFilas([
    filaComposicion("g-1", "PAGE_VIEW", 400),
    filaComposicion("g-1", "PURCHASE", 28),
  ]);
  const lectura = leerComposicion(c.get("g-1").porCategoria);
  assert.ok(lectura.parteBlanda > 0.9, "428 «conversiones» que son casi todas vistas de página");
  assert.equal(lectura.tipo, "desconocido", "no es una cuenta que mida compras");
});

test("BUG-08 · la composición nunca reemplaza la cantidad de conversiones", () => {
  // Si Google reparte distinto entre la consulta segmentada y la principal, la
  // que manda es la principal: es la que no pasó por ningún segmento.
  const c = composicionDesdeFilas([filaComposicion("g-1", "PURCHASE", 99)]);
  const fila = {
    proveedor: "google",
    nivel: "campana",
    id: "g-1",
    nombre: "X",
    gasto: clp(1_000),
    impresiones: 1,
    clics: 1,
    resultados: { cantidad: 15, tipo: "desconocido" },
  };
  assert.equal(fusionarComposicion([fila], c)[0].resultados.cantidad, 15);
});

test("BUG-08 · el mapa cubre el enum ConversionActionCategory completo de v25", () => {
  // Copiado de la referencia de campos de v25 (segments.conversion_action_category).
  const ENUM_V25 = [
    "ADD_TO_CART", "BEGIN_CHECKOUT", "BOOK_APPOINTMENT", "CONTACT", "CONVERTED_LEAD",
    "DEFAULT", "DOWNLOAD", "ENGAGEMENT", "GET_DIRECTIONS", "IMPORTED_LEAD",
    "OUTBOUND_CLICK", "PAGE_VIEW", "PHONE_CALL_LEAD", "PURCHASE", "QUALIFIED_LEAD",
    "REQUEST_QUOTE", "SIGNUP", "STORE_SALE", "STORE_VISIT", "SUBMIT_LEAD_FORM",
    "SUBSCRIBE_PAID", "UNKNOWN", "UNSPECIFIED", "YOUTUBE_FOLLOW_ON_VIEWS",
  ];
  const sinClasificar = ENUM_V25.filter(
    (c) => tipoDeCategoria(c) === "desconocido" && !CATEGORIAS_BLANDAS.has(c) && !["UNKNOWN", "UNSPECIFIED"].includes(c),
  );
  assert.deepEqual(sinClasificar, [], "una categoría del enum sin decisión explícita es un hueco, no un default");
});

/* ══════════════════════════════════════════════════════════════════════════
   UN FALLO DE GOOGLE NO PUEDE EXPLICARSE COMO UN FALLO DE META
   ══════════════════════════════════════════════════════════════════════════ */

test("el nivel de acceso del proyecto tiene su propio código, no «sin_permiso»", () => {
  // Antes esto caía en `sin_permiso`, cuyo texto dice «falta permiso para leer
  // esa cuenta publicitaria en Meta»: mandaba a revisar Meta por un problema
  // que vive en la consola de Google Cloud.
  assert.ok(ERRORES.nivel_acceso, "existe el código");
  assert.match(ERRORES.nivel_acceso.mensaje, /Google Cloud/);
  assert.match(ERRORES.nivel_acceso.mensaje, /Prueba/i);
  assert.equal(/\bMeta\b/.test(ERRORES.nivel_acceso.mensaje), false, "no nombra a Meta");
  assert.match(
    ERRORES.nivel_acceso.mensaje,
    /no es un problema de tu cuenta/i,
    "y dice explícitamente que no es culpa de quien lo lee",
  );
});

test("los mensajes de error de Google nunca nombran a Meta", () => {
  for (const codigo of Object.keys(ERRORES)) {
    const texto = mensajeDeFalla("google", codigo);
    assert.equal(/\bMeta\b/.test(texto), false, `«${codigo}» dice Meta: ${texto}`);
  }
});

test("el callback de Google devuelve la plataforma junto con el código", () => {
  // Sin `p=google` en la vuelta, la pantalla no puede saber qué texto mostrar.
  const ruta = codigo("app/api/ads/google/callback/route.ts");
  assert.match(ruta, /integraciones\?e=\$\{motivo\}&p=google/);
  // Y el detalle técnico sigue sin salir a la URL.
  assert.equal(/detalle/.test(ruta.split("function volver")[1]?.slice(0, 300) ?? ""), false);
});
