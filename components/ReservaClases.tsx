"use client";

import { useMemo, useState } from "react";

/**
 * RESERVA PÚBLICA DE CLASES — el alumno elige una sesión, no una hora.
 *
 * Componente aparte de ReservaPublica y no un modo suyo: el flujo de horas
 * (servicio → día → hora libre) y el de clases (lista de sesiones con cupo) se
 * parecen por fuera pero no comparten casi nada por dentro. Mezclarlos habría
 * dejado un componente con dos máquinas de estado enredadas, donde arreglar una
 * rompe la otra.
 *
 * SIN CUENTA. Nombre y teléfono, nada más. Es la decisión central del diseño de
 * clases: pedirle registrarse a quien está a un toque de inscribirse es la forma
 * más rápida de perderlo, y acá no hace falta porque el teléfono ya identifica
 * a la persona.
 */

export type ClasePublica = {
  id: string;
  servicio: string;
  profesional: string;
  inicio: string;
  fin: string;
  lugaresLibres: number;
  cupoMaximo: number;
};

/** "Martes 5 de agosto" — encabezado de cada grupo del día. */
function tituloDia(iso: string): string {
  const s = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Clave de agrupación por día, en calendario chileno. */
function claveDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export default function ReservaClases({
  slug,
  clases,
}: {
  slug: string;
  clases: ClasePublica[];
}) {
  const [elegida, setElegida] = useState<ClasePublica | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(clases);

  /**
   * Agrupadas por día. Una lista plana de treinta sesiones es ilegible: el
   * alumno piensa "qué hago el jueves", no "cuál es la sesión número 14".
   */
  const porDia = useMemo(() => {
    const m = new Map<string, ClasePublica[]>();
    for (const c of lista) {
      const k = claveDia(c.inicio);
      const arr = m.get(k);
      if (arr) arr.push(c);
      else m.set(k, [c]);
    }
    return [...m.entries()];
  }, [lista]);

  async function inscribir() {
    if (!elegida || nombre.trim().length < 2 || telefono.trim().length < 8) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/reservas/clase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          claseId: elegida.id,
          nombre: nombre.trim(),
          telefono: telefono.trim(),
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setListo(true);
      } else {
        setError(j.mensaje ?? "No pudimos completar la inscripción.");
        /**
         * Si la clase se llenó mientras la persona escribía su nombre, se
         * quita de la lista y se la devuelve a elegir. Dejarla visible haría
         * que reintente sobre algo que ya no existe, que es la forma más
         * segura de que se rinda y cierre la página.
         */
        if (j.motivo === "cupo_tomado" || j.motivo === "cancelada") {
          setLista((l) => l.filter((c) => c.id !== elegida.id));
          setElegida(null);
        }
      }
    } catch {
      setError("No pudimos conectar. Revisa tu señal e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (listo && elegida) {
    return (
      <div className="tarjeta mt-6 p-6 text-center">
        <div className="text-[34px]">🎉</div>
        <h2 className="h-cifra mt-2">¡Quedaste inscrito!</h2>
        <p className="mt-2" style={{ fontSize: "var(--t-cuerpo)", color: "var(--muted)" }}>
          {elegida.servicio} · {tituloDia(elegida.inicio)} a las {hora(elegida.inicio)}
        </p>
        <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
          Te llegará la confirmación y el recordatorio por WhatsApp al{" "}
          <span className="cifra">{telefono}</span>.
        </p>
      </div>
    );
  }

  if (lista.length === 0) {
    return (
      <div className="tarjeta vacio mt-6">
        <div className="vacio-titulo">No hay clases con cupo disponible</div>
        <p className="vacio-texto">
          Escríbenos por WhatsApp y te avisamos apenas se abran nuevos horarios.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {porDia.map(([dia, delDia]) => (
        <section key={dia} className="mb-5">
          <h2 className="h-seccion mb-2">{tituloDia(delDia[0].inicio)}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {delDia.map((c) => {
              const sel = elegida?.id === c.id;
              const ultimos = c.lugaresLibres <= 3;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setElegida(sel ? null : c)}
                  className="tarjeta flex items-center gap-3 p-3 text-left transition"
                  style={
                    sel
                      ? { borderColor: "var(--indigo)", background: "var(--indigo-suave)" }
                      : undefined
                  }
                >
                  <span
                    className="cifra shrink-0 font-semibold"
                    style={{ fontSize: "var(--t-ficha)" }}
                  >
                    {hora(c.inicio)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate font-semibold"
                      style={{ fontSize: "var(--t-fila)" }}
                    >
                      {c.servicio}
                    </span>
                    <span
                      className="block truncate"
                      style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
                    >
                      {c.profesional}
                    </span>
                  </span>
                  {/* Cuando quedan pocos lugares se dice, porque es cierto y
                      porque es la información que hace decidir ahora. Con seis
                      libres no se dice nada: inventar urgencia falsa es
                      exactamente lo que hace desconfiar de una reserva online. */}
                  <span
                    className={ultimos ? "pildora-peligro" : "pildora-neutra"}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {c.lugaresLibres === 1 ? "queda 1" : `quedan ${c.lugaresLibres}`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {/* Datos — aparecen recién al elegir, para no mostrar un formulario a
          quien todavía está mirando horarios. */}
      {elegida && (
        <div className="tarjeta mt-2 p-4" style={{ borderColor: "var(--indigo-borde)" }}>
          <h2 className="h-seccion">
            {elegida.servicio} · {tituloDia(elegida.inicio)} a las {hora(elegida.inicio)}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label>
              <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Tu nombre</span>
              <input
                className="campo"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Camila Rojas"
                autoComplete="name"
              />
            </label>
            <label>
              <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Tu WhatsApp</span>
              <input
                className="campo"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="+56 9 1234 5678"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
          </div>

          {error && (
            <p
              className="mt-2.5"
              style={{ fontSize: "var(--t-menor)", color: "var(--peligro)" }}
            >
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={inscribir}
            disabled={enviando || nombre.trim().length < 2 || telefono.trim().length < 8}
            className="btn-primario mt-3 w-full justify-center"
          >
            {enviando ? "Inscribiendo…" : "Confirmar mi cupo"}
          </button>
          <p
            className="mt-2 text-center"
            style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}
          >
            No necesitas crear una cuenta. Usamos tu WhatsApp para confirmarte y recordarte.
          </p>
        </div>
      )}
    </div>
  );
}
