/**
 * VALIDACIÓN DE UN ADJUNTO QUE SALE DEL PORTAL — puro, sin red ni base de datos.
 *
 * Vive aparte (y sin imports de `@/`) para poder probarlo con `node --test`.
 * Mismo patrón que ritmoHumano.ts y parserMeta.ts.
 *
 * Por qué importa que esto tenga pruebas: es el único punto donde se decide si
 * un archivo que llegó del navegador se manda al WhatsApp de un cliente real.
 * Equivocarse acá es mandarle basura a alguien, o peor, aceptar un archivo cuyo
 * contenido no es lo que dice ser.
 */

/** Lo que WhatsApp acepta y nosotros sabemos mostrar de vuelta en el inbox. */
export const MIME_SALIDA_PERMITIDOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/**
 * Tope de tamaño. WhatsApp acepta bastante más en documentos, pero:
 *  - el archivo pasa por una función serverless con memoria acotada, y
 *  - un adjunto enorme tarda tanto que la persona cree que se colgó.
 * 16 MB es el límite de Meta para imágenes; nos quedamos ahí.
 */
export const MAX_SALIDA_BYTES = 16 * 1024 * 1024;

/**
 * Firmas de archivo ("magic numbers").
 *
 * NO SE CONFÍA EN EL `Content-Type` que declara el navegador: es un texto que
 * cualquiera puede escribir. Se mira el comienzo del binario, que es lo que de
 * verdad determina qué es el archivo.
 */
const FIRMAS: Record<string, (b: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/webp": (b) =>
    b.length >= 12 &&
    texto(b, 0, 4) === "RIFF" &&
    texto(b, 8, 12) === "WEBP",
  "image/gif": (b) => {
    const f = texto(b, 0, 6);
    return f === "GIF87a" || f === "GIF89a";
  },
  "application/pdf": (b) => b.length >= 5 && texto(b, 0, 5) === "%PDF-",
};

function texto(b: Uint8Array, desde: number, hasta: number): string {
  let s = "";
  for (let i = desde; i < Math.min(hasta, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
}

/**
 * Nombre de archivo seguro para mandar a un tercero.
 *
 * Se limpia todo lo que pueda interpretarse como ruta (`../`, barras) y los
 * caracteres raros, y se acota el largo. El nombre viaja a WhatsApp y termina en
 * el teléfono de una persona: no es un campo interno.
 */
export function nombreSeguroSalida(nombre: string): string {
  const base = (nombre || "archivo").split(/[\\/]/).pop() || "archivo";
  const limpio = base.replace(/[^\w.\- ]+/g, "_").replace(/_{2,}/g, "_").trim();
  const cortado = limpio.slice(0, 80);
  return cortado || "archivo";
}

export type RevisionAdjunto =
  | { ok: true; mime: string; nombre: string; esImagen: boolean }
  | { ok: false; error: string };

/**
 * Revisa un adjunto que sale: tipo permitido, tamaño y que el contenido coincida
 * con el tipo declarado.
 *
 * Los mensajes de error están escritos para que los lea Cecilia, no un
 * programador: dicen qué hacer, no qué falló por dentro.
 */
export function revisarAdjuntoSalida(params: {
  bytes: Uint8Array;
  mime: string;
  nombre: string;
}): RevisionAdjunto {
  const mime = (params.mime || "").split(";")[0].trim().toLowerCase();

  if (!MIME_SALIDA_PERMITIDOS.has(mime)) {
    return {
      ok: false,
      error: "Solo se pueden enviar imágenes (JPG, PNG, WEBP, GIF) o archivos PDF.",
    };
  }
  if (params.bytes.length === 0) {
    return { ok: false, error: "El archivo llegó vacío. Prueba de nuevo." };
  }
  if (params.bytes.length > MAX_SALIDA_BYTES) {
    return { ok: false, error: "El archivo supera los 16 MB. Prueba con uno más liviano." };
  }
  const verificar = FIRMAS[mime];
  if (!verificar || !verificar(params.bytes.subarray(0, 16))) {
    return {
      ok: false,
      error: "El contenido del archivo no coincide con un formato permitido.",
    };
  }
  return {
    ok: true,
    mime,
    nombre: nombreSeguroSalida(params.nombre),
    esImagen: mime.startsWith("image/"),
  };
}
