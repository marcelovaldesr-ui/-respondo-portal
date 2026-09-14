import type { Monto } from "@/lib/ads/moneda";

/**
 * EL VOCABULARIO COMÚN DE LAS PLATAFORMAS PUBLICITARIAS.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE Y QUÉ **NO** HACE
 *
 * `lib/ads/proveedor.ts` ya definía un contrato con UNA plataforma (Meta) a
 * nivel de anuncio. Sirvió mientras hubo un solo proveedor y una sola pregunta
 * («¿cuánto costó este anuncio?»). Con Google entran tres cosas que ese
 * contrato no puede expresar:
 *
 *   1. **Jerarquías distintas.** Meta: campaña → conjunto → anuncio.
 *      Google: campaña → grupo → anuncio, y además palabras clave y términos
 *      de búsqueda, que en Meta no existen.
 *   2. **Resultados que no son la misma cosa.** «12 resultados» de una campaña
 *      de mensajes y «12 conversiones» de una campaña de Búsqueda no se suman
 *      ni se comparan: una cuenta conversaciones abiertas y la otra cuenta
 *      formularios enviados en un sitio web.
 *   3. **Métricas que existen en una y no en la otra.** Frecuencia y alcance
 *      son de Meta; concordancia y término de búsqueda son de Google.
 *
 * LA REGLA QUE SE SIGUIÓ: se normaliza SOLO lo que de verdad significa lo
 * mismo (gasto, impresiones, clics, y el esqueleto de la jerarquía). Todo lo
 * demás viaja identificado —con su `tipo` o dentro de `extra`— para que la
 * pantalla pueda mostrarlo sin mentir. **Forzar a que Google y Meta se vean
 * idénticos es la forma más rápida de publicar un número falso.**
 *
 * ⚠️ Y hasta ahí llega: no hay fábrica de proveedores con registro dinámico ni
 * una interfaz por cada verbo. Hay dos plataformas y un registro literal.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Este módulo es PURO (el único import es de tipos, que TypeScript borra), así
 * que se prueba con Node pelado. Es donde viven las definiciones de métrica,
 * que es exactamente lo que hay que poder probar sin red.
 */

/* ── Quién ────────────────────────────────────────────────────────────────── */

export type Proveedor = "meta" | "google";

export const PROVEEDORES: readonly Proveedor[] = ["meta", "google"] as const;

export const NOMBRE_PROVEEDOR: Record<Proveedor, string> = {
  meta: "Meta",
  google: "Google Ads",
};

export function esProveedor(v: unknown): v is Proveedor {
  return v === "meta" || v === "google";
}

/* ── Dónde, dentro de la plataforma ───────────────────────────────────────── */

/**
 * Los niveles que sabemos leer. `conjunto` y `grupo` son el MISMO escalón
 * conceptual con distinto nombre en cada plataforma, y se dejan separados a
 * propósito: quien administra Meta busca «conjunto de anuncios» y quien
 * administra Google busca «grupo de anuncios». Traducirlos a una palabra
 * inventada («segmento») obligaría a las dos personas a aprender nuestro
 * idioma para encontrar lo suyo.
 */
export type Nivel = "cuenta" | "campana" | "conjunto" | "grupo" | "anuncio" | "palabra" | "termino";

export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  cuenta: "Cuenta",
  campana: "Campaña",
  conjunto: "Conjunto de anuncios",
  grupo: "Grupo de anuncios",
  anuncio: "Anuncio",
  palabra: "Palabra clave",
  termino: "Término de búsqueda",
};

/** Qué niveles puede entregar cada plataforma. La UI no ofrece lo que no hay. */
export const NIVELES_DE: Record<Proveedor, readonly Nivel[]> = {
  meta: ["campana", "conjunto", "anuncio"],
  google: ["campana", "grupo", "anuncio", "palabra", "termino"],
};

/** Estado de una entidad en la plataforma, normalizado a tres palabras. */
export type EstadoEntidad = "activa" | "pausada" | "terminada" | "desconocido";

/* ── Qué cuenta como «resultado» ──────────────────────────────────────────── */

/**
 * ⭐⭐ EL TIPO DE RESULTADO ES PARTE DEL NÚMERO, NO UN ADORNO.
 *
 * Este es el punto donde un panel multicanal se vuelve mentiroso sin que nadie
 * lo note: se suman «resultados» de campañas que miden cosas distintas y sale
 * un total que no significa nada. Peor, se calcula un «costo por resultado»
 * promedio entre una campaña de mensajes a $700 y una de compras a $12.000, y
 * el promedio recomienda mover presupuesto hacia la más barata — que es la que
 * mide lo más fácil, no la que vende.
 *
 * Por eso el resultado SIEMPRE viaja con su tipo, y `sonComparables` es la
 * única puerta para compararlos. Cuando los tipos difieren, la respuesta
 * correcta del producto es mostrarlos por separado, no promediarlos.
 */
