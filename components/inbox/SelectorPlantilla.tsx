"use client";

import { useMemo, useState } from "react";
import { PLANTILLAS, render } from "@/lib/plantillas";

/**
 * MANDAR UNA PLANTILLA CUANDO LA CONVERSACIÓN ESTÁ FUERA DE PLAZO.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Pasadas 24 h desde el último mensaje del cliente, Meta rechaza el texto libre
 * —del asistente y de la persona por igual—. El portal avisaba de eso y no
 * ofrecía nada: se escribía igual, se apretaba enviar, y el mensaje moría en
 * Meta. Un callejón sin salida disfrazado de advertencia.
 *
 * Acá la persona elige una plantilla ya aprobada, completa los datos y la manda.
 *
 * DECISIONES DE DISEÑO
 * --------------------
 *  - **Se muestra el texto final, no el técnico.** Nadie debería ver `{{1}}`.
 *    Lo que aparece es exactamente lo que va a leer el cliente.
 *  - **El nombre del contacto viene puesto.** Es el dato que siempre se sabe y
 *    el que más se repite.
 *  - **Se avisa cuál cuesta más.** Las de marketing valen unas cinco veces lo
 *    que las de utilidad, y quien manda debería poder saberlo sin preguntar.
 *  - **El botón no se habilita hasta que el texto esté completo.** Meta rechaza
 *    los parámetros vacíos, así que es mejor no dejar intentarlo.
 */
export function SelectorPlantilla({
  contacto,
  onEnviar,
  onCancelar,
  enviando,
}: {
  /** Nombre del contacto, para precargar el primer dato. */
  contacto: string;
  onEnviar: (plantilla: string, params: string[]) => void;
  onCancelar: () => void;
  enviando: boolean;
}) {
  const opciones = useMemo(() => Object.values(PLANTILLAS), []);
  const [elegida, setElegida] = useState<string>("");
  const plantilla = elegida ? PLANTILLAS[elegida] : null;

  const [valores, setValores] = useState<string[]>([]);

  const elegir = (nombre: string) => {
    setElegida(nombre);
    const p = PLANTILLAS[nombre];
    // El primer dato de todas es el nombre de la persona: se precarga.
    setValores(p ? p.variables.map((_, i) => (i === 0 ? contacto : "")) : []);
  };

  const vistaPrevia = plantilla ? render(plantilla.cuerpo, valores) : null;
  const listo = Boolean(vistaPrevia) && !enviando;

  return (
    <div
      className="mb-2 rounded-xl border p-3"
      style={{ borderColor: "var(--borde)", background: "#FBFCFE" }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
          Enviar una plantilla aprobada
        </span>
        <button
          onClick={onCancelar}
          className="text-[12px] font-semibold"
          style={{ color: "var(--muted)" }}
        >
          Cancelar
        </button>
      </div>

      {!plantilla ? (
        <div className="flex flex-col gap-1.5">
          {opciones.map((p) => (
            <button
              key={p.nombre}
              onClick={() => elegir(p.nombre)}
              className="rounded-lg border px-3 py-2 text-left transition hover:bg-white"
              style={{ borderColor: "var(--borde)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">
                  {p.nombre.replaceAll("_", " ")}
                </span>
                {p.categoria === "marketing" && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{ background: "#FFF1EC", color: "#C2410C" }}
                    title="Las de marketing cuestan bastante más que las de utilidad"
                  >
                    costo alto
                  </span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: "var(--muted)" }}>
                {p.cuerpo.replace(/\{\{\d+\}\}/g, "…").replace(/\n+/g, " ")}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setElegida("")}
            className="self-start text-[12px] font-semibold"
            style={{ color: "var(--indigo, #4F46E5)" }}
          >
            ← Elegir otra
          </button>

          {plantilla.variables.map((etiqueta, i) => (
            <label key={etiqueta + i} className="flex flex-col gap-1">
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--muted)" }}>
                {etiqueta}
              </span>
              <input
                className="campo"
                value={valores[i] ?? ""}
                placeholder={plantilla.ejemplos[i] ?? ""}
                onChange={(e) =>
                  setValores((v) => {
                    const out = [...v];
                    out[i] = e.target.value;
                    return out;
                  })
                }
              />
            </label>
          ))}

          <div>
            <div className="mb-1 text-[11.5px] font-semibold" style={{ color: "var(--muted)" }}>
              Le va a llegar esto
            </div>
            <div
              className="whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px]"
              style={{ background: "var(--indigo-suave)", color: "var(--tinta)" }}
            >
              {vistaPrevia ?? "Completa los datos para ver el mensaje."}
            </div>
          </div>

          <button
            onClick={() => onEnviar(plantilla.nombre, valores)}
            disabled={!listo}
            className="btn-primario self-end px-4 py-2 text-[13px] disabled:opacity-50"
          >
            {enviando ? "Enviando…" : "Enviar plantilla"}
          </button>
        </div>
      )}
    </div>
  );
}
