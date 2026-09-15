import { db } from "@/lib/db";
import { exigirId, leerColumnas, soloDe } from "@/lib/marketing/tenant";
import { PREFIJO, rutaDeImagen, rutaEsDelCliente, urlDeImagen } from "@/lib/marketing/imagenes";
import { avisoDeProporcion, validarImagen } from "@/lib/marketing/assetsCore";
import type { FormatoCreatividad, PlataformaCreatividad } from "@/lib/marketing/tipos";
import { traducirFalla } from "@/lib/marketing/fallas";

/**
 * SUBIR UNA PIEZA PROPIA, Y REUTILIZAR LAS QUE YA EXISTEN.
 *
 * Mismo bucket privado que las generadas (`creatividades`), misma forma de
 * ruta, mismo endpoint con sesión. **No hay bucket público nuevo y no hay un
 * segundo camino**: una vez subida, la pieza se comporta exactamente igual que
 * una generada —vista previa, campaña, anuncio—, y por eso `origen` es una
 * columna y no una bifurcación del código.
 *
 * ⚠️ La ruta la arma el SERVIDOR con el `clienteId` de la sesión. El navegador
 * no propone ningún path: sin eso, un `../` o un uuid ajeno escribiría en el
 * prefijo de otro negocio.
 */

const BUCKET = "creatividades";

export type ResultadoSubida =
  | { ok: true; url: string; puntero: string; ancho: number; alto: number; aviso: string | null }
  | { ok: false; motivo: string };

export async function subirPieza(
  clienteId: string,
  bytes: Uint8Array,
  formato: FormatoCreatividad,
  /** La plataforma que eligió la persona: decide a quién nombra el aviso de recorte. */
  plataforma?: PlataformaCreatividad,
): Promise<ResultadoSubida> {
  exigirId(clienteId);

  /**
   * El decodificador es la validación.
   *
   * No se mira el nombre del archivo ni el `Content-Type` del formulario: los
   * dos los escribe el cliente. Si sharp no lo decodifica como imagen, no es
   * una imagen, y no se sube nada. Es la misma defensa que ya protege a las
   * generadas.
   */
  let meta: { format?: string; width?: number; height?: number };
  try {
    const sharp = (await import("sharp")).default;
    meta = await sharp(Buffer.from(bytes), { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    return { ok: false, motivo: "Ese archivo no se pudo leer como imagen." };
  }

  const v = validarImagen({
    formato: meta.format,
    ancho: meta.width ?? 0,
    alto: meta.height ?? 0,
    bytes: bytes.byteLength,
  });
  if (!v.ok) return v;

  const ruta = `${clienteId}/${Date.now()}.${v.extension}`;
  const tipo = v.extension === "jpg" ? "image/jpeg" : `image/${v.extension}`;

  /**
   * Se suben los bytes ORIGINALES.
   *
   * Recodificarlos garantizaría aún más que son una imagen, pero alteraría la
   * pieza de un diseñador —transparencia, nitidez del texto, perfil de color—
   * y la misión es explícita: no se toca. La garantía la da el decodificado de
   * arriba, y el endpoint sirve el tipo derivado de NUESTRA ruta con `nosniff`.
   */
  const subida = await db().storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo, upsert: false });
  if (subida.error) {
    return {
      ok: false,
      motivo: traducirFalla({ proveedor: "almacen", operacion: "subirPieza", clienteId, crudo: subida.error.message }),
    };
  }

  const puntero = `${PREFIJO}${ruta}`;
  return {
    ok: true,
    puntero,
    url: urlDeImagen(puntero) ?? "",
    ancho: v.ancho,
    alto: v.alto,
    aviso: avisoDeProporcion(v.ancho, v.alto, formato, plataforma),
  };
}

export type PiezaExistente = {
  id: string;
  nombre: string;
  puntero: string;
  url: string;
  formato: FormatoCreatividad;
  origen: string;
};

/**
 * Las piezas que este negocio ya tiene, para reutilizarlas sin volver a subir
 * ni volver a generar.
 *
 * Es la tercera vía de la misión —generar / subir / usar una existente— y la
 * más barata de las tres: no gasta cupo, no gasta modelo y no gasta tiempo.
 */
export async function piezasExistentes(clienteId: string, limite = 24): Promise<PiezaExistente[]> {
  exigirId(clienteId);
  const { data, error } = await leerColumnas(clienteId, "ed_mk_creatividades", "id, nombre, imagen_url, formato, origen, cliente_id, actualizado_en")
    .not("imagen_url", "is", null)
    .order("actualizado_en", { ascending: false })
    .limit(limite);

  // Sin la 310 la columna `origen` no existe y PostgREST rechaza el select
  // ENTERO. Se reintenta sin ella en vez de dejar la galería vacía.
  if (error) {
    const r2 = await leerColumnas(clienteId, "ed_mk_creatividades", "id, nombre, imagen_url, formato, cliente_id, actualizado_en")
      .not("imagen_url", "is", null)
      .order("actualizado_en", { ascending: false })
      .limit(limite);
    if (r2.error) return [];
    return mapear(clienteId, r2.data as unknown as Record<string, unknown>[] | null);
  }
  return mapear(clienteId, data as unknown as Record<string, unknown>[] | null);
}

function mapear(clienteId: string, filas: Record<string, unknown>[] | null): PiezaExistente[] {
  return soloDe(clienteId, "ed_mk_creatividades", filas)
    .map((f) => {
      const puntero = String(f.imagen_url ?? "");
      const ruta = rutaDeImagen(puntero);
      // Se descarta cualquier puntero que no sea de este negocio antes de que
      // llegue a la pantalla: la galería no es un lugar para descubrir fugas.
      if (!ruta || !rutaEsDelCliente(ruta, clienteId)) return null;
      return {
        id: String(f.id),
        nombre: String(f.nombre ?? "Sin nombre"),
        puntero,
        url: urlDeImagen(puntero) ?? "",
        formato: (f.formato as FormatoCreatividad) ?? "1:1",
        origen: String(f.origen ?? "generada"),
      };
    })
    .filter((p): p is PiezaExistente => p !== null);
}
