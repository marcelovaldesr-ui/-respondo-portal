import { proporcion } from "@/lib/marketing/creatividadesCore";
import type { FormatoCreatividad, PlataformaCreatividad } from "@/lib/marketing/tipos";
import type { Extension } from "@/lib/marketing/imagenes";

/**
 * LAS PIEZAS QUE SUBE EL NEGOCIO — validación pura.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTO NO ES UN «EXTRA»
 *
 * Una empresa con diseñador propio —o con un manual de marca, o con una pieza
 * que ya aprobó su cliente— no puede estar obligada a pasar por un generador de
 * imágenes para usar el Estudio. Si lo está, el Estudio no le sirve, y lo que
 * el producto llama «creatividad» pasa a significar «lo que salió de Gemini».
 *
 * ⭐ LA REGLA DE ORO: la pieza de la persona NO se toca.
 *
 * No se recorta, no se reescala, no se recomprime y no se manda a ningún modelo
 * salvo que ella lo pida explícitamente. Si la proporción no calza con el
 * formato elegido, se le DICE —«esta pieza es 1:1 y el formato es historia»— y
 * decide ella. Deformar la pieza de un diseñador para que entre en un marco es
 * la clase de ayuda que nadie pidió.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 8 MB: un JPEG de anuncio bien exportado pesa menos de 1. */
export const MAX_BYTES_SUBIDA = 8 * 1024 * 1024;
export const MIN_LADO = 320;
export const MAX_LADO_SUBIDA = 8192;
export const MAX_PIXELES_SUBIDA = 50_000_000;

export type FormatoDetectado = { formato: string | undefined; ancho: number; alto: number; bytes: number };

export type Veredicto =
  | { ok: true; extension: Extension; ancho: number; alto: number }
  | { ok: false; motivo: string };

/**
 * ¿Esta pieza se puede guardar?
 *
 * El formato que se comprueba es el que DETECTÓ el decodificador, no el que
 * declaró el navegador: un archivo puede llamarse `.png` y traer cualquier
 * cosa, y el `Content-Type` de un formulario lo escribe el cliente.
 */
export function validarImagen(d: FormatoDetectado): Veredicto {
  if (d.bytes > MAX_BYTES_SUBIDA) {
    return { ok: false, motivo: `La imagen pesa ${(d.bytes / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.` };
  }
  const ext = extensionDe(d.formato);
  if (!ext) {
    return { ok: false, motivo: "Ese archivo no es una imagen JPG, PNG o WEBP." };
  }
  if (!d.ancho || !d.alto) return { ok: false, motivo: "El archivo no se pudo leer como imagen." };
  if (d.ancho < MIN_LADO || d.alto < MIN_LADO) {
    return { ok: false, motivo: `La imagen es de ${d.ancho}×${d.alto} y se va a ver pixelada. El mínimo son ${MIN_LADO} px por lado.` };
  }
  if (d.ancho > MAX_LADO_SUBIDA || d.alto > MAX_LADO_SUBIDA) {
    return { ok: false, motivo: `La imagen es de ${d.ancho}×${d.alto} y el máximo son ${MAX_LADO_SUBIDA} px por lado.` };
  }
  if (d.ancho * d.alto > MAX_PIXELES_SUBIDA) {
    return { ok: false, motivo: "La imagen tiene demasiados píxeles." };
  }
  return { ok: true, extension: ext, ancho: d.ancho, alto: d.alto };
}

export function extensionDe(formato: string | undefined): Extension | null {
  switch ((formato ?? "").toLowerCase()) {
    case "jpeg":
    case "jpg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    default:
      return null;
  }
}

/**
 * Quién va a recortar la pieza.
 *
 * ⚠️ El aviso decía «Meta la va a recortar» en duro, y este módulo también
 * alimenta creatividades de Google: al que subía un banner para Google Ads se
 * le nombraba la plataforma equivocada. La plataforma la elige la persona en el
 * mismo formulario en que sube la pieza, así que viaja con el pedido; cuando no
 * viene —una pieza que todavía no tiene destino— el aviso queda neutral en vez
 * de adivinar.
 */
function quienRecorta(plataforma: PlataformaCreatividad | undefined): string {
  switch (plataforma) {
    case "google":
      return "Google Ads";
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "ambas":
      return "Meta";
    default:
      return "La plataforma donde lo publiques";
  }
}

/**
 * ¿La proporción de la pieza calza con el formato del anuncio?
 *
 * Devuelve un AVISO, no un error. La persona puede querer subir un cuadrado
 * para una historia sabiendo perfectamente lo que hace.
 */
export function avisoDeProporcion(
  ancho: number,
  alto: number,
  formato: FormatoCreatividad,
  plataforma?: PlataformaCreatividad,
): string | null {
  const esperada = proporcion(formato);
  const real = ancho / alto;
  const desvio = Math.abs(real - esperada) / esperada;
  if (desvio < 0.06) return null;
  return (
    `Tu imagen es ${ancho}×${alto} y el formato elegido es ${formato}. ` +
    `${quienRecorta(plataforma)} la va a recortar por su cuenta. Se guarda tal cual: si prefieres, cambia el formato o sube la pieza ya exportada en ${formato}.`
  );
}
