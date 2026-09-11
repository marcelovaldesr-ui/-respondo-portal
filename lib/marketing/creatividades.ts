import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { contextoDeMarca, contextoEnTexto } from "@/lib/marketing/contextoMarca";
import {
  parsearPaquete,
  promptCreativo,
  type PaqueteCreativo,
  type PedidoCreativo,
} from "@/lib/marketing/creatividadesCore";
import { panoramaDemo } from "@/lib/marketing/demo";
import { resolverRango } from "@/lib/ads/periodos";
import type { Creatividad, FormatoCreatividad } from "@/lib/marketing/tipos";
import { textoDeFalla, traducirFalla } from "@/lib/marketing/fallas";
import { borrarEn, insertarEn, leerColumnas, leerDe, modificarEn, perteneceA, soloDe, unaDe } from "@/lib/marketing/tenant";
import { PREFIJO, rutaDeImagen, rutaEsDelCliente } from "@/lib/marketing/imagenes";

/**
 * EL ESTUDIO CREATIVO — generar, guardar, variar.
 *
 * Dos modelos, dos trabajos:
 *   · El texto (concepto, gancho, titular, cuerpo, CTA, variantes) lo escribe
 *     Gemini a partir del CONTEXTO DEL NEGOCIO —incluido lo que Isabel aprendió
 *     de las conversaciones—. Es la parte que ningún competidor puede copiar:
 *     el anuncio habla con las palabras de los clientes reales.
 *   · La imagen la genera `gemini-2.5-flash-image` con la misma llave, se
 *     comprime a JPEG y se sube al bucket `creatividades`. Verificado el
 *     10-sep-2026: ~5 s por imagen, 1,4 MB en PNG → ~90 KB en JPEG.
 *
 * Si la imagen falla, la creatividad se guarda igual SIN imagen y lo dice.
 * Un paquete de texto sin foto sirve; una pantalla que dice «error» no.
 */

const MODELO_IMAGEN = "gemini-2.5-flash-image";
const BUCKET = "creatividades";
const TABLA = "ed_mk_creatividades" as const;

/** Topes de la imagen generada. El bucket además corta en 4 MB (migración 303). */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LADO = 4096;
const MAX_PIXELES = 40_000_000;

export { PREFIJO, rutaDeImagen, rutaEsDelCliente, urlDeImagen } from "@/lib/marketing/imagenes";


/* ── Lectura ─────────────────────────────────────────────────────────────── */

function desdeFila(f: Record<string, unknown>): Creatividad {
  return {
    id: String(f.id),
    nombre: String(f.nombre ?? ""),
    objetivo: String(f.objetivo ?? "conversaciones"),
    producto: String(f.producto ?? ""),
    oferta: String(f.oferta ?? ""),
    plataforma: (f.plataforma as Creatividad["plataforma"]) ?? "ambas",
    formato: (f.formato as FormatoCreatividad) ?? "1:1",
    concepto: String(f.concepto ?? ""),
    gancho: String(f.gancho ?? ""),
    titular: String(f.titular ?? ""),
    texto: String(f.texto ?? ""),
    cta: String(f.cta ?? ""),
    imagenUrl: (f.imagen_url as string | null) ?? null,
    imagenPrompt: (f.imagen_prompt as string | null) ?? null,
    estado: (f.estado as Creatividad["estado"]) ?? "borrador",
    campanaId: (f.campana_id as string | null) ?? null,
    campanaNombre: null,
    varianteDe: (f.variante_de as string | null) ?? null,
    creadoEn: String(f.creado_en ?? ""),
    actualizadoEn: String(f.actualizado_en ?? ""),
    rendimiento: null,
  };
}

/**
 * Las creatividades del negocio. Devuelve `disponible: false` cuando la
 * migración 303 no está aplicada, para que la pantalla lo diga en vez de
 * mostrar una galería vacía que parece un error.
 */
export async function listarCreatividades(
  clienteId: string,
  demo = false,
): Promise<{ disponible: boolean; items: Creatividad[] }> {
  if (demo) return { disponible: true, items: panoramaDemo(resolverRango("30d")).creatividades };
  const { data, error } = await leerDe(clienteId, TABLA).order("actualizado_en", { ascending: false }).limit(200);
  if (error) return { disponible: false, items: [] };
  const filas = soloDe(clienteId, TABLA, data as Record<string, unknown>[] | null);
  return { disponible: true, items: filas.map((f) => desdeFila(f)) };
}

export async function obtenerCreatividad(
  clienteId: string,
  id: string,
  demo = false,
): Promise<Creatividad | null> {
  if (demo) {
    return panoramaDemo(resolverRango("30d")).creatividades.find((c) => c.id === id) ?? null;
  }
  const { data, error } = await leerDe(clienteId, TABLA).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const fila = unaDe(clienteId, TABLA, data as Record<string, unknown>);
  return fila ? desdeFila(fila) : null;
}

