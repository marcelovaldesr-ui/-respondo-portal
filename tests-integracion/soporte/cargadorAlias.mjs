import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Hook de resolución de módulos para las pruebas de integración: traduce el
 * alias `@/algo` (el mismo que usa el resto del portal, definido en
 * tsconfig.json → paths) a una ruta de archivo real, agregando `.ts` cuando
 * hace falta.
 *
 * SOLO se usa acá. Las pruebas normales (`npm test`) no lo necesitan porque
 * solo importan módulos "-core"/"-decision" sin dependencias — a propósito,
 * para no arrastrar la base de datos. Estas pruebas de integración sí
 * importan los módulos reales (reconciliarEstados.ts, embudo.ts,
 * reingresoTino.ts), que usan `@/lib/...` por todos lados.
 */
const RAIZ = pathToFileURL(path.resolve(import.meta.dirname, "..", "..") + "/").href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let destino = RAIZ + specifier.slice(2);
    if (!/\.[a-zA-Z]+$/.test(destino)) destino += ".ts";
    return nextResolve(destino, context);
  }
  return nextResolve(specifier, context);
}
