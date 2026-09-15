import type { FilaRendimiento, TipoResultado } from "@/lib/ads/canal";

/**
 * DE QUÉ ESTÁN HECHAS LAS CONVERSIONES DE GOOGLE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL PROBLEMA
 *
 * `metrics.conversions` es UN número que agrupa acciones que no son la misma
 * cosa: una compra de $180.000, un formulario enviado, una llamada desde el
 * anuncio y un clic al botón de WhatsApp cuentan todas «1». El proveedor
 * escribía `tipo: "conversiones_web"` a ciegas para todas, y desde ahí el
 * producto entero —las tarjetas, el copiloto, `sonComparables`— trataba como
 * equivalentes una venta y un clic.
 *
 * Es el mismo error que este archivo hermano ya evita con `all_conversions`,
 * un nivel más adentro: no basta con elegir la métrica dura, hay que saber qué
 * hay dentro de ella.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ POR QUÉ ESTO NO SE ARREGLA AGREGANDO UN SEGMENTO A LA CONSULTA
 *
 * Lo obvio sería agregar `segments.conversion_action_category` a la consulta de
 * campañas que ya existe. Sería un error caro: la documentación de Google es
 * explícita en que cada segmento que se agrega multiplica las filas —«the
 * number of rows can increase exponentially»— y una campaña con cuatro tipos de
 * conversión pasaría a devolver cuatro filas. Nuestro agrupador las sumaría y
 * el GASTO quedaría multiplicado por cuatro.
 *
 * Y hay algo más fuerte que un riesgo, verificado en la referencia de campos de
 * v25: la lista «Selectable with» de `segments.conversion_action_category`
 * contiene SOLO métricas de conversión —`metrics.conversions`,
 * `metrics.conversions_value`, `metrics.all_conversions`, `metrics.orders`,
 * `metrics.revenue_micros`…— y NO contiene `metrics.cost_micros`,
 * `metrics.impressions` ni `metrics.clicks`. O sea: agregar el segmento a la
 * consulta principal no habría dado un gasto inflado, habría dado una consulta
 * RECHAZADA, y el panel se habría quedado sin campañas.
 *
 * Por eso la composición se pide en una consulta SEPARADA que trae únicamente
 * identificadores y `metrics.conversions` —jamás costo, impresiones ni clics— y
 * se fusiona en memoria. Las métricas de entrega no pueden duplicarse porque no
 * viajan en esa consulta, y la consulta principal no puede romperse porque no
 * lleva el segmento.
 *
 * Verificado el 15-09-2026 contra la referencia de campos de v25
 * (developers.google.com/google-ads/api/fields/v25/segments). Las categorías de
 * `CATEGORIA`, más abajo, son el enum ConversionActionCategory de esa misma
 * página, copiado completo: 24 valores.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Una campaña y de qué acciones vinieron sus conversiones. */
export type ComposicionCampana = {
  campanaId: string;
  /** Cuántas conversiones aportó cada categoría de Google. */
  porCategoria: Map<string, number>;
};

/**
 * Categoría de Google → nuestro tipo de resultado.
 *
 * ⚠️ Lo que NO está en esta tabla cae en `desconocido`, y eso es deliberado:
 * `desconocido` no se compara ni se suma con nada (`sonComparables`), así que
 * una categoría nueva de Google se vuelve visible como «no sabemos qué es» en
 * vez de colarse silenciosamente como «conversión web». Prefiero que el
 * producto diga que no entendió una categoría a que la clasifique mal.
 */
const CATEGORIA: Record<string, TipoResultado> = {
  PURCHASE: "compras",
  STORE_SALE: "compras",
  ADD_TO_CART: "conversiones_web",
  BEGIN_CHECKOUT: "conversiones_web",
  SUBMIT_LEAD_FORM: "leads",
  REQUEST_QUOTE: "leads",
  QUALIFIED_LEAD: "leads",
  CONVERTED_LEAD: "leads",
  BOOK_APPOINTMENT: "leads",
  SIGNUP: "leads",
  CONTACT: "leads",
  PHONE_CALL_LEAD: "llamadas",
  SUBSCRIBE_PAID: "compras",
  IMPORTED_LEAD: "leads",
  DOWNLOAD: "conversiones_web",
  DEFAULT: "conversiones_web",
  PAGE_VIEW: "desconocido",
  OUTBOUND_CLICK: "desconocido",
  ENGAGEMENT: "desconocido",
  GET_DIRECTIONS: "desconocido",
  STORE_VISIT: "desconocido",
  YOUTUBE_FOLLOW_ON_VIEWS: "desconocido",
  UNSPECIFIED: "desconocido",
  UNKNOWN: "desconocido",
};

/**
 * Categorías BLANDAS: acciones que Google cuenta como conversión y que casi
 * nunca son un cliente. Son las primas hermanas de lo que hace insalvable a
 * `all_conversions` —vistas de página, «cómo llegar», clics de salida— y por eso
 * se nombran aparte: cuando pesan, el producto tiene que decirlo.
 */
export const CATEGORIAS_BLANDAS = new Set([
  "PAGE_VIEW",
  "OUTBOUND_CLICK",
  "ENGAGEMENT",
  "GET_DIRECTIONS",
  "STORE_VISIT",
  "YOUTUBE_FOLLOW_ON_VIEWS",
]);

