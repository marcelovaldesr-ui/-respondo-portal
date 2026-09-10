/**
 * MONEDA — una sola forma de escribir plata en Pauta.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * En publicidad se mezclan dos monedas sin darse cuenta: la cuenta publicitaria
 * de Meta puede facturar en USD mientras el negocio cobra en CLP. Sumar las dos
 * da un número que parece correcto y no significa nada — y es el tipo de error
 * que nadie nota hasta que alguien toma una decisión de plata con él.
 *
 * Reglas, en orden de importancia:
 *  1. **Ningún monto viaja sin su moneda.** El tipo `Monto` obliga a llevarla.
 *  2. **Dos monedas distintas NO se suman.** `sumar()` devuelve null en vez de
 *     un total mentiroso, y la pantalla muestra las dos por separado.
 *  3. El formato lo decide la moneda, no el país del que mira: CLP no tiene
 *     decimales y usa punto de miles ($1.000), USD tiene dos ($1,000.00).
 */

/** Código ISO-4217. No se valida contra una lista: Meta puede usar cualquiera. */
export type Moneda = string;

export type Monto = { valor: number; moneda: Moneda };

/**
 * Monedas sin decimales. La lista corta cubre lo que un cliente chileno se
 * puede encontrar; para el resto se asume 2 decimales, que es lo habitual.
 */
const SIN_DECIMALES = new Set(["CLP", "JPY", "KRW", "PYG", "ISK", "VND", "COP"]);

export function decimalesDe(moneda: Moneda): number {
  return SIN_DECIMALES.has(String(moneda).toUpperCase()) ? 0 : 2;
}

/**
 * Escribe un monto. Siempre con su moneda al lado cuando NO es la del negocio,
 * para que nadie confunda 50 dólares con 50 pesos mirando el mismo símbolo.
 */
export function formatearMonto(
  m: Monto | null | undefined,
  opciones?: { monedaDelNegocio?: Moneda; sinSimbolo?: boolean },
): string {
  if (!m || !Number.isFinite(m.valor)) return "—";
  const moneda = String(m.moneda || "CLP").toUpperCase();
  const dec = decimalesDe(moneda);

  const numero = new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(m.valor);

  if (opciones?.sinSimbolo) return numero;

  /**
   * El código de moneda se agrega solo cuando NO es la del negocio. Poner
   * «CLP» en cada cifra de un portal chileno es ruido; omitirlo cuando la
   * cuenta factura en dólares es un error caro.
   */
  const propia = String(opciones?.monedaDelNegocio ?? "CLP").toUpperCase();
  return moneda === propia ? `$${numero}` : `${moneda} $${numero}`;
}

/** Suma montos. Devuelve null si hay más de una moneda: no se inventa un total. */
export function sumar(montos: (Monto | null | undefined)[]): Monto | null {
  const validos = montos.filter((m): m is Monto => Boolean(m) && Number.isFinite(m!.valor));
  if (!validos.length) return null;

  const monedas = new Set(validos.map((m) => String(m.moneda).toUpperCase()));
  if (monedas.size > 1) return null;

  return {
    moneda: [...monedas][0],
    valor: validos.reduce((s, m) => s + m.valor, 0),
  };
}

/**
 * Divide dos montos de la misma moneda (costo por algo).
 * Devuelve null cuando el divisor es 0 — un «costo por lead» sin leads no es
 * infinito, es una cifra que todavía no existe.
 */
export function dividir(total: Monto | null, cantidad: number): Monto | null {
  if (!total || !Number.isFinite(cantidad) || cantidad <= 0) return null;
  return { valor: total.valor / cantidad, moneda: total.moneda };
}

/** Un número entero legible (conversaciones, clics). No es plata. */
export function formatearNumero(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-CL").format(Math.round(n));
}

/** Un porcentaje con un decimal. `null` cuando no se puede calcular. */
export function formatearPorcentaje(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(p)}%`;
}
