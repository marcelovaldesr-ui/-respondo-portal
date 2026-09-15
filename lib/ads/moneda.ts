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
  /**
   * ⚠️ Sin moneda conocida NO se escribe el símbolo.
   *
   * Antes esto decía `String(m.moneda || "CLP")`: un monto sin moneda salía a
   * pantalla como «$50» y se leía como cincuenta pesos, cuando lo único que
   * sabíamos era «50 de algo». Ahora sale el número pelado, que es exactamente
   * lo que sabemos, y quien tenga espacio agrega «moneda sin confirmar».
   */
  if (!monedaConocida(m.moneda)) {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(m.valor);
  }
  const moneda = String(m.moneda).toUpperCase();
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

/* ── Moneda desconocida ──────────────────────────────────────────────────────
   ═══════════════════════════════════════════════════════════════════════════
   LA REGLA QUE FALTABA: DINERO SIN MONEDA CONOCIDA NO ES DINERO COMPARABLE.

   El archivo abrió diciendo «ningún monto viaja sin su moneda», y aun así por
   debajo había tres `?? "CLP"` —en el parseo de Google, en la lista de cuentas
   y en el panorama del negocio—. Ese fallback no es defensivo: **inventa un
   dato**. Si la API no devolvió `customer.currency_code`, lo que sabemos es que
   NO sabemos la moneda; escribir «CLP» convierte un hueco en una afirmación, y
   una cuenta en dólares se muestra como si gastara pesos.

   Preferimos «no disponible» a una cifra falsa. Un monto sin moneda conocida:
     · no se suma con nada,
     · no se compara con nada,
     · y se escribe SIN símbolo, para que nadie lo lea como pesos.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Lo que devuelve una fuente que no declaró su moneda. Nunca es una moneda. */
export const MONEDA_DESCONOCIDA = "";

export function monedaConocida(m: Moneda | null | undefined): boolean {
  return typeof m === "string" && /^[A-Za-z]{3}$/.test(m.trim());
}

/**
 * Normaliza lo que venga de una API. Lo que no es un código ISO de tres letras
 * queda como DESCONOCIDA — incluido `null`, `undefined` y la cadena vacía.
 */
export function normalizarMoneda(m: unknown): Moneda {
  const s = String(m ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : MONEDA_DESCONOCIDA;
}

/** ¿Este monto se puede comparar o sumar con otro? */
export function montoComparable(m: Monto | null | undefined): boolean {
  return Boolean(m) && Number.isFinite(m!.valor) && monedaConocida(m!.moneda);
}

/** ¿Estos dos montos se pueden comparar entre sí? */
export function mismasMonedas(a: Monto | null | undefined, b: Monto | null | undefined): boolean {
  return montoComparable(a) && montoComparable(b) && a!.moneda.toUpperCase() === b!.moneda.toUpperCase();
}

/**
 * Agrupa cualquier cosa que tenga un monto, por moneda.
 *
 * Es la herramienta para no volver a sumar escalares de monedas distintas: se
 * agrupa primero y se analiza cada grupo por separado. Las filas cuyo monto no
 * tiene moneda conocida caen en el grupo DESCONOCIDA, que nunca se suma con
 * ningún otro.
 */
export function agruparPorMoneda<T>(items: T[], montoDe: (x: T) => Monto | null | undefined): Map<Moneda, T[]> {
  const grupos = new Map<Moneda, T[]>();
  for (const x of items) {
    const m = montoDe(x);
    const clave = monedaConocida(m?.moneda) ? m!.moneda.toUpperCase() : MONEDA_DESCONOCIDA;
    const lista = grupos.get(clave);
    if (lista) lista.push(x);
    else grupos.set(clave, [x]);
  }
  return grupos;
}

/** El total por moneda. Nunca un total único cuando hay varias. */
export function sumarPorMoneda(montos: (Monto | null | undefined)[]): Map<Moneda, Monto> {
  const grupos = agruparPorMoneda(montos.filter(montoComparable) as Monto[], (m) => m);
  const out = new Map<Moneda, Monto>();
  for (const [moneda, lista] of grupos) {
    if (!monedaConocida(moneda)) continue;
    out.set(moneda, { moneda, valor: lista.reduce((s, m) => s + m.valor, 0) });
  }
  return out;
}

/** El nombre de una moneda para un texto corriente. */
export function nombreDeMoneda(m: Moneda): string {
  return monedaConocida(m) ? m.toUpperCase() : "moneda sin confirmar";
}