export function tipoDeCategoria(categoria: unknown): TipoResultado {
  return CATEGORIA[String(categoria ?? "").toUpperCase()] ?? "desconocido";
}

export type LecturaComposicion = {
  /** El tipo que mejor describe estas conversiones. */
  tipo: TipoResultado;
  /** Qué parte del total aporta la categoría dominante, de 0 a 1. */
  parteDominante: number;
  /** Texto corto con el desglose, para la evidencia. */
  desglose: string;
  /** Parte del total que viene de acciones blandas. */
  parteBlanda: number;
};

/**
 * Qué son, en una palabra, las conversiones de esta campaña.
 *
 * Regla: si una categoría explica al menos el 80% de las conversiones, ese es
 * el tipo —una campaña con 97 compras y 3 llamadas mide compras—. Si no, es una
 * MEZCLA, y una mezcla no se compara con nada: es exactamente la situación en
 * que promediar un costo por resultado inventa una cifra.
 */
export const DOMINANCIA = 0.8;

export function leerComposicion(porCategoria: Map<string, number>): LecturaComposicion | null {
  const entradas = [...porCategoria.entries()].filter(([, n]) => n > 0);
  const total = entradas.reduce((a, [, n]) => a + n, 0);
  if (!entradas.length || total <= 0) return null;

  const ordenadas = [...entradas].sort((a, b) => b[1] - a[1]);
  const desglose = ordenadas.map(([c, n]) => `${c.toLowerCase()}: ${Math.round(n * 100) / 100}`).join(" · ");
  const parteBlanda = entradas.filter(([c]) => CATEGORIAS_BLANDAS.has(c.toUpperCase())).reduce((a, [, n]) => a + n, 0) / total;

  /**
   * La dominancia se mide sobre el TIPO, no sobre la categoría cruda: dos
   * categorías distintas de Google que para nosotros son «leads» (formulario y
   * solicitud de cotización) no hacen una mezcla, miden lo mismo.
   */
  const porTipo = new Map<TipoResultado, number>();
  for (const [c, n] of entradas) {
    const t = tipoDeCategoria(c);
    porTipo.set(t, (porTipo.get(t) ?? 0) + n);
  }
  const [tipoTop, cantidadTop] = [...porTipo.entries()].sort((a, b) => b[1] - a[1])[0];
  const parteDominante = cantidadTop / total;

  return {
    tipo: parteDominante >= DOMINANCIA ? tipoTop : "mezcla",
    parteDominante,
    desglose,
    parteBlanda,
  };
}

/**
 * Fusiona la composición con las filas de rendimiento.
 *
 * ⭐ LA GARANTÍA DE ESTA FUNCIÓN: no toca `gasto`, `impresiones` ni `clics`.
 * Solo refina el TIPO del resultado y anota el desglose. La cantidad de
 * conversiones tampoco se reemplaza: la buena es la de la consulta sin
 * segmentar, porque es la que Google entrega sin repartir.
 */
export function fusionarComposicion(
  filas: FilaRendimiento[],
  composicion: Map<string, ComposicionCampana>,
): FilaRendimiento[] {
  return filas.map((f) => {
    if (f.proveedor !== "google" || !f.resultados) return f;
    const clave = f.nivel === "campana" ? f.id : (f.campanaId ?? "");
    const c = composicion.get(clave);
    const lectura = c ? leerComposicion(c.porCategoria) : null;
    if (!lectura) return f;
    return {
      ...f,
      resultados: { cantidad: f.resultados.cantidad, tipo: lectura.tipo },
      extra: {
        ...(f.extra ?? {}),
        composicionConversiones: lectura.desglose,
        parteBlanda: Math.round(lectura.parteBlanda * 100),
      },
    };
  });
}

/**
 * La consulta de composición. Trae identificador, categoría y CONVERSIONES.
 * Nada más. Que no aparezca `cost_micros` acá no es un olvido: es la razón por
 * la que esta consulta existe en vez de un segmento en la consulta principal.
 */
export function gaqlComposicion(rango: { desde: string; hasta: string }): string {
  return `SELECT campaign.id, segments.conversion_action_category, metrics.conversions
          FROM campaign
          WHERE segments.date BETWEEN '${rango.desde}' AND '${rango.hasta}'`;
}

/** Arma la composición desde las filas crudas de esa consulta. */
export function composicionDesdeFilas(filas: Record<string, unknown>[]): Map<string, ComposicionCampana> {
  const out = new Map<string, ComposicionCampana>();
  for (const f of filas) {
    const camp = (f.campaign ?? {}) as Record<string, unknown>;
    const seg = (f.segments ?? {}) as Record<string, unknown>;
    const met = (f.metrics ?? {}) as Record<string, unknown>;
    const id = camp.id ? String(camp.id) : "";
    if (!id) continue;
    const categoria = String(seg.conversionActionCategory ?? "UNKNOWN").toUpperCase();
    const n = Number(met.conversions ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const previa = out.get(id) ?? { campanaId: id, porCategoria: new Map<string, number>() };
    previa.porCategoria.set(categoria, (previa.porCategoria.get(categoria) ?? 0) + n);
    out.set(id, previa);
  }
  return out;
}
