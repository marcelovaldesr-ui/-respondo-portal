"use client";

import { useState } from "react";
import Link from "next/link";
import { marcarPago, conciliarPagoAction } from "@/app/(portal)/conversaciones/accionesPagos";
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

  const conciliar = async (p: PagoListado) => {
    if (ocupado) return;
    setOcupado(p.id);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("pagoId", p.id);
      const r = await conciliarPagoAction(fd);
      if (r.ok && r.estado) {
        setPagos((xs) => xs.map((x) => (x.id === p.id ? { ...x, estado: r.estado as PagoListado["estado"] } : x)));
      } else {
        setError(r.error ?? "No se pudo conciliar con Flow");
      }
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
        const conceptoMin = (p.concepto ?? "").toLowerCase();
        const esAnticipo = p.tipoTransaccion === "anticipo_cita" || conceptoMin.includes("anticipo") || conceptoMin.includes("reserva");
        const esMembresia = p.tipoTransaccion === "membresia" || conceptoMin.includes("membresía") || conceptoMin.includes("membresia") || conceptoMin.includes("plan");

        return (
          <div
            key={p.id}
            className="tarjeta flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="cifra text-[15px] font-bold">{formatearMonto(p.monto)}</span>
                <Estado tono={e.tono}>{e.label}</Estado>
                {p.proveedor === "flow" && (
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-700 border border-sky-200">
                    Flow
                  </span>
                )}
                {esAnticipo && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800 border border-amber-200">
                    Anticipo
                  </span>
                )}
                {esMembresia && (
                  <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-purple-800 border border-purple-200">
                    Membresía
                  </span>
                )}
              </div>
              <div className="truncate text-[13px]" style={{ color: "var(--muted)" }}>
                {p.contacto} · {p.concepto}
              </div>
              <div className="cifra flex flex-wrap items-center gap-x-2" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                <span>
                  {p.referenciaExterna ? `N° ${p.referenciaExterna} · ` : ""}
                  {p.referencia} · {fechaCorta(p.creadoEn)}
                </span>
                {p.proveedorUrl && (
                  <a
                    href={p.proveedorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:underline"
                  >
                    Link Flow ↗
                  </a>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {p.estado === "pendiente" && p.proveedor === "flow" && (
                <button
                  onClick={() => void conciliar(p)}
                  disabled={ocupado === p.id}
                  className="rounded px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
                  style={{ background: "#E0F2FE", color: "#0369A1" }}
                  title="Consultar estado real en Flow.cl"
                >
                  Revisar en Flow
                </button>
              )}
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
                href={`/agenda/clientes?q=${encodeURIComponent(p.contacto)}`}
                className="btn-suave px-2.5 py-1 text-[12px]"
                title="Ver ficha del cliente"
              >
                Ver cliente
              </Link>
              {esAnticipo && (
                <Link
                  href="/agenda"
                  className="btn-suave px-2.5 py-1 text-[12px]"
                  title="Ver en la agenda"
                >
                  Ver reserva
                </Link>
              )}
              {p.chatId && (
                <Link
                  href={`/conversaciones?emp=${encodeURIComponent(p.empleadoId)}&chat=${encodeURIComponent(p.chatId)}`}
                  className="btn-suave px-2.5 py-1 text-[12px]"
                >
                  Ver chat →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
