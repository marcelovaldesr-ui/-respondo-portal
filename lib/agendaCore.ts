/**
 * NÚCLEO PURO del módulo de agenda (F0) — SIN dependencias externas.
 *
 * Aquí vive todo el cálculo de disponibilidad: expandir el horario semanal a
 * fechas concretas, restar bloqueos y citas, aplicar anticipación mínima y
 * cortar en cupos del largo del servicio. Al no tocar base de datos, se puede
 * testear completo sin Supabase (scripts/_test_agenda.ts corre sin .env).
 *
 * REGLA DE ORO DE FECHAS (lección ya pagada en el portal, ver lib/fechas.ts):
 * el horario del negocio está en HORA DE PARED DE CHILE ("10:00" del lunes).
 * La conversión a instantes UTC se hace POR FECHA CONCRETA vía Intl con la
 * zona IANA America/Santiago — así el cambio de hora de septiembre y abril
 * queda resuelto por el sistema, no por un desfase fijo escrito a mano.
 *
 * Este archivo es NUEVO y nada del código existente lo importa todavía:
 * no afecta en nada el funcionamiento actual de Tino.
 */

export const ZONA_AGENDA = "America/Santiago";

/** Ventana del horario semanal: diaSemana 0=domingo … 6=sábado, horas "HH:MM". */
export type VentanaSemanal = {
  profesionalId: string;
  diaSemana: number;
  desde: string; // "10:00" hora de Chile
  hasta: string; // "19:00" hora de Chile
};

/** Intervalo ocupado (bloqueo o cita activa), en ISO UTC. */
export type Ocupado = {
  profesionalId: string | null; // null = aplica a todos (bloqueo del negocio)
  desde: string;
  hasta: string;
};

/** Cupo ofrecible. */
export type Slot = {
  inicio: string; // ISO UTC
  fin: string;    // ISO UTC
  profesionalId: string;
};

// ---------------------------------------------------------------------------
// Zona horaria
// ---------------------------------------------------------------------------

const DTF_PARTES = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_AGENDA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Desfase de Chile respecto de UTC (en ms) para un instante dado. */
export function offsetChileMs(instante: Date): number {
  const p: Record<string, string> = {};
  for (const parte of DTF_PARTES.formatToParts(instante)) p[parte.type] = parte.value;
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24, // Intl puede emitir "24" a medianoche
    Number(p.minute),
    Number(p.second),
  );
  return comoUtc - instante.getTime();
}

/**
 * Instante UTC que corresponde a una hora de pared en Chile.
 * Dos iteraciones convergen incluso en fechas pegadas al cambio de hora.
 */
export function horaChileAUtc(
  anio: number,
  mes: number, // 1-12
  dia: number,
  hh: number,
  mm: number,
): Date {
  const pared = Date.UTC(anio, mes - 1, dia, hh, mm);
  let utc = pared;
  for (let i = 0; i < 2; i++) {
    utc = pared - offsetChileMs(new Date(utc));
  }
  return new Date(utc);
}

