/**
 * PERÍODOS — una sola forma de contar el tiempo en Pauta.
 *
 * POR QUÉ IMPORTA MÁS DE LO QUE PARECE
 * Un informe de publicidad es una resta entre dos fechas, y ahí se esconden los
 * errores que hacen desconfiar de un panel entero:
 *
 *  · **La zona horaria.** El servidor corre en UTC. Sin fijar Chile, «hoy»
 *    empieza a las 21:00 del día anterior y las cifras de la mañana aparecen
 *    en el día equivocado. (Misma herida que ya arregló lib/fechas.ts para el
 *    resto del portal.)
 *  · **El rango inclusivo.** «Últimos 7 días» son 7 días completos, no 6 y
 *    fracción. Acá el rango es [desde 00:00, hasta 23:59:59] en hora de Chile.
 *  · **El período anterior.** Comparar 30 días contra «el mes pasado» compara
 *    media cancha con una entera. El anterior SIEMPRE tiene el mismo largo y
 *    termina justo antes de que empiece el actual.
 *  · **El horario de verano.** Chile cambia de hora. Por eso se arma con
 *    `Intl` y nombres de zona, nunca con un desfase fijo de -3 o -4.
 *
 * Todo esto es puro y se prueba sin base de datos, que es donde estos errores
 * se cazan.
 *
 * ⚠️ La zona se declara acá y no se importa de `lib/fechas.ts` A PROPÓSITO: este
 * archivo NO puede tener imports con alias `@/`, porque los tests corren con
 * Node pelado y ahí el alias no existe. Es la misma razón por la que los
 * archivos `*Core.ts` del portal no importan nada. Si algún día cambia la zona
 * del producto, hay que cambiarla en los dos lugares — el costo de esa
 * duplicación es mucho menor que el de una capa de fechas sin pruebas.
 */
const ZONA = "America/Santiago";

export type ClaveRango =
  | "hoy"
  | "ayer"
  | "7d"
  | "14d"
  | "30d"
  | "mes"
  | "mes_anterior"
  | "personalizado";

export type Rango = {
  clave: ClaveRango;
  /** AAAA-MM-DD en hora de Chile, inclusive. */
  desde: string;
  hasta: string;
  /** Cómo se le dice a esto en la pantalla. */
  etiqueta: string;
  /** Días que cubre, inclusive. Sirve para armar el período anterior. */
  dias: number;
};

export const RANGOS: { clave: ClaveRango; etiqueta: string }[] = [
  { clave: "hoy", etiqueta: "Hoy" },
  { clave: "ayer", etiqueta: "Ayer" },
  { clave: "7d", etiqueta: "7 días" },
  { clave: "14d", etiqueta: "14 días" },
  { clave: "30d", etiqueta: "30 días" },
  { clave: "mes", etiqueta: "Este mes" },
  { clave: "mes_anterior", etiqueta: "Mes anterior" },
];

