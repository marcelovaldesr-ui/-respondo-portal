/**
 * Resuelve el alias `@/` de tsconfig cuando las pruebas corren con Node a
 * pelo (sin Next). Solo hace falta para los módulos que importan otros
 * módulos en tiempo de ejecución; los puros no lo necesitan.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  `data:text/javascript,${encodeURIComponent(`
    const RAIZ = ${JSON.stringify(pathToFileURL(process.cwd() + "/").href)};
    export async function resolve(especificador, contexto, siguiente) {
      if (especificador.startsWith("@/")) {
        const base = RAIZ + especificador.slice(2);
        for (const ext of [".ts", ".tsx", "/index.ts", ""]) {
          try { return await siguiente(base + ext, contexto); } catch {}
        }
      }
      return siguiente(especificador, contexto);
    }
  `)}`,
);
