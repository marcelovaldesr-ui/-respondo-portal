import assert from "node:assert/strict";
import test from "node:test";

import { armarEmbudo, panoramaDemo } from "../lib/marketing/demo.ts";
import { LIMITES, parsearPaquete, promptCreativo, textoVisible, proporcion } from "../lib/marketing/creatividadesCore.ts";
import { HERRAMIENTAS, parsearRespuestaCopiloto, promptCopiloto } from "../lib/marketing/copilotoCore.ts";
import { borradorEnTexto, faltantesDeBorrador } from "../lib/marketing/campanasCore.ts";
import { serieDeLeads } from "../lib/marketing/series.ts";
import { resolverRango } from "../lib/ads/periodos.ts";

/**
 * Lo que se prueba acá es que el centro de marketing NO MIENTA:
 *   · la demo pasa por las mismas funciones que la realidad y cuadra consigo misma;
 *   · el estudio recorta a los límites de Meta antes de publicar, no después;
 *   · el copiloto no puede colar rutas ajenas ni respuestas vacías;
 *   · un borrador dice qué le falta, con el paso exacto.
 */

/* ── Demo ───────────────────────────────────────────────────────────────── */

test("la demo es determinista: dos llamadas, el mismo panorama", () => {
  const a = panoramaDemo(resolverRango("30d"));
  const b = panoramaDemo(resolverRango("30d"));
  assert.deepEqual(a.campanas, b.campanas);
  assert.deepEqual(a.serie, b.serie);
  assert.equal(a.demo, true);
});

test("la demo cuadra consigo misma: la serie suma lo que dicen los leads y el embudo", () => {
  const p = panoramaDemo(resolverRango("30d"));
  const convSerie = p.serie.reduce((s, d) => s + d.conversaciones, 0);
  assert.equal(convSerie, p.leads.length, "cada lead cae en un día de la serie");
  const emb = Object.fromEntries(p.embudo.map((e) => [e.clave, e.valor]));
  assert.equal(emb.conversaciones, p.leads.length);
  assert.equal(emb.calificados, p.leads.filter((l) => l.calificado).length);
  assert.equal(emb.ventas, p.leads.filter((l) => l.compro).length);
  const ventasCampanas = p.campanas.filter((c) => c.origen !== "borrador").reduce((s, c) => s + c.ventas, 0);
  assert.equal(ventasCampanas, emb.ventas, "las campañas reparten exactamente las ventas del período");
});

test("la demo trae las siete métricas con certeza y ninguna en cero disfrazado", () => {
  const p = panoramaDemo(resolverRango("30d"));
  const m = Object.fromEntries(p.metricas.flatMap((g) => g.metricas).map((x) => [x.clave, x]));
  for (const clave of ["gasto", "conversaciones", "ventas", "cobrado", "roas"]) {
    assert.ok(m[clave], `falta ${clave}`);
    assert.ok(["medida", "derivada", "parcial"].includes(m[clave].certeza), `${clave} sin certeza útil`);
  }
  assert.ok(p.hallazgos.length >= 1, "la demo tiene hallazgos para mostrar");
  assert.ok(p.creatividades.some((c) => c.rendimiento), "hay creatividades cruzadas con rendimiento");
});

test("el embudo sin Meta oculta impresiones y clics en vez de mostrar cero", () => {
  const e = armarEmbudo({ impresiones: null, clics: null, conversaciones: 20, calificados: 8, avanzados: 5, ventas: 2 });
  assert.equal(e.find((x) => x.clave === "impresiones").valor, null);
  assert.equal(e.find((x) => x.clave === "conversaciones").tasa, null, "sin clics no hay tasa de conversación");
  assert.equal(Math.round(e.find((x) => x.clave === "calificados").tasa), 40);
  assert.equal(e.find((x) => x.clave === "ventas").valor, 2);
});

test("serieDeLeads: cada lead cae en su día de Chile y las ventas suman lo cobrado", () => {
  const rango = { desde: "2026-09-01", hasta: "2026-09-03" };
  const lead = (llegoEn, extra = {}) => ({
    chatId: Math.random().toString(36).slice(2), nombre: "x", telefono: "", origen: "meta", campanaId: null, campanaNombre: "", anuncioId: null, anuncioTitular: "",
    llegoEn, etapa: "nuevo", calificado: false, cotizo: false, agendo: false, compro: false, cobrado: 0, ultimoMensaje: "", conClid: true, ...extra,
  });
  const s = serieDeLeads(rango, [
    lead("2026-09-01T12:00:00-03:00"),
    lead("2026-09-02T02:30:00Z"), // 1 de septiembre 23:30 en Chile
    lead("2026-09-03T15:00:00-03:00", { compro: true, cobrado: 45000, calificado: true }),
    lead("2026-09-09T15:00:00-03:00"), // fuera del rango: se ignora
  ]);
  assert.equal(s.length, 3);
  assert.equal(s[0].conversaciones, 2);
  assert.equal(s[2].ventas, 1);
  assert.equal(s[2].cobrado, 45000);
  assert.equal(s[0].gasto, null, "sin Meta por campaña, el gasto es no disponible, no cero");
});

/* ── Estudio creativo ───────────────────────────────────────────────────── */

test("parsearPaquete recorta a los límites de Meta y normaliza el CTA", () => {
  const crudo = JSON.stringify({
    nombre: "Pendón",
    concepto: "c",
    gancho: "g",
    titular: "x".repeat(80),
    texto: "y".repeat(500),
    cta: "cotizar ya",
    imagenPrompt: "foto",
    variantes: [{ gancho: "a", titular: "b", texto: "c", cta: "reserva tu hora" }, { titular: "", texto: "" }],
  });
  const p = parsearPaquete(crudo);
  assert.ok(p);
  assert.ok(p.titular.length <= LIMITES.titular);
  assert.ok(p.texto.length <= LIMITES.texto);
  assert.equal(p.cta, "Cotizar por WhatsApp");
  assert.equal(p.variantes.length, 1, "las variantes incompletas se descartan");
  assert.equal(p.variantes[0].cta, "Reservar");
});

