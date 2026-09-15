import { db } from "@/lib/db";
import { generarJSON } from "@/lib/gemini";
import { listarFichas } from "@/lib/conocimiento";
import { saberDelNegocio } from "@/lib/isabel";
import type { HechoSabido } from "@/lib/isabelCore";
import { clasificarFichas, type FichaClasificada } from "@/lib/marketing/rolesConocimiento";
import {
  contextoComercialEnTexto,
  ensamblarContexto,
  fichasParaExtraer,
  parsearExtraccion,
  promptExtraccion,
  type ContextoComercial,
  type Extraccion,
} from "@/lib/marketing/contextoComercialCore";
import { exigirId, leerDe, insertarEn, modificarEn, soloDe } from "@/lib/marketing/tenant";
import { contextoComercialDemo } from "@/lib/marketing/demo";

/**
 * EL CONTEXTO COMERCIAL — carga, caché y reconstrucción.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ SE CACHEA, SI ANTES SE ARMABA AL VUELO
 *
 * Tres razones, en orden de importancia:
 *
 *  1. **Para poder mostrarlo y corregirlo.** Un contexto que se recalcula en
 *     cada generación no se puede revisar: la persona corregiría un espejismo.
 *     Guardado, existe «lo que Respondo entiende de tu negocio» y existe el
 *     botón de editar. La corrección de una persona vale más que cualquier
 *     inferencia nuestra, y tiene que sobrevivir a la siguiente generación.
 *
 *  2. **Para no pagar una llamada al modelo por anuncio.** La extracción del
 *     catálogo es UNA llamada; el contexto cambia cuando cambia el
 *     conocimiento del negocio, no cuando alguien escribe un brief.
 *
 *  3. Para que dos anuncios del mismo negocio partan del mismo entendimiento.
 *
 * ⚠️ Sin la migración 310 esto sigue funcionando: se arma en memoria y no se
 * guarda. Lo dice, no falla.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TABLA = "ed_mk_contexto" as const;

export type ContextoGuardado = {
  contexto: ContextoComercial;
  /** Cuándo se construyó. */
  actualizadoEn: string | null;
  /** Una persona lo corrigió a mano: no se pisa al reconstruir. */
  editado: boolean;
  /** La 310 no está aplicada: se puede usar, no se puede guardar. */
  persistible: boolean;
};

/**
 * Lo que aprendió Isabel, reducido a vocabulario.
 *
 * ⭐ Acá NO viaja ninguna conversación. `ed_isabel_saber` ya es un agregado
 * destilado cada noche —«piden pendón para ferias, casi siempre con apuro»—, y
 * lo que sale de esta función es todavía menos: la frase, sin el cliente, sin
 * el número, sin la fecha. Es la única forma en que lo que dicen los clientes
 * de un negocio entra a un prompt.
 */
export function vocabularioDeSaber(saber: HechoSabido[]): string[] {
  return saber
    .filter((h) => h.tipo === "piden" || h.tipo === "objecion")
    .sort((a, b) => (b.veces ?? 0) - (a.veces ?? 0))
    .map((h) => h.texto.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 10 && t.length < 220)
    .slice(0, 10);
}

/** La zona, si alguna ficha operativa la nombra. */
function zonaDe(fichas: FichaClasificada[]): string | null {
  const texto = fichas
    .filter((f) => f.rol === "operacion" || f.rol === "identidad")
    .map((f) => f.contenido)
    .join(" ");
  const m = texto.match(
    /\b(Santiago|Chill[áa]n|Concepci[óo]n|Valpara[íi]so|Vi[ñn]a del Mar|Temuco|Antofagasta|La Serena|Rancagua|Talca|Puerto Montt|Los [ÁA]ngeles|Iquique|Arica|Osorno|Valdivia|Curic[óo]|Quillota|Copiap[óo]|Punta Arenas)\b/i,
  );
  return m ? m[1] : null;
}

function sitioDe(fichas: FichaClasificada[]): string | null {
  const m = fichas.map((f) => f.contenido).join(" ").match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:cl|com)(?:\/[^\s,)]*)?)/i);
  return m ? m[1] : null;
}

/* ── Construcción ────────────────────────────────────────────────────────── */

/**
 * Arma el contexto desde cero. UNA llamada al modelo, y solo para extraer
 * entidades del catálogo; todo lo demás es determinista.
 *
 * Si el modelo falla, el contexto se arma igual sin `vende`: entonces
 * `completitud()` dice que no sabemos qué vende y la pantalla lo pregunta, en
 * vez de rellenar el hueco con cualquier título.
 */
export async function construirContexto(clienteId: string): Promise<ContextoComercial> {
  exigirId(clienteId);

  const [cliente, fichasCrudas, saber] = await Promise.all([
    db()
      .from("ed_clientes")
      .select("nombre, rubro")
      .eq("id", clienteId)
      .maybeSingle()
      .then((r) => r.data as Record<string, unknown> | null),
    listarFichas(clienteId).catch(() => []),
    saberDelNegocio(clienteId, 40).catch(() => [] as HechoSabido[]),
  ]);

  const fichas = clasificarFichas(fichasCrudas.filter((f) => f.vigente));
  const nombre = String(cliente?.nombre ?? "Tu negocio");
  const rubro = String(cliente?.rubro ?? "");

  let extraccion: Extraccion | null = null;
  let extraccionFallida = false;
  const paraExtraer = fichasParaExtraer(fichas);
  if (paraExtraer.length) {
    try {
      const crudo = await generarJSON(promptExtraccion(nombre, rubro, paraExtraer), {
        timeoutMs: 40_000,
        thinkingBudget: 1024,
      });
      extraccion = parsearExtraccion(crudo);
    } catch {
      // Se sigue sin extracción, pero queda dicho que el fallo fue NUESTRO:
      // culpar a los datos del negocio por una llave que falta es mentirle.
      extraccion = null;
      extraccionFallida = true;
    }
    if (!extraccion) extraccionFallida = true;
  }

  return ensamblarContexto({
    nombre,
    rubro,
    zona: zonaDe(fichas),
    sitio: sitioDe(fichas),
    fichas,
    vocabularioCliente: vocabularioDeSaber(saber),
    extraccion,
    extraccionFallida,
  });
}