/** AAAA-MM-DD de una fecha, en hora de Chile. */
export function diaChile(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Suma días a un AAAA-MM-DD sin pasar por husos horarios. */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  // Mediodía UTC: lejos de cualquier borde de día, así sumar y restar días
  // nunca cae en el cambio de hora.
  const base = new Date(Date.UTC(a, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
}

/** Cuántos días hay entre dos AAAA-MM-DD, inclusive. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function primerDiaDelMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

function ultimoDiaDelMes(dia: string): string {
  const [a, m] = dia.split("-").map(Number);
  // Día 0 del mes siguiente = último día de este mes.
  return new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
}

/** ¿Es un AAAA-MM-DD real? Rechaza «2026-13-40» y basura de la URL. */
export function esDiaValido(v: unknown): v is string {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Arma el rango. `ahora` se inyecta para poder probarlo sin depender del reloj.
 *
 * Un rango personalizado inválido —fechas al revés, texto, un rango de tres
 * años— NO revienta ni se corrige en silencio: cae a los últimos 30 días, que
 * es lo que la persona esperaba ver de todas formas.
 */
export function resolverRango(
  clave: string | undefined,
  personalizado?: { desde?: string; hasta?: string },
  ahora = new Date(),
): Rango {
  const hoy = diaChile(ahora);
  const arma = (c: ClaveRango, desde: string, hasta: string, etiqueta: string): Rango => ({
    clave: c,
    desde,
    hasta,
    etiqueta,
    dias: diasEntre(desde, hasta),
  });

  switch (clave) {
    case "hoy":
      return arma("hoy", hoy, hoy, "Hoy");
    case "ayer": {
      const a = sumarDias(hoy, -1);
      return arma("ayer", a, a, "Ayer");
    }
    case "7d":
      return arma("7d", sumarDias(hoy, -6), hoy, "Últimos 7 días");
    case "14d":
      return arma("14d", sumarDias(hoy, -13), hoy, "Últimos 14 días");
    case "mes":
      return arma("mes", primerDiaDelMes(hoy), hoy, "Este mes");
    case "mes_anterior": {
      const finAnterior = sumarDias(primerDiaDelMes(hoy), -1);
      return arma(
        "mes_anterior",
        primerDiaDelMes(finAnterior),
        ultimoDiaDelMes(finAnterior),
        "Mes anterior",
      );
    }
    case "personalizado": {
      const d = personalizado?.desde;
      const h = personalizado?.hasta;
      if (esDiaValido(d) && esDiaValido(h) && d <= h && diasEntre(d, h) <= 400) {
        return arma("personalizado", d, h, `${d} al ${h}`);
      }
      // Fechas imposibles: se cae al default sin avisar con un error rojo. La
      // persona venía a mirar cifras, no a que le corrijan la URL.
      return arma("30d", sumarDias(hoy, -29), hoy, "Últimos 30 días");
    }
    default:
      return arma("30d", sumarDias(hoy, -29), hoy, "Últimos 30 días");
  }
}

/**
 * El período anterior con el MISMO largo, terminando justo antes del actual.
 *
 * Para «mes anterior» no se devuelve nada: comparar el mes pasado contra el
 * antepasado es una pregunta distinta, y ofrecerla acá confundiría la lectura.
 */
export function periodoAnterior(r: Rango): { desde: string; hasta: string } | null {
  if (r.clave === "mes_anterior") return null;
  const hasta = sumarDias(r.desde, -1);
  const desde = sumarDias(hasta, -(r.dias - 1));
  return { desde, hasta };
}

/**
 * Los bordes del rango en ISO/UTC, para consultar la base.
 *
 * ⚠️ El offset se calcula CON `Intl` sobre la fecha real, no con un -3/-4
 * fijo: en septiembre Chile cambia de hora y un desfase escrito a mano deja
 * las cifras del día del cambio corridas una hora.
 */
export function bordesUTC(r: { desde: string; hasta: string }): { desdeISO: string; hastaISO: string } {
  return {
    desdeISO: instanteChile(r.desde, "00:00:00"),
    hastaISO: instanteChile(r.hasta, "23:59:59"),
  };
}

/**
 * Cuánto se corre Chile respecto de UTC en un instante dado (en ms, negativo).
 * Se saca de `Intl` sobre la fecha real, así el cambio de hora lo resuelve el
 * sistema y no una constante escrita a mano.
 */
function offsetDeChile(instante: Date): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const comoSiFueraUTC = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    // Algunos motores devuelven "24" para la medianoche.
    Number(partes.hour) % 24,
    Number(partes.minute),
    Number(partes.second),
  );
  return comoSiFueraUTC - instante.getTime();
}

/**
 * Convierte «AAAA-MM-DD» + hora de pared chilena a un instante ISO en UTC.
 *
 * Dos pasadas a propósito: la primera estima el desfase con la fecha leída como
 * si fuera UTC, la segunda lo corrige con el instante ya aproximado. Es lo que
 * hace que el día del cambio de hora no quede corrido — con una sola pasada,
 * las cifras de ese domingo aparecen una hora fuera de lugar y nadie entiende
 * por qué.
 */
export function instanteChile(dia: string, hora: string): string {
  const tentativa = Date.parse(`${dia}T${hora}Z`);
  if (!Number.isFinite(tentativa)) return new Date().toISOString();
  const primera = offsetDeChile(new Date(tentativa));
  const segunda = offsetDeChile(new Date(tentativa - primera));
  return new Date(tentativa - segunda).toISOString();
}

/** «12 sep» / «12 sep 2025» si es de otro año. */
export function diaLegible(dia: string, hoy = diaChile(new Date())): string {
  const d = new Date(`${dia}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dia;
  const mismoAnio = dia.slice(0, 4) === hoy.slice(0, 4);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(mismoAnio ? {} : { year: "numeric" }),
  }).format(d);
}

/** «12 sep al 18 sep» — cómo se nombra un rango en la pantalla. */
export function rangoLegible(r: { desde: string; hasta: string }): string {
  if (r.desde === r.hasta) return diaLegible(r.desde);
  return `${diaLegible(r.desde)} al ${diaLegible(r.hasta)}`;
}
