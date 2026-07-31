/**
 * GENERADOR DE CALENDARIO iCal (RFC 5545) — F5 sin OAuth.
 *
 * POR QUÉ EXISTE: el dueño quiere ver las horas de Respondo en su Google
 * Calendar del celular. La sincronización "oficial" (API de Google) exige
 * verificación de la app, que tarda días. Un feed iCal no exige NADA: el
 * dueño pega una URL en "Otros calendarios → Desde URL" y listo. Funciona
 * igual en Google Calendar, Apple Calendar y Outlook.
 *
 * LIMITACIÓN HONESTA (decírsela al cliente): Google refresca las
 * suscripciones por URL cada varias horas, no al instante. Para tiempo real
 * está la vía de cuenta de servicio (lib/googleCalendar.ts).
 *
 * Módulo PURO: no toca base de datos ni red, así que se testea completo.
 */

export type EventoIcal = {
  id: string;
  inicio: string; // ISO
  fin: string; // ISO
  titulo: string;
  descripcion?: string;
  /** cancelada/no_show se publican como CANCELLED para que desaparezcan. */
  cancelado?: boolean;
  actualizado?: string; // ISO
};

/** Escapa según RFC 5545: barra, coma, punto y coma y saltos de línea. */
export function escaparTexto(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** ISO → formato UTC de iCal: 20260803T140000Z */
export function fechaIcal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`fecha inválida: ${iso}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Plegado de líneas: iCal exige máximo 75 octetos por línea; las siguientes
 * van con un espacio al inicio. Sin esto, Google descarta el evento entero
 * cuando una descripción es larga.
 */
export function plegarLinea(linea: string): string {
  const bytes = Buffer.from(linea, "utf8");
  if (bytes.length <= 73) return linea;

  const partes: string[] = [];
  let inicio = 0;
  while (inicio < bytes.length) {
    const limite = partes.length === 0 ? 73 : 72;
    let corte = Math.min(inicio + limite, bytes.length);
    // No partir un carácter UTF-8 por la mitad: retroceder si el byte
    // siguiente es una continuación (10xxxxxx).
    while (corte < bytes.length && (bytes[corte] & 0xc0) === 0x80) corte--;
    partes.push(bytes.subarray(inicio, corte).toString("utf8"));
    inicio = corte;
  }
  return partes.map((p, i) => (i === 0 ? p : ` ${p}`)).join("\r\n");
}

/**
 * Arma el documento .ics completo.
 * `nombreCalendario` es lo que el dueño verá como nombre del calendario.
 */
export function construirIcal(params: {
  nombreCalendario: string;
  eventos: EventoIcal[];
  dominio?: string;
}): string {
  const dominio = params.dominio ?? "respondo.cl";
  const lineas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Respondo//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escaparTexto(params.nombreCalendario)}`,
    "X-WR-TIMEZONE:America/Santiago",
    // Sugerencia de refresco (Google la respeta parcialmente; no hace daño).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const ev of params.eventos) {
    lineas.push("BEGIN:VEVENT");
    lineas.push(`UID:${ev.id}@${dominio}`);
    lineas.push(`DTSTAMP:${fechaIcal(ev.actualizado ?? new Date().toISOString())}`);
    lineas.push(`DTSTART:${fechaIcal(ev.inicio)}`);
    lineas.push(`DTEND:${fechaIcal(ev.fin)}`);
    lineas.push(`SUMMARY:${escaparTexto(ev.titulo)}`);
    if (ev.descripcion) lineas.push(`DESCRIPTION:${escaparTexto(ev.descripcion)}`);
    lineas.push(`STATUS:${ev.cancelado ? "CANCELLED" : "CONFIRMED"}`);
    // El UID es estable (id de la cita), así que al reagendar el calendario
    // ACTUALIZA el evento en vez de duplicarlo. El DTSTAMP nuevo le dice que
    // la versión cambió.
    lineas.push("SEQUENCE:0");
    lineas.push("END:VEVENT");
  }

  lineas.push("END:VCALENDAR");
  return lineas.map(plegarLinea).join("\r\n") + "\r\n";
}