/* ── Caché ───────────────────────────────────────────────────────────────── */

/**
 * Caché en memoria, como red de seguridad del costo.
 *
 * La caché de verdad es la tabla `ed_mk_contexto`. Pero mientras la migración
 * 310 no esté aplicada —y hasta que alguien la corra, no lo está— cada
 * generación reconstruiría el contexto entero, que es UNA llamada al modelo de
 * entre 7 y 12 segundos por anuncio. Lo descubrió la prueba del recorrido sin
 * modelo, que dejó ver que el contexto se rearmaba siempre.
 *
 * Diez minutos es deliberado: lo suficiente para que escribir tres anuncios
 * seguidos cueste una sola extracción, lo bastante corto para que editar el
 * conocimiento del negocio se note enseguida. Vive en el proceso, así que no
 * sobrevive a un despliegue ni se comparte entre instancias — y eso está bien:
 * es una mitigación de costo, no la fuente de verdad.
 */
const EN_MEMORIA = new Map<string, { contexto: ContextoComercial; hasta: number }>();
const VIDA_MS = 10 * 60 * 1000;



async function leerGuardado(clienteId: string): Promise<{ fila: Record<string, unknown> | null; persistible: boolean }> {
  const { data, error } = await leerDe(clienteId, TABLA).limit(1);
  if (error) return { fila: null, persistible: false };
  const filas = soloDe(clienteId, TABLA, data as Record<string, unknown>[] | null);
  return { fila: filas[0] ?? null, persistible: true };
}

async function guardar(clienteId: string, contexto: ContextoComercial, id?: string): Promise<boolean> {
  const fila = { documento: contexto as unknown as Record<string, unknown>, actualizado_en: new Date().toISOString() };
  const r = id ? await modificarEn(clienteId, TABLA, id, fila) : await insertarEn(clienteId, TABLA, fila);
  return !r.error;
}

/**
 * El contexto del negocio, listo para usar.
 *
 * `refrescar` fuerza la reconstrucción. Se usa cuando la persona cambió su
 * conocimiento y quiere que el Estudio lo note, y desde «contexto usado».
 */
export async function contextoComercial(
  clienteId: string,
  opciones: { demo?: boolean; refrescar?: boolean } = {},
): Promise<ContextoGuardado> {
  if (opciones.demo) {
    return { contexto: contextoComercialDemo(), actualizadoEn: null, editado: false, persistible: false };
  }
  exigirId(clienteId);

  if (opciones.refrescar) EN_MEMORIA.delete(clienteId);
  const memo = EN_MEMORIA.get(clienteId);
  if (memo && memo.hasta > Date.now()) {
    return { contexto: memo.contexto, actualizadoEn: null, editado: false, persistible: false };
  }

  const { fila, persistible } = await leerGuardado(clienteId);
  const editado = Boolean(fila?.editado);

  // Una corrección humana no se pisa nunca con una reconstrucción automática.
  if (fila?.documento && (!opciones.refrescar || editado)) {
    return {
      contexto: fila.documento as unknown as ContextoComercial,
      actualizadoEn: (fila.actualizado_en as string) ?? null,
      editado,
      persistible,
    };
  }

  const contexto = await construirContexto(clienteId);
  if (persistible) await guardar(clienteId, contexto, fila?.id as string | undefined);
  // Un contexto que no se pudo construir NO se cachea: sería fijar el error.
  if (contexto.vende.length) EN_MEMORIA.set(clienteId, { contexto, hasta: Date.now() + VIDA_MS });
  return { contexto, actualizadoEn: new Date().toISOString(), editado: false, persistible };
}

/** Guarda la corrección que escribió la persona. Queda marcada como suya. */
export async function corregirContexto(
  clienteId: string,
  contexto: ContextoComercial,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  exigirId(clienteId);
  // Una corrección manual invalida la memoria: si no, la persona corrige y el
  // siguiente anuncio sigue usando lo viejo durante diez minutos.
  EN_MEMORIA.delete(clienteId);
  const { fila, persistible } = await leerGuardado(clienteId);
  if (!persistible) return { ok: false, motivo: "Falta aplicar la migración 310 para guardar el contexto." };
  const cuerpo = {
    documento: contexto as unknown as Record<string, unknown>,
    editado: true,
    actualizado_en: new Date().toISOString(),
  };
  const r = fila?.id
    ? await modificarEn(clienteId, TABLA, fila.id as string, cuerpo)
    : await insertarEn(clienteId, TABLA, cuerpo);
  return r.error ? { ok: false, motivo: "No se pudo guardar el contexto." } : { ok: true };
}

export { contextoComercialEnTexto };
