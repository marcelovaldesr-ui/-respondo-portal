"use client";

import { useState, useTransition } from "react";
import { generarInformeAhora } from "@/app/(portal)/insights/acciones";

/**
 * Botón para generar el informe de la semana.
 *
 * Generar toma ~25 segundos (el modelo lee cientos de mensajes), así que el
 * estado de espera no es un detalle: sin él, el usuario cree que se colgó y
 * aprieta de nuevo. Se avisa el tiempo esperado desde el primer segundo.
 */
export default function BotonInforme({
  semanasAtras = 0,
  etiqueta = "Generar informe de esta semana",
}: {
  semanasAtras?: number;
  etiqueta?: string;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        className="btn-primario"
        onClick={() => {
          setError(null);
          iniciar(async () => {
            const fd = new FormData();
            fd.set("semanasAtras", String(semanasAtras));
            const r = await generarInformeAhora(fd);
            if (!r.ok) setError(r.motivo ?? "No se pudo generar el informe.");
          });
        }}
      >
        {pendiente ? "Analizando conversaciones…" : etiqueta}
      </button>
      {pendiente && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
          Esto toma alrededor de medio minuto. No cierres la página.
        </p>
      )}
      {error && (
        <p className="mt-2 text-[13px] font-semibold" style={{ color: "var(--alerta)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
