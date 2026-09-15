import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { conexionGoogleDe, rendimientoGoogle } from "../lib/ads/google.ts";
import { resolverRango } from "../lib/ads/periodos.ts";
import { monedaConocida, normalizarMoneda } from "../lib/ads/moneda.ts";

/**
 * ANDAMIAJE PARA COMPARAR RESPONDO CONTRA GOOGLE ADS NATIVO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ LO QUE ESTE ARCHIVO **NO** AFIRMA
 *
 * Esto NO valida la integración con Google. Al 15 de septiembre de 2026 la
 * cuenta de Google Ads de Impresora Color todavía no se ha leído ni una vez
 * desde Respondo, y ningún número de este repositorio ha sido comparado contra
 * la interfaz de Google. Cualquier frase que diga lo contrario —en un informe,
 * en un comentario o en una conversación— es falsa.
 *
 * QUÉ ES, ENTONCES
 *
 * Es el instrumento para hacer esa comparación el día que haya credenciales:
 * vuelca los SEIS niveles que Google muestra en su propia interfaz, en las
 * mismas unidades en que Google los muestra, a archivos CSV que se pueden abrir
 * al lado de la pantalla de Google Ads y comparar fila por fila.
 *
 *   ACCOUNT       → el total de la cuenta (suma de campañas, por moneda)
 *   CAMPAIGN      → campaign.name, estado, tipo, presupuesto, métricas
 *   AD GROUP      → ad_group.name dentro de su campaña
 *   AD            → ad_group_ad, por id (los adaptables no traen nombre)
 *   KEYWORD       → keyword_view, con concordancia y estado
 *   SEARCH TERM   → search_term_view, con la palabra que lo disparó
 *
 * Lo que sí se comprueba acá es COHERENCIA INTERNA, que es lo único que se
 * puede comprobar sin la otra mitad: que los niveles sumen entre sí, que no
 * haya monedas mezcladas dentro de una cuenta, que ningún gasto quede sin
 * moneda, y que los ids de padre existan. Un descuadre interno significa que el
 * proveedor está mal ANTES de comparar con nadie; que cuadre no significa que
 * coincida con Google.
 *
 * CÓMO SE CORRE
 *
 *   RESPONDO_CLIENTE_ID=<uuid> npm run test:integracion
 *
 * Sin `RESPONDO_CLIENTE_ID`, o sin conexión de Google para ese negocio, las
 * pruebas se saltan con un motivo escrito. No fallan: todavía no hay nada que
 * comparar, y un rojo permanente enseña a ignorar el rojo.
 *
 * QUÉ MIRAR EN GOOGLE ADS, PARA QUE LA COMPARACIÓN SEA VÁLIDA
 *
 *   · Mismo rango de fechas, y la zona horaria de LA CUENTA (no la tuya).
 *   · Columna «Conversiones», NO «Todas las conversiones». Es la diferencia que
 *     en una revisión de 14 días convirtió 428 acciones blandas del perfil de
 *     Maps en «conversiones» que no eran ninguna cotización.
 *   · Sin filtros de estado: acá vienen también las pausadas.
 *   · El costo de Google se muestra redondeado; nosotros dividimos micros entre
 *     un millón. Diferencias en el último decimal son del redondeo de Google.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CLIENTE = process.env.RESPONDO_CLIENTE_ID ?? "";
const SALIDA = process.env.RESPONDO_SALIDA_COMPARACION ?? "comparacion-google";
const RANGO = resolverRango(process.env.RESPONDO_RANGO ?? "30d");

const NIVELES = ["campana", "grupo", "anuncio", "palabra", "termino"];

/** Cabeceras alineadas con lo que Google muestra en cada pantalla. */
const COLUMNAS = [
  "nivel",
  "id",
  "nombre",
  "estado",
  "campana_id",
  "campana_nombre",
  "grupo_id",
  "grupo_nombre",
  "impresiones",
  "clics",
  "costo",
  "moneda",
  "conversiones",
  "tipo_resultado",
  "concordancia",
  "palabra_que_lo_disparo",
  "estado_termino",
];

function csv(filas) {
  const escapar = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linea = (f) =>
    [
      f.nivel,
      f.id,
      f.nombre,
      f.estado ?? "",
      f.campanaId ?? "",
      f.campanaNombre ?? "",
      f.grupoId ?? "",
      f.grupoNombre ?? "",
      f.impresiones,
      f.clics,
      f.gasto.valor,
      f.gasto.moneda,
      f.resultados?.cantidad ?? "",
      f.resultados?.tipo ?? "",
      f.extra?.concordancia ?? "",
      f.extra?.palabraQueLoDisparo ?? "",
      f.extra?.estadoTermino ?? "",
    ]
      .map(escapar)
      .join(",");
  return [COLUMNAS.join(","), ...filas.map(linea)].join("\n");
}

let cache = null;
async function traer() {
  if (cache !== null) return cache;
  if (!CLIENTE) {
    cache = { salta: "Falta RESPONDO_CLIENTE_ID: no hay negocio contra el cual comparar." };
    return cache;
  }
  const con = await conexionGoogleDe(CLIENTE);
  if (!con?.cuentaId) {
    cache = { salta: "Este negocio no tiene una cuenta de Google Ads conectada todavía." };
    return cache;
  }
  const r = await rendimientoGoogle(CLIENTE, RANGO, NIVELES);
  if (!r.ok) {
    cache = { salta: `Google respondió ${r.error.codigo}: ${r.error.detalle ?? "sin detalle"}.` };
    return cache;
  }
  cache = { filas: r.datos, conexion: con };
  return cache;
}