export type TipoResultado =
  /** Conversaciones de mensajería iniciadas (Meta CTWA, mensajes de Instagram). */
  | "mensajes"
  /** Formularios nativos de la plataforma (Meta Lead Ads). */
  | "leads"
  /** Conversiones del sitio web declaradas por la plataforma (pixel / etiqueta). */
  | "conversiones_web"
  /** Compras reportadas por la plataforma, con valor cuando lo hay. */
  | "compras"
  /** Llamadas telefónicas. */
  | "llamadas"
  /** La plataforma reporta un resultado que no supimos clasificar. */
  | "desconocido";

export const ETIQUETA_RESULTADO: Record<TipoResultado, string> = {
  mensajes: "Conversaciones iniciadas",
  leads: "Formularios",
  conversiones_web: "Conversiones del sitio",
  compras: "Compras",
  llamadas: "Llamadas",
  desconocido: "Resultados",
};

export type Resultado = {
  cantidad: number;
  tipo: TipoResultado;
};

/**
 * ¿Se pueden comparar (o sumar) estos dos resultados?
 *
 * Solo si son del mismo tipo Y ninguno es `desconocido`. Un `desconocido` no
 * se compara ni con otro `desconocido`: que no sepamos qué mide ninguno de los
 * dos no los hace equivalentes.
 */
export function sonComparables(a: Resultado | null | undefined, b: Resultado | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.tipo === "desconocido" || b.tipo === "desconocido") return false;
  return a.tipo === b.tipo;
}

/**
 * Suma resultados SOLO si todos miden lo mismo. Con tipos mezclados devuelve
 * null, igual que `sumar()` de moneda.ts hace con monedas distintas: preferimos
 * un «—» honesto a un total inventado.
 */
export function sumarResultados(rs: (Resultado | null | undefined)[]): Resultado | null {
  const validos = rs.filter((r): r is Resultado => Boolean(r) && r!.tipo !== "desconocido");
  if (!validos.length) return null;
  const tipo = validos[0].tipo;
  if (validos.some((r) => r.tipo !== tipo)) return null;
  return { tipo, cantidad: validos.reduce((a, r) => a + r.cantidad, 0) };
}

/* ── La fila normalizada ──────────────────────────────────────────────────── */

/**
 * UNA fila de rendimiento, en cualquier plataforma y en cualquier nivel.
 *
 * Los campos obligatorios son los tres que significan lo mismo en todas partes
 * —gasto, impresiones, clics—. Todo lo demás es opcional porque de verdad puede
 * no existir: una campaña de Performance Max no tiene frecuencia, un término de
 * búsqueda no tiene presupuesto.
 *
 * ⚠️ `null` y `undefined` NO son lo mismo acá y la diferencia importa:
 *   · `undefined` — esta plataforma/este nivel no tiene ese concepto.
 *   · `null`      — el concepto existe pero la plataforma no lo entregó.
 * La pantalla dice «—» en los dos casos, pero el motivo que muestra cambia.
 */
export type FilaRendimiento = {
  proveedor: Proveedor;
  nivel: Nivel;
  /** Identificador en la plataforma. Nunca se acepta desde el navegador. */
  id: string;
  nombre: string;

  campanaId?: string;
  campanaNombre?: string;
  /** Conjunto (Meta) o grupo (Google). */
  grupoId?: string;
  grupoNombre?: string;

  estado?: EstadoEntidad;
  /** Objetivo/tipo de campaña, ya legible. «Mensajes», «Búsqueda», «Máximo rendimiento». */
  objetivo?: string | null;
  presupuestoDiario?: Monto | null;

  impresiones: number;
  clics: number;
  gasto: Monto;

  /** Personas distintas alcanzadas. Meta sí, Google no lo entrega igual. */
  alcance?: number | null;
  /** Veces que en promedio vio el anuncio cada persona. Solo Meta. */
  frecuencia?: number | null;

  /** El resultado principal que declara la plataforma, CON su tipo. */
  resultados?: Resultado | null;
  /** Valor declarado de esas conversiones, cuando la plataforma lo entrega. */
  valorResultados?: Monto | null;

  /** AAAA-MM-DD cuando se pidió desglose diario. */
  dia?: string;

  /**
   * Lo específico de cada plataforma que NO se normaliza porque no tiene
   * equivalente: concordancia y término (Google), calidad, etc. Se muestra en
   * la pantalla del canal, nunca en la tabla comparada.
   */
  extra?: Record<string, string | number | null>;
};

