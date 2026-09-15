/**
 * EL PUNTERO A LA IMAGEN SE GUARDA COMO RUTA, NO COMO URL.
 *
 * Antes se guardaba el `publicUrl` completo y el bucket era público: una URL
 * filtrada —un log, un referer, una captura, un copy-paste a Meta— daba acceso
 * permanente al material publicitario de ese negocio, sin sesión y para
 * siempre. Seguridad por oscuridad, y encima con una ruta adivinable
 * (`<uuid del cliente>/<milisegundos>.jpg`).
 *
 * Ahora se persiste `sb:<ruta>` —el mismo prefijo que ya usa el bucket privado
 * `adjuntos`— y la imagen se sirve por `/api/marketing/imagen`, que exige
 * sesión y comprueba el negocio antes de entregar el binario.
 *
 * ⚠️ Nunca se hace `fetch()` del valor guardado: eso convertiría la columna en
 * una superficie SSRF, porque llega del navegador. Se resuelve con
 * `storage.download(ruta)` y punto.
 */
export const PREFIJO = "sb:";

/**
 * Los formatos que aceptamos guardar.
 *
 * El generador siempre escribe JPEG. Las piezas que sube el negocio conservan
 * SU formato: recomprimir el PNG de un diseñador a JPEG le come la
 * transparencia y le mete artefactos en los bordes del texto — y la misión es
 * explícita en que la imagen de la persona no se altera sola.
 */
export const EXTENSIONES = ["jpg", "png", "webp"] as const;
export type Extension = (typeof EXTENSIONES)[number];

export const TIPO_DE: Record<Extension, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** La ruta dentro del bucket, o null si el valor no es un puntero nuestro. */
export function rutaDeImagen(valor: string | null | undefined): string | null {
  if (!valor || !valor.startsWith(PREFIJO)) return null;
  const ruta = valor.slice(PREFIJO.length);
  // Sin traversal, sin rutas absolutas, sin vacíos: `<uuid>/<numero>.<ext>`.
  if (!/^[0-9a-f-]{8,}\/[0-9]+\.(jpg|png|webp)$/i.test(ruta)) return null;
  return ruta;
}

/** El tipo con que se sirve esa ruta. Sale de la RUTA, nunca de lo que dijo el navegador. */
export function tipoDeRuta(ruta: string): string {
  const ext = ruta.split(".").pop()?.toLowerCase() as Extension | undefined;
  return ext && ext in TIPO_DE ? TIPO_DE[ext] : "application/octet-stream";
}

/** ¿Esa ruta es del prefijo de ESTE negocio? Segunda barrera del Storage. */
export function rutaEsDelCliente(ruta: string, clienteId: string): boolean {
  return ruta.startsWith(`${clienteId}/`);
}

/**
 * Cómo se pinta esa imagen en la interfaz.
 *
 * Las rutas locales de la demostración (`/marketing/demo/…`) pasan tal cual: no
 * están en Storage y no necesitan sesión.
 */
export function urlDeImagen(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (valor.startsWith("/")) return valor;
  const ruta = rutaDeImagen(valor);
  return ruta ? `/api/marketing/imagen?r=${encodeURIComponent(ruta)}` : null;
}
