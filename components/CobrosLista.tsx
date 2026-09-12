"use client";

import { useState } from "react";
import Link from "next/link";
import { marcarPago } from "@/app/(portal)/conversaciones/accionesPagos";
import { formatearMonto } from "@/lib/pagosCore";
import type { PagoListado } from "@/lib/pagos";
import { ESTADO_COBRO } from "@/lib/estadoComercialVista";
import { Estado } from "@/components/estado/Estados";

/**
 * LA LISTA GLOBAL DE COBROS — interactiva.
 *
 * Mismo patrón que PagosCard: estado local que se actualiza al marcar, y la
 * carrera real (dos personas sobre el mismo cobro) la resuelve el servidor con
 * el update condicionado. El que llega segundo ve el aviso, no un dato falso.
 */

// (Fase 1) Estado y tono compartidos con la ficha de la conversación.

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function CobrosLista({ pagos: iniciales }: { pagos: PagoListado[] }) {
  const [pagos, setPagos] = useState(iniciales);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cambiar = async (p: PagoListado, hacia: "pagado" | "anulado") => {
    if (ocupado) return;
    setOcupado(p.id);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("pagoId", p.id);
      fd.set("desde", p.estado);
      fd.set("hacia", hacia);
      const r = await marcarPago(fd);
      if (r.ok) setPagos((xs) => xs.map((x) => (x.id === p.id ? { ...x, estado: hacia } : x)));
      else setError(r.error ?? "No se pudo actualizar");
    } finally {
      setOcupado(null);
    }
  };

  if (!pagos.length) {
    return (
      <div className="tarjeta p-8 text-center" style={{ color: "var(--muted)" }}>
        No hay cobros con este filtro. Los cobros se envían desde cualquier conversación con
        el botón 💲 Cobrar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-[13px]" style={{ color: "var(--alerta, #B91C1C)" }}>
          {error}
        </p>
      )}
      {pagos.map((p) => {
        const e = ESTADO_COBRO[p.estado] ?? ESTADO_COBRO.pendiente;
        return (
          <div
            key={p.id}
            className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="cifra text-[15px] font-bold">{formatearMonto(p.monto)}</span>
                <Estado tono={e.tono}>{e.label}</Estado>
              </div>
              <div className="truncate text-[13px]" style={{ color: "var(--muted)" }}>
                {p.contacto} · {p.concepto}
              </div>
              <div className="cifra" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                {p.referenciaExterna ? `N° ${p.referenciaExterna} · ` : ""}
                {p.referencia} · {fechaCorta(p.creadoEn)}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {p.estado === "pendiente" && (
                <>
                  <button
                    onClick={() => void cambiar(p, "pagado")}
                    disabled={ocupado === p.id}
                    className="rounded px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                    style={{ background: "#DCFCE7", color: "#166534" }}
                  >
                    Marcar pagado
                  </button>
                  <button
                    onClick={() => void cambiar(p, "anulado")}
                    disabled={ocupado === p.id}
                    className="rounded px-2.5 py-1 text-[12px] disabled:opacity-50"
                    style={{ background: "#F3F4F6", color: "#6B7280" }}
                  >
                    Anular
                  </button>
                </>
              )}
              <Link
                href={`/conversaciones?emp=${encodeURIComponent(p.empleadoId)}&chat=${encodeURIComponent(p.chatId)}`}
                className="btn-suave px-2.5 py-1 text-[12px]"
              >
                Ver chat →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