/** Año/mes/día/día-de-semana del calendario chileno para un instante. */
export function fechaChileDe(instante: Date): {
  anio: number;
  mes: number;
  dia: number;
  diaSemana: number; // 0=domingo … 6=sábado
} {
  const p: Record<string, string> = {};
  for (const parte of DTF_PARTES.formatToParts(instante)) p[parte.type] = parte.value;
  const dtfDia = new Intl.DateTimeFormat("en-US", { timeZone: ZONA_AGENDA, weekday: "short" });
  const nombre = dtfDia.format(instante);
  const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    diaSemana: DIAS[nombre] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Cálculo de disponibilidad
// ---------------------------------------------------------------------------

function parseHHMM(s: string): { hh: number; mm: number } {
  const [hh, mm] = s.split(":").map(Number);
  return { hh: hh || 0, mm: mm || 0 };
}

/** ¿Se solapan [aIni, aFin) y [bIni, bFin)? */
export function solapan(aIni: number, aFin: number, bIni: number, bFin: number): boolean {
  return aIni < bFin && bIni < aFin;
}

export type ParamsSlots = {
  /** "Ahora" del cálculo (inyectable para tests). */
  ahora: Date;
  /** Cuántos días de calendario chileno mirar hacia adelante (horizonte). */
  dias: number;
  /** Horario semanal de los profesionales candidatos. */
  ventanas: VentanaSemanal[];
  /** Bloqueos + citas activas ya tomadas. */
  ocupados: Ocupado[];
  /** Duración del servicio en minutos (largo de cada cupo). */
  duracionMin: number;
  /** Paso entre inicios de cupo; por defecto, la duración del servicio. */
  pasoMin?: number;
  /** No ofrecer cupos que empiecen antes de ahora + esta anticipación. */
  anticipacionMin: number;
  /** Tope de cupos a devolver (los más próximos). */
  maxSlots?: number;
};

/**
 * Genera los cupos disponibles. Determinista: mismos parámetros, mismos slots.
 */
export function computarSlots(params: ParamsSlots): Slot[] {
  const {
    ahora,
    dias,
    ventanas,
    ocupados,
    duracionMin,
    anticipacionMin,
  } = params;
  const paso = (params.pasoMin ?? duracionMin) * 60_000;
  const dur = duracionMin * 60_000;
  const desdeMs = ahora.getTime() + anticipacionMin * 60_000;
  const max = params.maxSlots ?? 60;

  // Ocupados pre-parseados una sola vez.
  const ocupadosMs = ocupados.map((o) => ({
    profesionalId: o.profesionalId,
    ini: Date.parse(o.desde),
    fin: Date.parse(o.hasta),
  }));

  const slots: Slot[] = [];

  // Mediodía de HOY en Chile como ancla: sumar días de a 24h desde un mediodía
  // nunca cruza mal un cambio de hora (el DST mueve la medianoche, no el
  // mediodía). Para cada día se rederiva la fecha chilena real vía Intl.
  const hoy = fechaChileDe(ahora);
  const anclaMediodia = horaChileAUtc(hoy.anio, hoy.mes, hoy.dia, 12, 0).getTime();

  for (let i = 0; i < dias; i++) {
    const fecha = fechaChileDe(new Date(anclaMediodia + i * 86_400_000));

    for (const v of ventanas) {
      if (v.diaSemana !== fecha.diaSemana) continue;
      const d = parseHHMM(v.desde);
      const h = parseHHMM(v.hasta);
      const iniVentana = horaChileAUtc(fecha.anio, fecha.mes, fecha.dia, d.hh, d.mm).getTime();
      const finVentana = horaChileAUtc(fecha.anio, fecha.mes, fecha.dia, h.hh, h.mm).getTime();

      for (let t = iniVentana; t + dur <= finVentana; t += paso) {
        if (t < desdeMs) continue;
        const tFin = t + dur;
        const choca = ocupadosMs.some(
          (o) =>
            (o.profesionalId === null || o.profesionalId === v.profesionalId) &&
            solapan(t, tFin, o.ini, o.fin),
        );
        if (choca) continue;
        slots.push({
          inicio: new Date(t).toISOString(),
          fin: new Date(tFin).toISOString(),
          profesionalId: v.profesionalId,
        });
      }
    }
  }

  // Orden cronológico y, a igual hora, estable por profesional.
  slots.sort((a, b) =>
    a.inicio === b.inicio
      ? a.profesionalId.localeCompare(b.profesionalId)
      : a.inicio.localeCompare(b.inicio),
  );
  return slots.slice(0, max);
}

/**
 * Reduce una lista de slots a los que se le MUESTRAN al empleado IA en el
 * prompt: pocos, próximos y repartidos en días distintos (máx `porDia` por
 * día chileno, hasta `total`). Evita un bloque de prompt gigante y le da al
 * cliente opciones reales de días.
 */
export function slotsParaPrompt(slots: Slot[], total = 8, porDia = 3): Slot[] {
  const porFecha = new Map<string, number>();
  const out: Slot[] = [];
  for (const s of slots) {
    if (out.length >= total) break;
    const f = fechaChileDe(new Date(s.inicio));
    const clave = `${f.anio}-${f.mes}-${f.dia}`;
    const usados = porFecha.get(clave) ?? 0;
    if (usados >= porDia) continue;
    porFecha.set(clave, usados + 1);
    out.push(s);
  }
  return out;
}

/** "lun 3 ago, 15:00" — para mostrar un slot en texto (hora de Chile). */
export function formatearSlot(iso: string): string {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  const hora = new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${dia}, ${hora}`;
}
