"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

/**
 * Botón "Nueva hora" + panel para agendar a mano.
 *
 * Antes esto era un <details> perdido entre la configuración. Agendar a mano es
 * lo que más hace un dueño cuando alguien llama por teléfono, así que ahora es
 * un botón primario arriba y un panel que se abre encima.
 *
 * Muestra la hora de término calculada según la duración del servicio: sin eso
 * uno agenda a ciegas y descubre el choque después.
 */

type ServicioOpt = { id: string; nombre: string; duracionMin: number };
type ProfOpt = { id: string; nombre: string };

function finEstimado(inicio: string, minutos: number): string | null {
  if (!inicio) return null;
  const m = inicio.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const total = Number(m[4]) * 60 + Number(m[5]) + minutos;
  const h = Math.floor(total / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function NuevaCita({
  accion,
  servicios,
  profesionales,
}: {
  accion: (formData: FormData) => Promise<void>;
  servicios: ServicioOpt[];
  profesionales: ProfOpt[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [servicioId, setServicioId] = useState(servicios[0]?.id ?? "");
  const [inicio, setInicio] = useState("");
  const [enviando, iniciar] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const listo = servicios.length > 0 && profesionales.length > 0;

  const servicio = useMemo(
    () => servicios.find((s) => s.id === servicioId) ?? servicios[0],
    [servicios, servicioId],
  );
  const termina = servicio ? finEstimado(inicio, servicio.duracionMin) : null;

  // Escape cierra el panel: es lo que espera cualquiera frente a un modal.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="btn-primario px-4 py-2 text-[13.5px]"
        disabled={!listo}
        title={listo ? "Agendar una hora a mano" : "Primero crea un servicio y un profesional"}
        style={listo ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
      >
        + Nueva hora
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          style={{ background: "rgba(15,23,42,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setAbierto(false);
          }}
        >
          <div
            className="tarjeta w-full max-w-lg p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Agendar una hora"
            style={{ boxShadow: "var(--sombra-alta)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">Agendar</div>
                <h2 className="h-pagina">Nueva hora</h2>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="btn-suave px-2.5 py-1.5 text-[12px]"
              >
                Cerrar
              </button>
            </div>

            <form
              ref={formRef}
              className="mt-4 grid gap-3.5"
              action={(fd) =>
                iniciar(async () => {
                  await accion(fd);
                  formRef.current?.reset();
                  setInicio("");
                  setAbierto(false);
                })
              }
              style={enviando ? { opacity: 0.6, pointerEvents: "none" } : undefined}
            >
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="text-[13px] font-bold">Servicio</label>
                  <select
                    name="servicio"
                    required
                    className="campo mt-1.5"
                    value={servicioId}
                    onChange={(e) => setServicioId(e.target.value)}
                  >
                    {servicios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre} · {s.duracionMin} min
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[13px] font-bold">Profesional</label>
                  <select name="profesional" required className="campo mt-1.5">
                    {profesionales.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[13px] font-bold">Fecha y hora de inicio</label>
                <input
                  type="datetime-local"
                  name="inicio"
                  required
                  className="campo mt-1.5"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
                <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                  Hora de Chile.{" "}
                  {termina ? <>Termina aproximadamente a las <b>{termina}</b>.</> : "Elige un horario para ver cuándo termina."}
                </p>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="text-[13px] font-bold">Nombre del cliente</label>
                  <input name="nombre" required className="campo mt-1.5" placeholder="Camila Rojas" />
                </div>
                <div>
                  <label className="text-[13px] font-bold">WhatsApp (opcional)</label>
                  <input name="telefono" className="campo mt-1.5" placeholder="9 1234 5678" />
                </div>
              </div>
              <p className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                Con el WhatsApp, tu empleado le manda el recordatorio y la confirmación solo.
              </p>

              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={() => setAbierto(false)} className="btn-suave px-4 py-2 text-[13.5px]">
                  Cancelar
                </button>
                <button type="submit" className="btn-primario px-5 py-2 text-[13.5px]">
                  {enviando ? "Agendando…" : "Agendar hora"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