test("parsearPaquete tolera texto alrededor del JSON y rechaza paquetes sin titular", () => {
  const ok = parsearPaquete('Claro, acá va:\n```json\n{"titular":"Hola","texto":"Mundo","cta":"Comprar"}\n```');
  assert.equal(ok?.titular, "Hola");
  assert.equal(parsearPaquete('{"texto":"sin titular"}'), null);
  assert.equal(parsearPaquete("no es json"), null);
});

test("textoVisible corta a los 125 caracteres como Meta y proporcion devuelve el ratio", () => {
  const largo = "a".repeat(200);
  const { visible, oculto } = textoVisible(largo);
  assert.equal(visible.length, LIMITES.textoVisible);
  assert.equal(oculto.length, 200 - LIMITES.textoVisible);
  assert.equal(textoVisible("corto").oculto, "");
  assert.equal(proporcion("1:1"), 1);
  assert.ok(Math.abs(proporcion("9:16") - 9 / 16) < 1e-9);
});

test("promptCreativo lleva el contexto del negocio y las reglas de Meta", () => {
  const p = promptCreativo({ objetivo: "ventas", producto: "Pendón", oferta: "24 h", plataforma: "ambas", formato: "4:5", contexto: "NEGOCIO: Gráfica Andina" });
  assert.match(p, /Gráfica Andina/);
  assert.match(p, new RegExp(`MÁXIMO ${LIMITES.titular}`));
  assert.match(p, /Facebook e Instagram/);
  assert.match(p, /vertical 4:5/);
});

/* ── Copiloto ───────────────────────────────────────────────────────────── */

test("las herramientas corren sobre el panorama sin lanzar y devuelven texto", () => {
  const p = panoramaDemo(resolverRango("30d"));
  for (const h of HERRAMIENTAS) {
    const out = h.correr(p);
    assert.equal(typeof out, "string", h.nombre);
    assert.ok(out.length > 0, `${h.nombre} devolvió vacío`);
  }
  const prompt = promptCopiloto({ pregunta: "¿Qué campaña rinde mejor?", panorama: p, contextoMarca: "NEGOCIO", hilo: [] });
  assert.match(prompt, /ÚNICA fuente de cifras/);
  assert.match(prompt, /No calcules cifras nuevas/);
});

test("parsearRespuestaCopiloto solo acepta rutas del producto y exige respuesta", () => {
  const r = parsearRespuestaCopiloto(
    JSON.stringify({
      respuesta: "La mejor es Pendones.",
      evidencia: [{ texto: "8 ventas", href: "/marketing/campanas/c_pendones" }, { texto: "raro", href: "https://malicioso.example" }],
      acciones: [{ texto: "Ver", href: "/marketing/campanas" }, { texto: "Salir", href: "/admin" }],
      herramientasUsadas: ["rendimientoPorCampana"],
      sinDatos: false,
      borrador: null,
    }),
  );
  assert.ok(r);
  assert.equal(r.evidencia[0].href, "/marketing/campanas/c_pendones");
  assert.equal(r.evidencia[1].href, undefined, "un enlace externo se descarta, el texto se conserva");
  assert.equal(r.acciones.length, 1, "una ruta fuera del producto no se ofrece como acción");
  assert.equal(parsearRespuestaCopiloto('{"respuesta":""}'), null);
});

test("parsearRespuestaCopiloto conserva el borrador de campaña cuando viene completo", () => {
  const r = parsearRespuestaCopiloto(
    JSON.stringify({
      respuesta: "Te armé una campaña.",
      borrador: {
        nombre: "Poleras octubre",
        objetivo: "ventas",
        oferta: "Poleras desde 10 unidades",
        audiencia: { ubicacion: "Chillán", edadDesde: 25, edadHasta: 55, intereses: ["eventos"], nota: "" },
        presupuestoDiario: 5000,
        copies: [{ titular: "Poleras para tu equipo", texto: "Full color, 5 días.", cta: "Cotizar por WhatsApp" }],
        creatividad: { concepto: "equipo", imagenPrompt: "foto" },
      },
    }),
  );
  assert.ok(r?.borrador);
  assert.equal(r.borrador.nombre, "Poleras octubre");
  assert.equal(r.borrador.copies.length, 1);
});

/* ── Asistente de campañas ──────────────────────────────────────────────── */

test("faltantesDeBorrador dice qué falta y a qué paso ir", () => {
  const f = faltantesDeBorrador({ nombre: "", oferta: "", audiencia: { ubicacion: "" }, presupuestoDiario: null, creatividadIds: [], copies: [{ titular: "", texto: "" }] });
  assert.deepEqual(f.map((x) => x.paso), [1, 2, 3, 4, 5, 6]);
  const listo = faltantesDeBorrador({ nombre: "C", oferta: "O", audiencia: { ubicacion: "Chillán" }, presupuestoDiario: 3000, creatividadIds: ["a"], copies: [{ titular: "t", texto: "x" }] });
  assert.equal(listo.length, 0);
});

test("borradorEnTexto produce lo que se pega en el Administrador de Anuncios", () => {
  const p = panoramaDemo(resolverRango("30d"));
  const b = p.borradores[0];
  const t = borradorEnTexto(b);
  assert.match(t, /^CAMPAÑA: /);
  assert.match(t, /Aplicaciones de mensajes → WhatsApp/);
  assert.match(t, /ANUNCIO 1/);
  assert.match(t, /Destino: WhatsApp/);
});
