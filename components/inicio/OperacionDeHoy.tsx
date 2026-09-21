"use client";

import Link from "next/link";
import type { MetricasOperacionHoy } from "@/lib/operationsSummary";

export default function OperacionDeHoy({
  metricas,
}: {
  metricas: MetricasOperacionHoy;
}) {
  return (
    <section className="tarjeta p-5" aria-labelledby="titulo-operacion-hoy">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--borde)" }}>
        <div>
          <span className="eyebrow" style={{ color: "var(--azul)" }}>Operación de hoy</span>
          <h2 id="titulo-operacion-hoy" className="h-seccion">
            Estado del día
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/agenda"
            className="btn-suave px-3 py-1.5 text-[13px] font-medium"
          >
            Ver agenda
          </Link>
          <Link
            href="/agenda/clases"
            className="btn-suave px-3 py-1.5 text-[13px] font-medium"
          >
            Ver clases
          </Link>
          <Link
            href="/agenda/membresias"
            className="btn-suave px-3 py-1.5 text-[13px] font-medium"
          >
            Ver membresías
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--borde)", background: "#f8fafc" }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-2)" }}>
            Clases hoy
          </div>
          <div className="mt-1 text-[22px] font-bold" style={{ color: "var(--tinta)" }}>
            {metricas.clasesHoy}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>
            sesiones programadas
          </div>
        </div>

        <div className="rounded-lg border p-3" style={{ borderColor: "var(--borde)", background: "#f8fafc" }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-2)" }}>
            Citas individuales
          </div>
          <div className="mt-1 text-[22px] font-bold" style={{ color: "var(--tinta)" }}>
            {metricas.citasHoy}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>
            horas agendadas
          </div>
        </div>

        <div className="rounded-lg border p-3" style={{ borderColor: "var(--borde)", background: "#f8fafc" }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-2)" }}>
            Cupos libres hoy
          </div>
          <div className="mt-1 text-[22px] font-bold" style={{ color: metricas.cuposLibresHoy > 0 ? "var(--ok)" : "var(--muted)" }}>
            {metricas.cuposLibresHoy}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>
            lugares disponibles
          </div>
        </div>

        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: metricas.holdsPendientes > 0 ? "#fde68a" : "var(--borde)",
            background: metricas.holdsPendientes > 0 ? "#fffbeb" : "#f8fafc",
          }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: metricas.holdsPendientes > 0 ? "#b45309" : "var(--muted-2)" }}>
            Esperando anticipo
          </div>
          <div className="mt-1 text-[22px] font-bold" style={{ color: metricas.holdsPendientes > 0 ? "#b45309" : "var(--tinta)" }}>
            {metricas.holdsPendientes}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: metricas.holdsPendientes > 0 ? "#92400e" : "var(--muted)" }}>
            holds activos (15 min)
          </div>
        </div>

        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: metricas.membresiasPorVencer7d > 0 ? "#e2e8f0" : "var(--borde)",
            background: "#f8fafc",
          }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--muted-2)" }}>
            Vencen en 7 días
          </div>
          <div className="mt-1 text-[22px] font-bold" style={{ color: metricas.membresiasPorVencer7d > 0 ? "#0284c7" : "var(--tinta)" }}>
            {metricas.membresiasPorVencer7d}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>
            membresías por renovar
          </div>
        </div>
      </div>
    </section>
  );
}
