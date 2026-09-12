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
  /**
   * Qué tipo de ocupación es. Importa para el tiempo de preparación:
   *
   *  - 'cita'    → hay que dejar el buffer del servicio antes y después (limpiar
   *                el box, guardar herramientas, dar la pasada al sillón).
   *  - 'bloqueo' → NO lleva buffer. Si el negocio bloquea 13:00-14:00 para
   *                almorzar, la primera hora de la tarde es a las 14:00, no a
   *                las 14:15. Aplicarle buffer le comería tiempo real de
   *                atención todos los días sin que nadie entienda por qué.
   *
   * Por defecto 'cita' (comportamiento conservador para quien no lo indique).
   */
  tipo?: "cita" | "bloqueo";
};

/** Cupo ofrecible, ya agrupado por instante (Fase 2). */
export type Slot = {
  inicio: string; // ISO UTC
  fin: string;    // ISO UTC
  /**
   * Profesional con el que se muestra el cupo. Es el PRIMERO de `profesionales`
   * (orden estable): se conserva para no romper a quien ya leía este campo.
   */
  profesionalId: string;
  /**
   * TODOS los profesionales libres a esa hora, en orden estable.
   *
   * ⚠️ POR QUÉ EXISTE (Fase 2, 12-sep-2026). Antes se devolvía un cupo POR
   * PROFESIONAL: con tres profesionales libres a las 15:00, la página pública
   * pintaba «15:00 15:00 15:00» sin decir en qué se diferencian. Ahora el cupo
   * es UNO y la lista dice quiénes pueden tomarlo; a quién se le asigna lo
   * decide el servidor al confirmar (ver `elegirProfesional`).
   */
  profesionales: string[];
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
  /**
   * Primer día chileno del cálculo. Por defecto, el día de `ahora`.
   * Permite pedir «el mes que viene» sin generar todo lo anterior.
   */
  desdeDia?: Date;
  /**
   * Tope de cupos a devolver (los más próximos). Es una RED DE SEGURIDAD, no
   * la forma de acotar la respuesta: para eso están `dias`, `desdeDia` y
   * `maxPorDia`. Antes el único freno era este tope (120) aplicado después de
   * mezclar profesionales, así que con tres profesionales el calendario
   * público mostraba dos días en vez de un mes.
   */
  maxSlots?: number;
  /** Tope de cupos por día chileno (ej. la vista de mes no necesita más). */
  maxPorDia?: number;
  /**
   * Con `true` basta el primer cupo de cada día: es lo único que necesita el
   * calendario para pintar «este día tiene horas», y evita generar 40 cupos
   * por día × 30 días × N profesionales para dibujar 30 puntitos.
   */
  soloPrimeroPorDia?: boolean;
  /**
   * Minutos de preparación que hay que respetar ENTRE horas (migración 277).
   * Se aplica solo contra otras citas, nunca contra bloqueos (ver Ocupado.tipo).
   *
   * No alarga la cita: la hora sigue durando lo que dice el servicio y a quien
   * reserva se le muestra su hora real. Lo único que cambia es que el cupo
   * pegado deja de ofrecerse.
   */
  bufferMin?: number;
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
  const max = params.maxSlots ?? 2000;
  const maxPorDia = params.maxPorDia ?? (params.soloPrimeroPorDia ? 1 : Infinity);

  // Ocupados pre-parseados una sola vez. El buffer se aplica ACÁ, ensanchando
  // el rango ocupado por las citas: así el cupo pegado deja de ofrecerse sin
  // tener que alargar la cita ni mentirle la hora a quien reserva.
  const buffer = Math.max(0, params.bufferMin ?? 0) * 60_000;
  const ocupadosMs = ocupados.map((o) => {
    const esCita = (o.tipo ?? "cita") === "cita";
    const margen = esCita ? buffer : 0;
    return {
      profesionalId: o.profesionalId,
      ini: Date.parse(o.desde) - margen,
      fin: Date.parse(o.hasta) + margen,
    };
  });

  const slots: Slot[] = [];

  // Mediodía de HOY en Chile como ancla: sumar días de a 24h desde un mediodía
  // nunca cruza mal un cambio de hora (el DST mueve la medianoche, no el
  // mediodía). Para cada día se rederiva la fecha chilena real vía Intl.
  const base = params.desdeDia ?? ahora;
  const dia0 = fechaChileDe(base);
  const anclaMediodia = horaChileAUtc(dia0.anio, dia0.mes, dia0.dia, 12, 0).getTime();

  for (let i = 0; i < dias; i++) {
    if (slots.length >= max) break;
    const fecha = fechaChileDe(new Date(anclaMediodia + i * 86_400_000));

    // Un cupo por INSTANTE, con la lista de quiénes pueden tomarlo. El mapa es
    // por día para no cargar el mes entero en memoria de una vez.
    const porInicio = new Map<number, string[]>();

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
        const previos = porInicio.get(t);
        if (previos) {
          if (!previos.includes(v.profesionalId)) previos.push(v.profesionalId);
        } else {
          if (porInicio.size >= maxPorDia) continue;
          porInicio.set(t, [v.profesionalId]);
        }
      }
    }

    const instantes = [...porInicio.keys()].sort((a, b) => a - b).slice(0, maxPorDia);
    for (const t of instantes) {
      const profesionales = (porInicio.get(t) ?? []).slice().sort((a, b) => a.localeCompare(b));
      slots.push({
        inicio: new Date(t).toISOString(),
        fin: new Date(t + dur).toISOString(),
        profesionalId: profesionales[0],
        profesionales,
      });
      if (slots.length >= max) break;
    }
  }

  // Orden cronológico (dentro de un día ya vienen ordenados).
  slots.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return slots.slice(0, max);
}

/**
 * A QUIÉN SE LE ASIGNA UN CUPO CUANDO EL CLIENTE DIJO «CUALQUIERA» (Fase 2).
 *
 * Determinista y explicable en una frase: **el que tenga menos citas ese día**;
 * si empatan, el que menos citas tenga en todo el rango; si siguen empatados,
 * un orden estable por id. Nada de IA, nada de azar: dos cálculos con los
 * mismos datos dan el mismo profesional, y el dueño puede entender por qué.
 *
 * `preferido` gana siempre que esté entre los disponibles: es el caso «quiero
 * con Marcelo».
 */
export function elegirProfesional(
  candidatos: readonly string[],
  carga: { porDia?: ReadonlyMap<string, number>; total?: ReadonlyMap<string, number> } = {},
  preferido?: string | null,
): string | null {
  if (!candidatos.length) return null;
  if (preferido && candidatos.includes(preferido)) return preferido;
  const orden = candidatos.slice().sort((a, b) => {
    const da = carga.porDia?.get(a) ?? 0;
    const db = carga.porDia?.get(b) ?? 0;
    if (da !== db) return da - db;
    const ta = carga.total?.get(a) ?? 0;
    const tb = carga.total?.get(b) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  });
  return orden[0] ?? null;
}

/** Clave de día chileno ("2026-09-18") de un instante. */
export function diaChileDe(iso: string | Date): string {
  const f = fechaChileDe(typeof iso === "string" ? new Date(iso) : iso);
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
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
