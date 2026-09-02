"use client";

import { useState } from "react";
import { enviarInformeFidelizacionAccion } from "@/app/(portal)/analitica/acciones";

/**
 * "Enviar a mi WhatsApp" — el botón que resuelve lo que le faltó a RS-Shop
 * cuando la decisión subió a gerencia: algo que reenviar, sin copiar números
 * a mano desde la pantalla.
 */
export default function EnviarInforme() {
  const [estado, setEstado] = useState<"idle" | "enviando" | "listo" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const enviar = async () => {
    if (estado === "enviando") return;
    setEstado("enviando");
    setError(null);
    try {
      const r = await enviarInformeFidelizacionAccion();
      if (r.ok) {
        setEstado("listo");
      } else {
        setEstado("error");
        setError(r.error ?? "No se pudo enviar el informe");
      }
    } catch {
      setEstado("error");
      setError("No se pudo enviar el informe");
    }
  };

  if (estado === "listo") {
    return (
      <span className="pildora" style={{ background: "#DCFCE7", color: "#166534" }}>
        ✓ Enviado a tu WhatsApp
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => void enviar()}
        disabled={estado === "enviando"}
        className="btn-suave px-3 py-1.5 text-[13px] disabled:opacity-50"
      >
        {estado === "enviando" ? "Enviando…" : "Enviar a mi WhatsApp"}
      </button>
      {error && (
        <span className="text-[12px]" style={{ color: "var(--alerta, #B91C1C)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