test("vuelca los seis niveles de Google a CSV para comparar a mano", async (t) => {
  const d = await traer();
  if (d.salta) return t.skip(d.salta);

  fs.mkdirSync(SALIDA, { recursive: true });
  for (const nivel of NIVELES) {
    const filas = d.filas.filter((f) => f.nivel === nivel);
    fs.writeFileSync(path.join(SALIDA, `${nivel}.csv`), csv(filas), "utf8");
  }

  /* ACCOUNT: el total, POR MONEDA. Nunca un total único. */
  const porMoneda = new Map();
  for (const f of d.filas.filter((x) => x.nivel === "campana")) {
    const m = normalizarMoneda(f.gasto.moneda);
    const a = porMoneda.get(m) ?? { impresiones: 0, clics: 0, costo: 0, conversiones: 0 };
    a.impresiones += f.impresiones;
    a.clics += f.clics;
    a.costo += f.gasto.valor;
    a.conversiones += f.resultados?.cantidad ?? 0;
    porMoneda.set(m, a);
  }
  const cuenta = [["moneda", "impresiones", "clics", "costo", "conversiones"].join(",")];
  for (const [m, a] of porMoneda) {
    cuenta.push([m || "(sin moneda)", a.impresiones, a.clics, a.costo, a.conversiones].join(","));
  }
  fs.writeFileSync(path.join(SALIDA, "cuenta.csv"), cuenta.join("\n"), "utf8");

  console.log(
    `\nCSV escritos en ${path.resolve(SALIDA)}.\n` +
      `Cuenta ${d.conexion.cuentaId} · rango ${RANGO.desde} a ${RANGO.hasta} (zona de la cuenta: ${d.conexion.zonaHoraria}).\n` +
      `⚠️ Esto NO es una validación: es el insumo para compararlo a mano contra Google Ads.\n`,
  );
  assert.ok(d.filas.length >= 0);
});

test("coherencia interna · ningún gasto viaja sin moneda", async (t) => {
  const d = await traer();
  if (d.salta) return t.skip(d.salta);
  const sinMoneda = d.filas.filter((f) => !monedaConocida(f.gasto.moneda) && f.gasto.valor > 0);
  assert.deepEqual(
    sinMoneda.map((f) => `${f.nivel}:${f.id}`),
    [],
    "una cifra de plata sin moneda no se puede comparar con la pantalla de Google",
  );
});

test("coherencia interna · una cuenta no puede reportar dos monedas", async (t) => {
  const d = await traer();
  if (d.salta) return t.skip(d.salta);
  const monedas = new Set(d.filas.map((f) => normalizarMoneda(f.gasto.moneda)).filter(monedaConocida));
  assert.ok(monedas.size <= 1, `la cuenta reportó ${[...monedas].join(" y ")}, que no puede pasar en una sola cuenta`);
});

test("coherencia interna · los grupos suman lo mismo que su campaña", async (t) => {
  const d = await traer();
  if (d.salta) return t.skip(d.salta);
  const campanas = new Map(d.filas.filter((f) => f.nivel === "campana").map((f) => [f.id, f]));
  const porCampana = new Map();
  for (const g of d.filas.filter((f) => f.nivel === "grupo")) {
    const a = porCampana.get(g.campanaId) ?? { clics: 0, costo: 0 };
    a.clics += g.clics;
    a.costo += g.gasto.valor;
    porCampana.set(g.campanaId, a);
  }
  for (const [id, suma] of porCampana) {
    const c = campanas.get(id);
    if (!c) {
      assert.fail(`el grupo apunta a la campaña ${id}, que no vino en el nivel de campañas`);
    }
    /**
     * Google no garantiza que los niveles cuadren al peso: hay campañas cuyo
     * gasto no se reparte del todo entre grupos (Performance Max, por ejemplo).
     * Por eso se exige que los grupos NO superen a su campaña, y se avisa
     * cuando la diferencia es grande, en vez de exigir igualdad.
     */
    assert.ok(
      suma.costo <= c.gasto.valor * 1.01,
      `los grupos de «${c.nombre}» gastan ${suma.costo} y la campaña ${c.gasto.valor}: un hijo no puede gastar más que su padre`,
    );
    const falta = c.gasto.valor > 0 ? 1 - suma.costo / c.gasto.valor : 0;
    if (falta > 0.05) {
      console.log(
        `· «${c.nombre}» (${c.objetivo ?? "—"}): los grupos explican el ${Math.round((1 - falta) * 100)}% del gasto. ` +
          `Normal en campañas sin grupos visibles; revisar si es de Búsqueda.`,
      );
    }
  }
});

test("coherencia interna · cada término apunta a una campaña que existe", async (t) => {
  const d = await traer();
  if (d.salta) return t.skip(d.salta);
  const ids = new Set(d.filas.filter((f) => f.nivel === "campana").map((f) => f.id));
  const huerfanos = d.filas
    .filter((f) => (f.nivel === "termino" || f.nivel === "palabra") && f.campanaId && !ids.has(f.campanaId))
    .map((f) => `${f.nivel}:${f.nombre}`);
  assert.deepEqual(huerfanos, [], "un término sin su campaña no se puede ubicar en la pantalla de Google");
});
