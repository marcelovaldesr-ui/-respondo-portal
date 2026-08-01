"use client";

import { useRef, useState, useTransition } from "react";

/**
 * Editor de horario semanal de un profesional.
 *
 * Antes era una fila de casillas sueltas y una lista de píldoras: costaba ver
 * qué días quedaban sin atender. Ahora se muestran los 7 días siempre, con sus
 * tramos, y los que están vacíos se ven vacíos — que es la información que
 * realmente importa, porque un día sin tramos no ofrece ni una hora.
 */

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN = [1, 2, 3, 4, 5, 6, 0]; // lunes primero, como cualquier agenda

export type TramoHorario = { id: string; diaSemana: number; desde: string; hasta: string };

export default function HorarioSemanal({
  profesionalId,
  tramos,
  accionAgregar,
  accionEliminar,
}: {
  profesionalId: string;
  tramos: TramoHorario[];
  accionAgregar: (formData: FormData) => Promise<void>;
  accionEliminar: (formData: FormData) => Promise<void>;
}) {
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [enviando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function alternar(d: number) {
    setDias((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  const totalHoras =
    tramos.reduce((t, x) => t + (min(x.hasta) - min(x.desde)), 0) / 60;

  return (
    <div className="mt-3">
      {/* Los 7 días, siempre visibles */}
      <div className="overflow-hidden rounded-[7px] border" style={{ borderColor: "var(--borde)" }}>
        {ORDEN.map((d, i) => {
          const delDia = tramos
            .filter((t) => t.diaSemana === d)
            .sort((a, b) => a.desde.localeCompare(b.desde));
          return (
            <div
              key={d}
              className="flex flex-wrap items-center gap-2 px-3 py-2"
              style={{
                borderTop: i === 0 ? undefined : "1px solid var(--borde)",
                background: delDia.length ? "#fff" : "#fbfcfe",
              }}
            >
              <div
                className="w-[86px] shrink-0 text-[12.5px] font-bold"
                style={{ color: delDia.length ? "var(--tinta)" : "var(--muted-2)" }}
              >
                {DIAS[d]}
              </div>
              {delDia.length === 0 ? (
                <span className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                  cerrado
                </span>
              ) : (
                delDia.map((t) => (
                  <form key={t.id} action={accionEliminar} className="inline">
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      className="group inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-bold tabular-nums transition"
                      style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}
                      title="Quitar este tramo"
                    >
                      {t.desde}–{t.hasta}
                      <span style={{ opacity: 0.5 }}>✕</span>
                    </button>
                  </form>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 text-[12px]" style={{ color: "var(--muted-2)" }}>
        {tramos.length === 0
          ? "Sin horario todavía — sin horario no hay cupos que ofrecer."
          : `${totalHoras.toLocaleString("es-CL", { maximumFractionDigits: 1 })} horas de atención a la semana. Haz clic en un tramo para quitarlo.`}
      </div>

      {/* Agregar tramo */}
      <form
        ref={formRef}
        action={(fd) =>
          iniciar(async () => {
            await accionAgregar(fd);
          })
        }
        className="mt-3 flex flex-wrap items-center gap-2 rounded-[7px] border p-3"
        style={{ borderColor: "var(--borde)", background: "#fbfcfe", ...(enviando ? { opacity: 0.6, pointerEvents: "none" } : {}) }}
      >
        <input type="hidden" name="profesional" value={profesionalId} />
        {dias.map((d) => (
          <input key={d} type="hidden" name="dias" value={d} />
        ))}

        <div className="flex flex-wrap gap-1">
          {ORDEN.map((d) => {
            const activo = dias.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => alternar(d)}
                aria-pressed={activo}
                className="h-8 w-9 rounded-lg text-[12px] font-bold transition"
                style={
                  activo
                    ? { background: "var(--indigo)", color: "#fff" }
                    : { background: "#fff", color: "var(--muted-2)", border: "1px solid var(--borde)" }
                }
              >
                {DIAS[d].slice(0, 2)}
              </button>
            );
          })}
        </div>

        <input type="time" name="desde" defaultValue="10:00" required className="campo !w-auto" />
        <span className="text-[13px]" style={{ color: "var(--muted)" }}>a</span>
        <input type="time" name="hasta" defaultValue="19:00" required className="campo !w-auto" />
        <button type="submit" className="btn-suave px-3 py-1.5 text-[13px]" disabled={dias.length === 0}>
          Agregar tramo
        </button>
      </form>
    </div>
  );
}

function min(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
