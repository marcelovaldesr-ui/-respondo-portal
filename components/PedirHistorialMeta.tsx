"use client";

import { useState } from "react";

/**
 * Botón para pedirle a Meta el historial de chats de la app (Coexistencia).
 * Ver app/api/whatsapp/historial/route.ts: una sola vez por conexión y dentro
 * de las 24 h siguientes a conectar.
 */
export default function PedirHistorialMeta() {
  const [estado, setEstado] = useState<"listo" | "pidiendo" | "ok" | "error">("listo");
  const [detalle, setDetalle] = useState("");

  async function pedir() {
    if (!window.confirm("Meta deja pedir el historial UNA sola vez por conexión. ¿Pedirlo ahora?")) return;
    setEstado("pidiendo");
    try {
      const r = await fetch("/api/whatsapp/historial", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        resultados?: { tipo: string; ok: boolean; error?: string }[];
      };
      if (r.ok && j.ok) {
        setEstado("ok");
        setDetalle("Meta recibió el pedido. Los chats van llegando en partes durante las próximas horas.");
      } else {
        setEstado("error");
        setDetalle(j.error ?? j.resultados?.map((x) => `${x.tipo}: ${x.ok ? "ok" : x.error}`).join(" · ") ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setEstado("error");
      setDetalle((e as Error).message);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={pedir}
        disabled={estado === "pidiendo" || estado === "ok"}
        className="btn-primario px-5 py-2.5 text-[15px] disabled:opacity-60"
      >
        {estado === "pidiendo" ? "Pidiendo a Meta…" : estado === "ok" ? "Historial pedido ✓" : "Pedir historial a Meta"}
      </button>
      {detalle ? (
        <p className="mt-2 text-[13px]" style={{ color: estado === "error" ? "var(--rojo, #b91c1c)" : "var(--muted)" }}>
          {detalle}
        </p>
      ) : null}
    </div>
  );
}
