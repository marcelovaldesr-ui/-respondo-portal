/**
 * CABECERAS SEGURAS PARA SERVIR UN ADJUNTO DE CONVERSACIÓN (auditoría 11-sep-2026).
 *
 * El tipo de un adjunto lo declara QUIEN LO MANDA: cualquier número de WhatsApp
 * puede enviar un documento `cotizacion.html` o un `.svg` con un script adentro.
 * Si `/api/whatsapp/media` lo devolviera con su tipo declarado, el navegador lo
 * ejecutaría en el MISMO origen del portal, con la sesión de la persona que lo
 * abrió: podría leer conversaciones y mandar mensajes como el negocio.
 *
 * Regla: solo imágenes rasterizadas, audio, video mp4 y PDF se muestran dentro
 * del portal. Todo lo demás sale como descarga binaria, con `nosniff` para que
 * el navegador no "adivine" el tipo. Vive en lib/ (y no dentro de la ruta) para
 * poder probarlo sin levantar Next.
 */
export const TIPOS_INLINE: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "audio/amr",
  "video/mp4",
  "application/pdf",
]);

/** Deja solo caracteres seguros para un nombre de archivo en una cabecera. */
export function nombreSeguro(nombre: string | null | undefined): string {
  const limpio = String(nombre ?? "")
    .replace(/[^\w.\- ]/g, "_")
    .slice(0, 120)
    .trim();
  return limpio || "archivo";
}

export function cabecerasDeTipo(
  tipoDeclarado: string | null | undefined,
  nombre: string | null | undefined,
): Record<string, string> {
  const tipo = String(tipoDeclarado ?? "").split(";")[0].trim().toLowerCase();
  const inline = TIPOS_INLINE.has(tipo);
  return {
    "Content-Type": inline ? tipo : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nombreSeguro(nombre)}"`,
    "X-Content-Type-Options": "nosniff",
  };
}
