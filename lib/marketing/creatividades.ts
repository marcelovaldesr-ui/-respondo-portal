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
  const { data, error } = await db()
    .from("ed_mk_creatividades")
    .select("*")
    .eq("cliente_id", clienteId)
    .order("actualizado_en", { ascending: false })
    .limit(200);
  if (error) return { disponible: false, items: [] };
  return { disponible: true, items: (data ?? []).map((f) => desdeFila(f as Record<string, unknown>)) };
}

export async function obtenerCreatividad(
  clienteId: string,
  id: string,
  demo = false,
): Promise<Creatividad | null> {
  if (demo) {
    return panoramaDemo(resolverRango("30d")).creatividades.find((c) => c.id === id) ?? null;
  }
  const { data, error } = await db()
    .from("ed_mk_creatividades")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return desdeFila(data as Record<string, unknown>);
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
    if (!paquete) return { ok: false, motivo: "El modelo devolvió un anuncio incompleto. Prueba de nuevo." };
    return { ok: true, paquete };
  } catch (e) {
    return { ok: false, motivo: `No se pudo generar el texto: ${(e as Error).message}` };
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
  if (!key) return { ok: false, motivo: "Falta GEMINI_API_KEY en el servidor." };

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
    if (!r.ok) return { ok: false, motivo: j.error?.message ?? `HTTP ${r.status}` };
    const parte = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!parte?.inlineData?.data) return { ok: false, motivo: "El modelo no devolvió una imagen." };
    png = Buffer.from(parte.inlineData.data, "base64");
  } catch (e) {
    return { ok: false, motivo: `No se pudo generar la imagen: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }

  // A JPEG: 1,4 MB → ~90 KB. Supabase Free tiene 1 GB de storage y se llena.
  let jpeg: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    jpeg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  } catch {
    jpeg = png;
  }

  const supa = db();
  const ruta = `${clienteId}/${Date.now()}.jpg`;
  const subida = await supa.storage.from(BUCKET).upload(ruta, jpeg, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (subida.error) {
    return {
      ok: false,
      motivo: `La imagen se generó pero no se pudo guardar (¿falta la migración 303?): ${subida.error.message}`,
    };
  }
  const { data } = supa.storage.from(BUCKET).getPublicUrl(ruta);
  if (!data?.publicUrl) return { ok: false, motivo: "No se pudo obtener el enlace de la imagen." };
  return { ok: true, url: data.publicUrl };
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
  const fila = {
    cliente_id: clienteId,
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
    imagen_url: entrada.imagenUrl,
    imagen_prompt: entrada.imagenPrompt,
    estado: entrada.estado ?? "borrador",
    campana_id: entrada.campanaId ?? null,
    variante_de: entrada.varianteDe ?? null,
    actualizado_en: new Date().toISOString(),
  };

  const supa = db();
  if (id) {
    const { error } = await supa
      .from("ed_mk_creatividades")
      .update(fila)
      .eq("id", id)
      .eq("cliente_id", clienteId);
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, id };
  }
  const { data, error } = await supa
    .from("ed_mk_creatividades")
    .insert(fila)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      motivo: /relation .* does not exist|schema cache/i.test(error?.message ?? "")
        ? "Falta aplicar la migración 303 para poder guardar creatividades."
        : (error?.message ?? "No se pudo guardar."),
    };
  }
  return { ok: true, id: String(data.id) };
}

export async function cambiarEstadoCreatividad(
  clienteId: string,
  id: string,
  estado: Creatividad["estado"],
): Promise<boolean> {
  const { error } = await db()
    .from("ed_mk_creatividades")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .eq("cliente_id", clienteId);
  return !error;
}

export async function eliminarCreatividad(clienteId: string, id: string): Promise<boolean> {
  const { error } = await db()
    .from("ed_mk_creatividades")
    .delete()
    .eq("id", id)
    .eq("cliente_id", clienteId);
  return !error;
}