/* ── Métricas derivadas, en un solo lugar ─────────────────────────────────── */

/**
 * Las derivadas NO se guardan en la fila: se calculan acá.
 *
 * Guardarlas sería tener dos verdades (el CTR de la plataforma y el nuestro)
 * que se separan en cuanto una de las dos partes se filtra o se agrega. Meta y
 * Google redondean distinto, así que el CTR «oficial» de cada una puede diferir
 * del nuestro en la segunda decimal: preferimos UNA definición nuestra,
 * aplicada igual a todos, y decirla en la ayuda.
 */
export function ctr(f: { impresiones: number; clics: number }): number | null {
  if (!f.impresiones) return null;
  return (f.clics / f.impresiones) * 100;
}

export function cpc(f: { clics: number; gasto: Monto }): Monto | null {
  if (!f.clics) return null;
  return { valor: f.gasto.valor / f.clics, moneda: f.gasto.moneda };
}

export function cpm(f: { impresiones: number; gasto: Monto }): Monto | null {
  if (!f.impresiones) return null;
  return { valor: (f.gasto.valor / f.impresiones) * 1000, moneda: f.gasto.moneda };
}

export function costoPorResultado(f: {
  gasto: Monto;
  resultados?: Resultado | null;
}): Monto | null {
  if (!f.resultados || f.resultados.cantidad <= 0) return null;
  return { valor: f.gasto.valor / f.resultados.cantidad, moneda: f.gasto.moneda };
}

/**
 * Retorno sobre la inversión publicitaria, con la MISMA regla de moneda que el
 * resto del producto: si el valor reportado y el gasto no están en la misma
 * moneda, no se divide. Un ROAS con monedas mezcladas no es impreciso, es
 * falso, y además siempre enorme —lo que lo vuelve peligrosamente creíble—.
 */
export function roas(f: { gasto: Monto; valorResultados?: Monto | null }): number | null {
  if (!f.valorResultados) return null;
  if (f.gasto.valor <= 0) return null;
  if (f.gasto.moneda.toUpperCase() !== f.valorResultados.moneda.toUpperCase()) return null;
  return f.valorResultados.valor / f.gasto.valor;
}

/* ── Agregación ───────────────────────────────────────────────────────────── */

/**
 * Suma un conjunto de filas en un total.
 *
 * Tres cuidados que ya costaron errores en este producto:
 *  · **Monedas.** Con monedas mezcladas el gasto vuelve `null`, no 0.
 *  · **Resultados.** Se suman solo si todos son del mismo tipo (ver arriba).
 *  · **Alcance.** NO se suma: una persona alcanzada por dos anuncios es una
 *    persona, y sumar da un número siempre inflado. Se devuelve el máximo
 *    observado, que es un piso honesto, y se rotula como tal en la UI.
 */
export function agregar(filas: FilaRendimiento[]): {
  impresiones: number;
  clics: number;
  gasto: Monto | null;
  alcanceMinimo: number | null;
  resultados: Resultado | null;
  valorResultados: Monto | null;
} {
  if (!filas.length) {
    return { impresiones: 0, clics: 0, gasto: null, alcanceMinimo: null, resultados: null, valorResultados: null };
  }
  const monedas = new Set(filas.map((f) => f.gasto.moneda.toUpperCase()));
  const moneda = [...monedas][0];
  const gasto: Monto | null =
    monedas.size === 1 ? { valor: filas.reduce((a, f) => a + f.gasto.valor, 0), moneda } : null;

  const monedasValor = new Set(
    filas.filter((f) => f.valorResultados).map((f) => f.valorResultados!.moneda.toUpperCase()),
  );
  const valorResultados: Monto | null =
    monedasValor.size === 1
      ? {
          valor: filas.reduce((a, f) => a + (f.valorResultados?.valor ?? 0), 0),
          moneda: [...monedasValor][0],
        }
      : null;

  const alcances = filas.map((f) => f.alcance).filter((a): a is number => typeof a === "number");

  return {
    impresiones: filas.reduce((a, f) => a + f.impresiones, 0),
    clics: filas.reduce((a, f) => a + f.clics, 0),
    gasto,
    alcanceMinimo: alcances.length ? Math.max(...alcances) : null,
    resultados: sumarResultados(filas.map((f) => f.resultados)),
    valorResultados,
  };
}
