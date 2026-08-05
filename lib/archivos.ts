const FIRMAS: Record<string, (buf: Buffer) => boolean> = {
  "image/jpeg": (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) =>
    b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  "image/gif": (b) => {
    const firma = b.subarray(0, 6).toString("ascii");
    return firma === "GIF87a" || firma === "GIF89a";
  },
  "application/pdf": (b) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-",
};

export const MAX_ARCHIVO_BYTES = 8 * 1024 * 1024;

export function validarArchivoBase64(
  data: string,
  mime: string,
): { ok: true; bytes: number } | { ok: false; error: string } {
  const verificarFirma = FIRMAS[mime];
  if (!verificarFirma) return { ok: false, error: "Tipo de archivo no permitido" };
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, error: "Contenido base64 inválido" };
  }
  const buf = Buffer.from(data, "base64");
  if (buf.length === 0 || buf.length > MAX_ARCHIVO_BYTES) {
    return { ok: false, error: "Archivo demasiado grande" };
  }
  if (!verificarFirma(buf.subarray(0, 16))) {
    return { ok: false, error: "El contenido no coincide con el tipo declarado" };
  }
  return { ok: true, bytes: buf.length };
}
