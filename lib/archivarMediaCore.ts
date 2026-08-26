/**
 * REGLAS DEL ARCHIVADO DE ADJUNTOS — puras, sin red ni base de datos.
 *
 * Deciden qué se guarda, dónde y con qué nombre. Están acá y no en
 * `archivarMedia.ts` para poder probarlas con `node --test`, igual que
 * `parserMeta.ts`, `ritmoHumano.ts` y `ventana24Regla.ts`.
 *
 * POR QUÉ ESTO EXISTE
 * -------------------
 * Meta **borra** el archivo que llega por webhook a los **7 días**. El portal
 * solo guardaba un puntero, así que cada foto que manda un cliente dejaba de
 * verse en una semana, sola. Ver `sql/286_bucket_adjuntos.sql`.
 */

/** Tope por archivo. Ver el porqué en la migración 286. */
export const TOPE_BYTES = 10 * 1024 * 1024;

/**
 * Cuántos días hacia atrás vale la pena intentar.
 *
 * Meta borra a los 7. Se usa 6 para que el barrido tenga margen: si el cron se
 * cae una tarde, al día siguiente todavía alcanza. Intentar los de 8 días sería
 * gastar llamadas para recibir 404.
 */
export const DIAS_UTILES = 6;

/** Prefijos del campo `media_url`. Es el vocabulario que ya usaba el proxy. */
export const PREFIJO_META = "meta:";
export const PREFIJO_STORAGE = "sb:";
/**
 * Archivo que superó el tope y NO se guardó.
 *
 * Se marca en vez de dejarlo como `meta:` para que el portal pueda DECIR qué
 * pasó. Un archivo que un día deja de abrirse sin explicación es peor que uno
 * que avisa «era muy grande para archivarlo, descárgalo antes del <fecha>».
 */
export const PREFIJO_GRANDE = "meta-grande:";

export type Decision =
  | { accion: "archivar"; ruta: string }
  | { accion: "marcar_grande" }
  | { accion: "omitir"; motivo: string };

/**
 * Extensión a partir del mime. Sin esto los archivos quedan sin extensión y
 * cualquiera que baje el bucket a mano se encuentra con cientos de archivos que
 * su computador no sabe abrir.
 */
export function extensionDe(mime: string | null | undefined, nombre?: string | null): string {
  // Si el cliente mandó un documento con nombre, su extensión es la más fiable.
  const delNombre = (nombre ?? "").match(/\.([a-zA-Z0-9]{1,5})$/);
  if (delNombre) return delNombre[1].toLowerCase();

  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  const tabla: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  return tabla[m] ?? "bin";
}

/**
 * Ruta dentro del bucket: `<clienteId>/<añoMes>/<mensajeId>.<ext>`.
 *
 * Tres decisiones con motivo:
 *  - **El cliente primero**: permite borrar todo lo de un negocio que se va, o
 *    calcular cuánto ocupa cada uno, con un solo prefijo.
 *  - **Año-mes después**: sin esto, un cliente con años de historia termina con
 *    decenas de miles de archivos en una sola carpeta, imposible de navegar.
 *  - **El id del mensaje como nombre**: es único y hace la operación
 *    idempotente. Si el archivador corre dos veces sobre el mismo mensaje,
 *    sobrescribe el mismo archivo en vez de duplicarlo.
 */
export function rutaPara(p: {
  clienteId: string;
  mensajeId: string;
  creadoEn: string;
  mime?: string | null;
  nombre?: string | null;
}): string {
  const f = new Date(p.creadoEn);
  const añoMes = Number.isFinite(f.getTime())
    ? `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`
    : "sin-fecha";
  return `${p.clienteId}/${añoMes}/${p.mensajeId}.${extensionDe(p.mime, p.nombre)}`;
}

/** ¿Qué hacer con este adjunto? */
export function decidir(p: {
  clienteId: string;
  mensajeId: string;
  creadoEn: string;
  mediaUrl: string | null;
  bytes: number | null;
  mime?: string | null;
  nombre?: string | null;
}): Decision {
  const url = p.mediaUrl ?? "";
  if (!url.startsWith(PREFIJO_META)) {
    return { accion: "omitir", motivo: "no es un puntero de Meta" };
  }
  if (p.bytes !== null && p.bytes > TOPE_BYTES) {
    return { accion: "marcar_grande" };
  }
  return { accion: "archivar", ruta: rutaPara(p) };
}

/** ¿Ya venció el plazo de Meta para este mensaje? */
export function vencido(creadoEn: string, ahora: number = Date.now()): boolean {
  const t = new Date(creadoEn).getTime();
  if (!Number.isFinite(t)) return false;
  return ahora - t > 7 * 24 * 3600_000;
}