/* ── Generación ──────────────────────────────────────────────────────────── */

export type ResultadoGeneracion =
  | { ok: true; paquete: PaqueteCreativo }
  | { ok: false; motivo: string };

/** Escribe el paquete creativo (texto) con el contexto real del negocio. */
export async function generarPaquete(
  clienteId: string,
  pedido: Omit<PedidoCreativo, "contexto">,
  demo = false,
): Promise<ResultadoGeneracion> {
  const marca = await contextoDeMarca(clienteId, demo);
  const prompt = promptCreativo({ ...pedido, contexto: contextoEnTexto(marca) });
  try {
    const crudo = await generarJSON(prompt, { timeoutMs: 30_000, thinkingBudget: 512 });
    const paquete = parsearPaquete(crudo);
    if (!paquete) return { ok: false, motivo: textoDeFalla("incompleto") };
    return { ok: true, paquete };
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "ia", operacion: "generarPaquete", clienteId, crudo: e }) };
  }
}

/**
 * Genera la imagen y la deja en el bucket. Devuelve la URL pública, o el
 * motivo por el que no se pudo (para mostrarlo, no para esconderlo).
 */
export async function generarImagen(
  clienteId: string,
  prompt: string,
  formato: FormatoCreatividad,
): Promise<{ ok: true; url: string } | { ok: false; motivo: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, motivo: textoDeFalla("sin_motor") };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  let png: Buffer;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEN}:generateContent?key=${key}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n\nFotografía publicitaria profesional, realista, sin texto, sin logos, sin marcas de agua.` }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: formato } },
        }),
      },
    );
    const j = (await r.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
      error?: { message?: string };
    };
    if (!r.ok)
      return {
        ok: false,
        motivo: traducirFalla({
          proveedor: "imagen",
          operacion: "generarImagen",
          clienteId,
          crudo: j.error?.message ?? `HTTP ${r.status}`,
        }),
      };
    const parte = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!parte?.inlineData?.data) return { ok: false, motivo: "No salió ninguna imagen. Vuelve a intentar." };
    png = Buffer.from(parte.inlineData.data, "base64");
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "imagen", operacion: "generarImagen", clienteId, crudo: e }) };
  } finally {
    clearTimeout(timer);
  }

  /**
   * A JPEG, y de paso la validación del contenido.
   *
   * Recodificar con sharp NO es solo para ahorrar espacio (1,4 MB → ~90 KB, y
   * Supabase Free tiene 1 GB): es lo que garantiza que lo que se sube sea una
   * imagen de verdad. Lo que llega es base64 de un tercero; si no decodifica
   * como imagen, sharp falla y no se sube nada. Antes el `catch` subía los
   * bytes crudos etiquetados como `image/jpeg`, así que una respuesta rara del
   * modelo terminaba en el bucket con un tipo que no le correspondía.
   */
  let jpeg: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(png, { limitInputPixels: MAX_PIXELES });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return { ok: false, motivo: "Lo que llegó no es una imagen. Vuelve a intentar." };
    if (meta.width > MAX_LADO || meta.height > MAX_LADO) {
      return { ok: false, motivo: "La imagen salió más grande de lo esperado. Vuelve a intentar." };
    }
    jpeg = await img.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  } catch {
    return { ok: false, motivo: "Lo que llegó no es una imagen. Vuelve a intentar." };
  }
  if (jpeg.byteLength > MAX_BYTES) return { ok: false, motivo: "La imagen pesa demasiado. Vuelve a intentar." };

  const supa = db();
  /**
   * La ruta la arma el servidor con el `clienteId` DE LA SESIÓN. No hay ningún
   * camino por el que el navegador proponga un path: sin eso, un `../` o un
   * uuid ajeno escribiría en el prefijo de otro negocio.
   */
  const ruta = `${clienteId}/${Date.now()}.jpg`;
  const subida = await supa.storage.from(BUCKET).upload(ruta, jpeg, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (subida.error) {
    return {
      ok: false,
      motivo: traducirFalla({ proveedor: "almacen", operacion: "subirImagen", clienteId, crudo: subida.error.message }),
    };
  }
  // Se devuelve el PUNTERO, no una URL pública. Quien lo pinta lo pasa por
  // `urlDeImagen()`; quien lo guarda, por la validación de `guardarCreatividad`.
  return { ok: true, url: `${PREFIJO}${ruta}` };
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export type EntradaCreatividad = {
  nombre: string;
  objetivo: string;
  producto: string;
  oferta: string;
  plataforma: Creatividad["plataforma"];
  formato: FormatoCreatividad;
  concepto: string;
  gancho: string;
  titular: string;
  texto: string;
  cta: string;
  imagenUrl: string | null;
  imagenPrompt: string | null;
  estado?: Creatividad["estado"];
  campanaId?: string | null;
  varianteDe?: string | null;
};

export async function guardarCreatividad(
  clienteId: string,
  entrada: EntradaCreatividad,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  /**
   * Los dos punteros que vienen del navegador se verifican contra ESTE negocio
   * antes de escribirse. Una acción de servidor es un endpoint público: hoy la
   * pantalla siempre manda ids propios, pero nada impide una petición fabricada
   * con el id de la campaña de otro cliente. No se filtra nada al leer, pero
   * quedaría un puntero cruzado guardado, y eso es una fuga esperando a que
   * alguien lo resuelva sin filtrar por cliente.
   */
  /**
   * `imagenUrl` llega del navegador como todo lo demás, y hasta ahora se
   * escribía cruda. Una petición fabricada podía persistir
   * `https://atacante.example/pixel.jpg` y el portal lo pediría cada vez que
   * pinta esa creatividad. Solo se aceptan punteros nuestros, y solo del
   * prefijo de ESTE negocio: nadie apunta al archivo de otra empresa.
   */
  const rutaImagen = rutaDeImagen(entrada.imagenUrl);
  const imagenUrl = rutaImagen && rutaEsDelCliente(rutaImagen, clienteId) ? `${PREFIJO}${rutaImagen}` : null;

  const [campanaId, varianteDe] = await Promise.all([
    perteneceA(clienteId, "ed_mk_campanas", entrada.campanaId),
    perteneceA(clienteId, TABLA, entrada.varianteDe),
  ]);

  const fila = {
    nombre: entrada.nombre.slice(0, 80),
    objetivo: entrada.objetivo,
    producto: entrada.producto.slice(0, 120),
    oferta: entrada.oferta.slice(0, 200),
    plataforma: entrada.plataforma,
    formato: entrada.formato,
    concepto: entrada.concepto.slice(0, 400),
    gancho: entrada.gancho.slice(0, 120),
    titular: entrada.titular.slice(0, 120),
    texto: entrada.texto.slice(0, 1000),
    cta: entrada.cta.slice(0, 40),
    imagen_url: imagenUrl,
    imagen_prompt: entrada.imagenPrompt,
    estado: entrada.estado ?? "borrador",
    campana_id: campanaId,
    variante_de: varianteDe,
    actualizado_en: new Date().toISOString(),
  };

  if (id) {
    const { data, error } = await modificarEn(clienteId, TABLA, id, fila);
    if (error) return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "guardarCreatividad", clienteId, crudo: error.message }) };
    if (!data) return { ok: false, motivo: "Esa creatividad ya no existe. Puede que se haya eliminado desde otra pestaña." };
    return { ok: true, id };
  }
  const { data, error } = await insertarEn(clienteId, TABLA, fila);
  if (error || !data) {
    return {
      ok: false,
      motivo: traducirFalla({ proveedor: "almacen", operacion: "crearCreatividad", clienteId, crudo: error?.message ?? "sin fila" }),
    };
  }
  return { ok: true, id: String(data.id) };
}

