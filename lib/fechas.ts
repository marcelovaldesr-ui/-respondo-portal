/**
 * Formateo de fechas del portal.
 *
 * POR QUÉ ESTE ARCHIVO: las páginas se renderizan en el servidor, y en Vercel
 * el servidor corre en UTC. Sin fijar la zona horaria, un mensaje de las 14:54
 * en Chile se le muestra al cliente como 17:54 o 18:54. El dueño mira su propio
 * WhatsApp, ve otra hora, y deja de confiar en el panel entero.
 *
 * Chile cambia de horario (verano/invierno), así que se usa el nombre de zona
 * IANA y no un desfase fijo: Intl resuelve el cambio solo.
 */
export const ZONA = "America/Santiago";
export const LOCALE = "es-CL";

/** Año-mes-día en Chile, para comparar si dos fechas son "el mismo día". */
function diaEnChile(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "14:54" si es hoy, "18 jul" si no. */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  const esHoy = diaEnChile(d) === diaEnChile(new Date());
  return esHoy
    ? new Intl.DateTimeFormat(LOCALE, {
        timeZone: ZONA,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d)
    : new Intl.DateTimeFormat(LOCALE, {
        timeZone: ZONA,
        day: "2-digit",
        month: "short",
      }).format(d);
}

/** "18 jul, 14:54" — para el detalle de una conversación. */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Primer instante del mes en curso, según el calendario chileno.
 * Con UTC, entre las 21:00 y medianoche del último día del mes, Chile todavía
 * está en el mes anterior pero UTC ya cambió: las métricas del mes se cortarían
 * unas horas antes de tiempo.
 */
export function inicioDeMesChile(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [anio, mes] = partes.split("-");
  // Chile está entre UTC-3 y UTC-4, así que el inicio del mes local siempre cae
  // dentro del último día del mes anterior en UTC. Se toma un margen seguro.
  return new Date(`${anio}-${mes}-01T00:00:00-04:00`).toISOString();
}

/** "julio 2026" a partir de un periodo tipo "2026-07-01". */
export function nombreMes(periodo: string): string {
  const [a, m] = periodo.split("-");
  const meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${meses[Number(m) - 1] ?? ""} ${a}`;
}
