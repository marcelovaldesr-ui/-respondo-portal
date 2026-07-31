/**
 * Carga .env.local para los scripts de consola.
 *
 * POR QUÉ EXISTE: Next.js lee .env.local solo, pero `npx tsx scripts/x.ts` no.
 * Sin esto, cualquier script que use la base falla con "Faltan SUPABASE_URL…"
 * aunque el archivo esté ahí (pasó el 31-jul-2026).
 *
 * Cero dependencias (no hace falta instalar dotenv) y no pisa variables que ya
 * vengan del entorno, así se puede sobrescribir puntualmente desde la terminal.
 *
 * USO: que sea el PRIMER import del script:
 *     import "./_env";
 *     import { db } from "../lib/db";
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

function buscarArchivo(nombre: string): string | null {
  // Desde el directorio actual hacia arriba (por si se corre desde scripts/).
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const ruta = join(dir, nombre);
    if (existsSync(ruta)) return ruta;
    const padre = join(dir, "..");
    if (padre === dir) break;
    dir = padre;
  }
  return null;
}

function cargar(nombre: string): number {
  const ruta = buscarArchivo(nombre);
  if (!ruta) return 0;

  let cargadas = 0;
  for (const lineaCruda of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith("#")) continue;

    const igual = linea.indexOf("=");
    if (igual < 1) continue;

    const clave = linea.slice(0, igual).trim();
    let valor = linea.slice(igual + 1).trim();

    // Quitar comillas envolventes si las hay.
    if (
      (valor.startsWith('"') && valor.endsWith('"') && valor.length > 1) ||
      (valor.startsWith("'") && valor.endsWith("'") && valor.length > 1)
    ) {
      valor = valor.slice(1, -1);
    } else {
      // Comentario al final de línea (solo en valores sin comillas).
      const comentario = valor.indexOf(" #");
      if (comentario >= 0) valor = valor.slice(0, comentario).trim();
    }

    if (process.env[clave] === undefined) {
      process.env[clave] = valor;
      cargadas++;
    }
  }
  return cargadas;
}

// .env.local manda; .env queda de respaldo (mismo orden que Next.js).
const n = cargar(".env.local") + cargar(".env");
if (n > 0 && process.env.ENV_SILENCIO !== "1") {
  console.log(`[env] ${n} variables cargadas desde .env.local`);
}