export async function cambiarEstadoCreatividad(
  clienteId: string,
  id: string,
  estado: Creatividad["estado"],
): Promise<boolean> {
  const { data, error } = await modificarEn(clienteId, TABLA, id, { estado, actualizado_en: new Date().toISOString() });
  return !error && Boolean(data);
}

/**
 * Elimina la creatividad Y su imagen, en ese orden y nunca al revés.
 *
 * PRIMERO la fila: si el borrado en Storage falla, queda un archivo huérfano
 * —molesto, invisible, barato—. Al revés quedaría una creatividad viva con la
 * imagen rota, que sí se ve y sí duele.
 *
 * Y antes de borrar el archivo se comprueba que NADIE MÁS lo apunte: duplicar
 * una creatividad copia la misma ruta, así que borrar la copia se llevaría la
 * imagen del original. Es idempotente: si el objeto ya no está, no pasa nada.
 */
export async function eliminarCreatividad(clienteId: string, id: string): Promise<boolean> {
  const { data, error } = await borrarEn(clienteId, TABLA, id, "id, imagen_url");
  if (error || !data) return false;

  const ruta = rutaDeImagen((data as { imagen_url?: string | null }).imagen_url);
  if (ruta) await borrarImagenSiNadieLaUsa(clienteId, ruta);
  return true;
}

/** Solo se borra el archivo si ninguna otra creatividad del negocio lo referencia. */
async function borrarImagenSiNadieLaUsa(clienteId: string, ruta: string): Promise<void> {
  try {
    const { data } = await leerColumnas(clienteId, TABLA, "id").eq("imagen_url", `${PREFIJO}${ruta}`).limit(1);
    if (data?.length) return;
    await db().storage.from(BUCKET).remove([ruta]);
  } catch {
    // Un huérfano en el bucket no puede hacer fallar el borrado que el dueño pidió.
  }
}


