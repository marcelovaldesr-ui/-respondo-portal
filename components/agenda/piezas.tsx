"use client";

import { useMemo } from "react";

/**
 * PIEZAS COMPARTIDAS DEL SELECTOR DE HORA (Fase 2).
 *
 * Antes existían DOS implementaciones del mismo control: la de la página
 * pública (calendario mensual + bloques mañana/tarde/noche) y la de la
 * autogestión del cliente (lista plana de 14 días). El mismo cliente veía dos
 * productos distintos al reservar y al mover su hora, y cualquier arreglo —el
 * tamaño de los botones, el foco del teclado— había que hacerlo dos veces.
 *
 * Reglas que valen para las dos:
 *  · 44 px de alto real: un botón de hora se toca con el pulgar, en 3G y de pie.
 *  · El estado no depende del color: `aria-pressed` + borde + fondo.
 *  · Todo en hora de Chile explícita; el visitante puede estar en otro huso.
 */

export const ZONA_PUBLICA = "America/Santiago";

const DIAS_CORTOS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-09-18" del instante, en hora de Chile. */
export function claveDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_PUBLICA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_PUBLICA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function minutosDe(iso: string): number {
  const [h, m] = hora(iso).split(":").map(Number);
  return h * 60 + m;
}

/** "jueves 18 de septiembre" a partir de la clave, sin volver a tocar husos. */
export function tituloDeClave(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number);
  const nombreDia = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][
    new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  ];
  return `${nombreDia} ${d} de ${MESES[m - 1]}`;
}

export function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

export function mesDeClave(clave: string): string {
  return clave.slice(0, 7);
}

export function mesSiguiente(mes: string, paso: 1 | -1): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + paso, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Matriz del mes (semanas de 7) empezando en lunes. null = casilla vacía. */
function grillaMes(mes: string): (string | null)[][] {
  const [a, m] = mes.split("-").map(Number);
  const primero = new Date(Date.UTC(a, m - 1, 1));
  const diasEnMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const desplazamiento = (primero.getUTCDay() + 6) % 7;
  const celdas: (string | null)[] = Array(desplazamiento).fill(null);
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push(`${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

/**
 * CON QUIÉN. Solo aparece cuando de verdad hay más de una persona que pueda
 * atender el servicio: preguntar «¿con quién?» cuando la respuesta es una sola
 * es un paso que no aporta nada. «Cualquiera» viene elegido porque es lo que
 * quiere la mayoría, y es además lo que más horas deja a la vista.
 */
export function SelectorProfesional({
  profesionales,
  valor,
  onCambio,
}: {
  profesionales: { id: string; nombre: string }[];
  valor: string | null;
  onCambio: (id: string | null) => void;
}) {
  if (profesionales.length < 2) return null;
  return (
    <div>
      <div className="rotulo mb-1.5">Con quién</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Elige profesional">
        <button type="button" className="chip-opcion" aria-pressed={valor === null} onClick={() => onCambio(null)}>
          Cualquiera
          <span style={{ fontSize: "var(--t-meta)", opacity: 0.75 }}>· más horas</span>
        </button>
        {profesionales.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip-opcion"
            aria-pressed={valor === p.id}
            onClick={() => onCambio(p.id)}
          >
            {p.nombre || "Profesional"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Calendario del mes: solo se pueden tocar los días que tienen cupo. */
export function CalendarioMes({
  mes,
  dias,
  elegido,
  cargando,
  puedeRetroceder,
  onMes,
  onDia,
}: {
  mes: string;
  /** Claves "2026-09-18" con al menos un cupo. */
  dias: string[];
  elegido: string | null;
  cargando?: boolean;
  puedeRetroceder: boolean;
  onMes: (mes: string) => void;
  onDia: (clave: string) => void;
}) {
  const conCupo = useMemo(() => new Set(dias), [dias]);
  const semanas = useMemo(() => grillaMes(mes), [mes]);
  const hoy = claveDia(new Date().toISOString());

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="nav-mes"
          onClick={() => onMes(mesSiguiente(mes, -1))}
          disabled={!puedeRetroceder}
          aria-label="Mes anterior"
        >
          ←
        </button>
        <div className="font-semibold" style={{ fontSize: "var(--t-fila)" }} aria-live="polite">
          {nombreMes(mes)}
        </div>
        <button type="button" className="nav-mes" onClick={() => onMes(mesSiguiente(mes, 1))} aria-label="Mes siguiente">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1" aria-hidden>
        {DIAS_CORTOS.map((d) => (
          <div key={d} className="rotulo pb-1 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1" style={cargando ? { opacity: 0.5 } : undefined}>
        {semanas.flat().map((clave, i) =>
          clave === null ? (
            <div key={`v${i}`} />
          ) : (
            <button
              key={clave}
              type="button"
              className="dia-cal"
              data-cupo={conCupo.has(clave) ? "si" : "no"}
              aria-pressed={elegido === clave}
              aria-label={`${tituloDeClave(clave)}${conCupo.has(clave) ? "" : " (sin horas)"}`}
              disabled={!conCupo.has(clave)}
              onClick={() => onDia(clave)}
              // El día de hoy se marca solo si además se puede tocar: un recuadro
              // alrededor de un día sin horas se lee como «este sí, toca aquí».
              style={
                clave === hoy && elegido !== clave && conCupo.has(clave)
                  ? { boxShadow: "inset 0 0 0 2px var(--azul)" }
                  : undefined
              }
            >
              {Number(clave.slice(8))}
            </button>
          ),
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-3" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: "var(--azul-borde)", border: "1px solid var(--azul)" }}
            aria-hidden
          />
          con horas
        </span>
        <span>Horario de Chile</span>
      </p>
    </div>
  );
}

const BLOQUES = [
  { clave: "manana", titulo: "Mañana", desde: 0, hasta: 12 * 60 },
  { clave: "tarde", titulo: "Tarde", desde: 12 * 60, hasta: 18 * 60 },
  { clave: "noche", titulo: "Noche", desde: 18 * 60, hasta: 24 * 60 },
];

/** Horas del día elegido, agrupadas en mañana / tarde / noche. */
export function BotonesHora({
  horas,
  elegida,
  cargando,
  onElegir,
}: {
  horas: { inicio: string }[];
  elegida: string | null;
  cargando?: boolean;
  onElegir: (inicio: string) => void;
}) {
  const grupos = BLOQUES.map((b) => ({
    ...b,
    horas: horas.filter((h) => {
      const m = minutosDe(h.inicio);
      return m >= b.desde && m < b.hasta;
    }),
  })).filter((g) => g.horas.length > 0);

  if (cargando) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-live="polite" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="esqueleto" style={{ height: 44, borderRadius: "var(--r-input)" }} />
        ))}
      </div>
    );
  }

  if (!horas.length) {
    return (
      <p className="vacio-texto" role="status">
        No quedan horas ese día. Elige otro en el calendario.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {grupos.map((g) => (
        <div key={g.clave}>
          {grupos.length > 1 && <div className="rotulo mb-1.5">{g.titulo}</div>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {g.horas.map((h) => (
              <button
                key={h.inicio}
                type="button"
                className="btn-hora"
                aria-pressed={elegida === h.inicio}
                onClick={() => onElegir(h.inicio)}
              >
                {hora(h.inicio)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
