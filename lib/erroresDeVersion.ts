/**
 * DESAJUSTE DE VERSIÓN TRAS UN DEPLOY — el error que el cliente nunca debería ver.
 *
 * QUÉ PASA
 * Next parte la app en archivos con el hash del contenido en el nombre
 * (`page-5b092086.js`). Cuando se despliega una versión nueva, esos archivos
 * cambian de nombre y los viejos dejan de existir. Una pestaña que quedó abierta
 * sigue teniendo el HTML anterior, así que al navegar pide un archivo que ya no
 * está: 404, y la navegación revienta.
 *
 * No es un error del portal ni del cliente: es la pestaña pidiéndole a la
 * versión nueva algo de la vieja. La respuesta correcta es recargar, no mostrar
 * un cartel de disculpa — el cliente no tiene nada que decidir.
 *
 * POR QUÉ VIVE ACÁ Y NO EN CADA BORDE
 * Hay dos bordes de error (el del portal y el global) y los dos tienen que
 * reaccionar igual. Cuando la lógica estaba duplicada, uno se quedó sin ella y
 * el resultado fue justo el cartel que queríamos evitar: el borde global no
 * recargaba solo. Una sola definición hace imposible que vuelvan a divergir.
 */

/**
 * ¿Este error es un desajuste de versión?
 *
 * Los navegadores no coinciden en el mensaje, así que se cubren las variantes de
 * Chrome, Firefox y Safari, más las de Next cuando falla al traer la carga RSC
 * de la pantalla siguiente.
 */
export function esErrorDeVersion(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const txt = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically|Failed to load script|NetworkError when attempting to fetch resource/i.test(
    txt,
  );
}

/** Cuánto esperar antes de permitir otra recarga automática. */
const ESPERA_MS = 12_000;
const CLAVE = "respondo_recarga_version";

/**
 * Intenta resolver el desajuste recargando. Devuelve true si va a recargar.
 *
 * GUARDIA ANTI-BUCLE, que es lo único delicado acá: si la recarga no arregla el
 * problema —porque el error era otro y el patrón dio un falso positivo— recargar
 * en bucle deja al cliente con una pantalla parpadeando para siempre, que es
 * mucho peor que el cartel. Por eso solo se recarga una vez cada 12 segundos; a
 * la segunda, se muestra el mensaje y decide la persona.
 */
export function intentarRecargarPorVersion(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!esErrorDeVersion(error)) return false;

  try {
    const ahora = Date.now();
    const ultima = Number(sessionStorage.getItem(CLAVE) || 0);
    if (ahora - ultima < ESPERA_MS) return false;
    sessionStorage.setItem(CLAVE, String(ahora));
  } catch {
    // Modo incógnito con almacenamiento bloqueado: sin guardia no se arriesga
    // un bucle. Mejor mostrar el cartel.
    return false;
  }
  return true;
}
