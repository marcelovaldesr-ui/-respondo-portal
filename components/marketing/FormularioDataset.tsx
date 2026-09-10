"use client";

import { useState, useTransition } from "react";
import { guardarDataset } from "@/app/(marketing)/marketing/integraciones/acciones";

/**
 * El identificador del conjunto de datos de Meta.
 *
 * Es un número que el dueño copia del Administrador de Eventos. Se valida en el
 * servidor antes de guardar porque un dataset equivocado NO da error en
 * ninguna parte: los eventos se mandan, Meta responde que sí, y no sirven para
 * nada durante meses. Es de los errores más caros y más silenciosos que hay en
 * esta integración.
 */
export default function FormularioDataset({ valor }: { valor: string }) {
  const [texto, setTexto] = useState(valor);
  const [estado, setEstado] = useState<"" | "ok" | string>("");
  const [pendiente, iniciar] = useTransition();

  return (
    <div>
      <label
        htmlFor="dataset"
        className="block font-semibold"
        style={{ fontSize: "var(--t-menor)" }}
      >
        Identificador del conjunto de datos
      </label>
      <p className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        Lo encuentras en el Administrador de Eventos de Meta, en la ficha del conjunto de datos
        asociado a tu cuenta de WhatsApp. Es un número largo.
      </p>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <input
          id="dataset"
          className="campo cifra"
          style={{ maxWidth: 280 }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="1234567890123456"
          value={texto}
          disabled={pendiente}
          onChange={(e) => {
            setTexto(e.target.value);
            setEstado("");
          }}
        />
        <button
          type="button"
          className="btn-suave"
          disabled={pendiente || texto === valor}
          onClick={() =>
            iniciar(async () => {
              const fd = new FormData();
              fd.set("dataset", texto);
              const r = await guardarDataset(fd);
              setEstado(r.ok ? "ok" : (r.motivo ?? "No se pudo guardar."));
            })
          }
        >
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {estado === "ok" && (
        <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--ok)" }}>
          Guardado.
        </p>
      )}
      {estado && estado !== "ok" && (
        <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>
          {estado}
        </p>
      )}
    </div>
  );
}
