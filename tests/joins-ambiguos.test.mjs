import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * GUARDIA CONTRA JOINS AMBIGUOS DE POSTGREST.
 *
 * BUG REAL (12-ago-2026, encontrado en producción):
 * `ed_citas` llega a `ed_servicios` por DOS caminos —directo por `servicio_id`,
 * e indirecto por `clase_id → ed_clases → servicio_id` (migración 260)—. Ante
 * eso PostgREST no adivina: responde
 *   "Could not embed because more than one relationship was found"
 * y devuelve error en vez de filas.
 *
 * Lo grave es CÓMO falla. El código hacía `const { data: citas } = await ...`
 * sin mirar `error`, así que `citas` quedaba en null, la lista en [] y la
 * pantalla se veía perfecta… pero VACÍA. Sin error en pantalla, sin log.
 * Estuvieron rotas la agenda del portal, el feed iCal, el reagendar y las
 * clases grupales, y se descubrió por casualidad.
 *
 * Una prueba de comportamiento no lo habría atrapado sin base de datos, así que
 * esta revisa el código fuente: cualquier embed hacia una tabla alcanzable por
 * más de un camino tiene que decir POR CUÁL va (`ed_servicios!servicio_id(...)`).
 */

const TABLAS_AMBIGUAS = ["ed_servicios", "ed_profesionales"];
const RAICES = ["app", "lib", "components"];

function archivosFuente(dir, salida = []) {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, salida);
    else if (/\.(ts|tsx)$/.test(entrada)) salida.push(ruta);
  }
  return salida;
}

test("todo embed de PostgREST hacia una tabla ambigua declara su llave foránea", () => {
  const infractores = [];

  for (const raiz of RAICES) {
    for (const archivo of archivosFuente(raiz)) {
      const texto = readFileSync(archivo, "utf8");
      const lineas = texto.split("\n");

      lineas.forEach((linea, i) => {
        for (const tabla of TABLAS_AMBIGUAS) {
          // Un embed es `ed_servicios(` — la desambiguación mete `!algo` antes
          // del paréntesis: `ed_servicios!servicio_id(`.
          const embedAmbiguo = new RegExp(`${tabla}\\(`);
          const embedExplicito = new RegExp(`${tabla}![a-z_]+\\(`);
          if (embedAmbiguo.test(linea) && !embedExplicito.test(linea)) {
            infractores.push(`${archivo}:${i + 1} → ${linea.trim().slice(0, 90)}`);
          }
        }
      });
    }
  }

  assert.deepEqual(
    infractores,
    [],
    "Estos embeds no dicen por qué llave van y PostgREST devolverá error " +
      "(la pantalla quedará vacía sin avisar). Usa ed_servicios!servicio_id(...):\n" +
      infractores.join("\n"),
  );
});
