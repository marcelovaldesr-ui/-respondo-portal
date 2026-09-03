"use client";

import { useState } from "react";
import { cobrarEnChat } from "@/app/(portal)/conversaciones/accionesPagos";
import { MONTO_MAX, MONTO_MIN, formatearMonto } from "@/lib/pagosCore";

/**
 * COBRAR EN LA CONVERSACIÓN — el botón y su formulario.
 *
 * La función que convirtió a Vita en «el equipo que opera tu centro»: la
 * conversación no termina en «te paso los datos de transferencia», termina en
 * un mensaje con enlace de pago y referencia, y un registro con estado.
 *
 * Diseño del formulario: DOS campos, monto y concepto. Cada campo extra en un
 * formulario que se usa veinte veces al día es fricción multiplicada por
 * veinte. La referencia se genera sola; el enlace ya está configurado.
 */
export function Cobro({
  empleadoId,
  chatId,
  concepto0,
}: {
  empleadoId: string;
  chatId: string;
  /** Sugerencia inicial del concepto (ej: lo último cotizado), si se conoce. */
  concepto0?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState(concepto0 ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const montoNum = Number(monto.replace(/\./g, ""));
  const valido =
    Number.isFinite(montoNum) &&
    montoNum >= MONTO_MIN &&
    montoNum <= MONTO_MAX &&
    concepto.trim().length > 0;

  const cobrar = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("empleadoId", empleadoId);
      fd.set("chatId", chatId);
      fd.set("monto", String(montoNum));
      fd.set("concepto", concepto.trim());
      const r = await cobrarEnChat(fd);
      if (r.ok) {
        // El mensaje aparece en el chat por el stream en ~1 s; acá solo se
        // confirma la referencia y se limpia para el próximo cobro.
        setExito(`Cobro enviado · referencia ${r.referencia}`);
        setMonto("");
        setConcepto("");
        // El panel de cobros se entera sin cambiar de chat.
        window.dispatchEvent(new Event("respondo:detalle-cambio"));
        setTimeout(() => {
          setExito(null);
          setAbierto(false);
        }, 2500);
      } else {
        setError(r.error ?? "No se pudo enviar el cobro");
      }
    } catch {
      setError("No se pudo enviar el cobro. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="btn-suave px-3 py-1.5 text-[12.5px]"
        title="Enviar un cobro con el enlace de pago del negocio"
      >
        💲 Cobrar
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--borde)", background: "#FAFBFE" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-bold">Enviar cobro</span>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-[12px]"
          style={{ color: "var(--muted)" }}
        >
          Cancelar
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>
            Monto (CLP)
          </span>
          <input
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="numeric"
            placeholder="25.000"
            className="campo w-[120px]"
          />
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>
            Por qué es el cobro
          </span>
          <input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            maxLength={120}
            placeholder="500 tarjetas de presentación"
            className="campo"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void cobrar();
              }
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void cobrar()}
          disabled={!valido || enviando}
          className="btn-primario px-4 py-2 text-[13px] disabled:opacity-50"
        >
          {enviando ? "Enviando…" : valido ? `Cobrar ${formatearMonto(montoNum)}` : "Cobrar"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--alerta, #B91C1C)" }}>
          {error}
        </p>
      )}
      {exito && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--ok, #15803D)" }}>
          ✓ {exito}
        </p>
      )}
      <p className="mt-2 text-[11px]" style={{ color: "var(--muted-2)" }}>
        El cliente recibe el enlace de pago del negocio con una referencia. Cuando pague, se
        marca en el panel de la derecha.
      </p>
    </div>
  );
}
