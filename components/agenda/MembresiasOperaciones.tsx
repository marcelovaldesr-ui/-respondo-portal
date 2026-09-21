"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  MembresiaFilaOperacional,
  MembresiasKpis,
  DetalleMembresiaOperacional,
} from "@/lib/memberships/membershipsOperations";

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function MembresiasOperaciones({
  membresias,
  kpis,
  onObtenerDetalle,
  onAjustarCreditos,
  onRenovarMembresia,
}: {
  membresias: MembresiaFilaOperacional[];
  kpis: MembresiasKpis;
  onObtenerDetalle: (membresiaId: string) => Promise<DetalleMembresiaOperacional | null>;
  onAjustarCreditos: (fd: FormData) => Promise<{ ok: boolean; nuevoSaldo?: number; error?: string }>;
  onRenovarMembresia: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [seleccionada, setSeleccionada] = useState<DetalleMembresiaOperacional | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [mostrarAjuste, setMostrarAjuste] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorAjuste, setErrorAjuste] = useState<string | null>(null);
  const [filtroTexto, setFiltroTexto] = useState("");

  const listaFiltrada = membresias.filter((m) => {
    if (!filtroTexto.trim()) return true;
    const term = filtroTexto.toLowerCase();
    return (
      m.contactoNombre.toLowerCase().includes(term) ||
      (m.contactoTelefono && m.contactoTelefono.includes(term)) ||
      m.planNombre.toLowerCase().includes(term)
    );
  });

  async function abrirDetalle(membresiaId: string) {
    setCargandoDetalle(true);
    setMostrarAjuste(false);
    setErrorAjuste(null);
    try {
      const detalle = await onObtenerDetalle(membresiaId);
      setSeleccionada(detalle);
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function recargarDetalle(membresiaId: string) {
    setCargandoDetalle(true);
    try {
      const detalle = await onObtenerDetalle(membresiaId);
      setSeleccionada(detalle);
    } finally {
      setCargandoDetalle(false);
    }
  }

  return (
    <div>
      {/* ── Tarjetas de KPIs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="tarjeta p-4">
          <div className="text-[12.5px] font-medium text-slate-500">Membresías activas</div>
          <div className="mt-1 text-[24px] font-bold text-slate-900">{kpis.activas}</div>
          <div className="mt-0.5 text-[11.5px] text-emerald-700">Con vigencia y plan al día</div>
        </div>

        <div className="tarjeta p-4">
          <div className="text-[12.5px] font-medium text-slate-500">Vencen esta semana</div>
          <div className="mt-1 text-[24px] font-bold text-amber-600">{kpis.vencenEstaSemana}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">Oportunidad de renovación</div>
        </div>

        <div className="tarjeta p-4">
          <div className="text-[12.5px] font-medium text-slate-500">Sin créditos</div>
          <div className="mt-1 text-[24px] font-bold text-rose-600">{kpis.sinCreditos}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">Créditos agotados (saldo 0)</div>
        </div>

        <div className="tarjeta p-4">
          <div className="text-[12.5px] font-medium text-slate-500">Renovaciones pendientes</div>
          <div className="mt-1 text-[24px] font-bold text-indigo-600">{kpis.renovacionesPendientes}</div>
          <div className="mt-0.5 text-[11.5px] text-slate-500">Vencidas o por renovar</div>
        </div>
      </div>

      {/* ── Buscador ─────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-sm">
          <input
            type="text"
            placeholder="Buscar por socio, teléfono o plan…"
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            className="campo text-[13.5px]"
          />
        </div>
        <div className="text-[13px] text-slate-500">
          Mostrando {listaFiltrada.length} de {membresias.length} membresías
        </div>
      </div>

      {/* ── Tabla de Membresías ───────────────────────────────────────── */}
      <div className="tarjeta mt-4 overflow-hidden">
        {listaFiltrada.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-slate-500">
            {filtroTexto.trim() ? (
              "No se encontraron membresías con ese criterio de búsqueda."
            ) : (
              <div>
                <p className="font-bold text-slate-800">Aún no hay membresías registradas</p>
                <p className="mt-1 text-slate-500">
                  Cuando un cliente contrate un plan o lo cargues desde el portal, aparecerá aquí.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="p-3.5 pl-4">Socio / Cliente</th>
                  <th className="p-3.5">Plan</th>
                  <th className="p-3.5">Créditos</th>
                  <th className="p-3.5">Vigencia</th>
                  <th className="p-3.5">Estado</th>
                  <th className="p-3.5">Próxima reserva</th>
                  <th className="p-3.5 pr-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listaFiltrada.map((m) => {
                  const estadoColor =
                    m.estado === "activa"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : m.estado === "vencida"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : m.estado === "agotada"
                          ? "bg-rose-50 text-rose-800 border-rose-200"
                          : "bg-slate-100 text-slate-600 border-slate-200";

                  const estadoLabel =
                    m.estado === "activa"
                      ? "Activa"
                      : m.estado === "vencida"
                        ? "Vencida"
                        : m.estado === "agotada"
                          ? "Sin créditos"
                          : "Cancelada";

                  return (
                    <tr key={m.id} className="transition hover:bg-slate-50/80">
                      <td className="p-3.5 pl-4 font-semibold text-slate-900">
                        <div>{m.contactoNombre}</div>
                        <div className="text-[12px] font-normal text-slate-500">
                          {m.contactoTelefono || "Sin teléfono"}
                        </div>
                      </td>
                      <td className="p-3.5 font-medium text-slate-800">{m.planNombre}</td>
                      <td className="p-3.5">
                        {m.esIlimitada ? (
                          <span className="font-bold text-indigo-700">Ilimitado</span>
                        ) : (
                          <div>
                            <span className="font-bold text-slate-900">{m.creditosSaldo}</span>
                            <span className="text-slate-500">
                              {" "}
                              de {m.creditosTotales ?? "—"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-[12.5px] text-slate-600">
                        {fechaCorta(m.inicio)} → {fechaCorta(m.fin)}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${estadoColor}`}
                        >
                          {estadoLabel}
                        </span>
                      </td>
                      <td className="p-3.5 text-[12.5px] text-slate-600">
                        {m.proximaReserva ? (
                          <div>
                            <span className="font-semibold text-slate-800">
                              {fechaHora(m.proximaReserva.inicio)}
                            </span>
                            <div className="text-[11.5px] text-slate-500">
                              {m.proximaReserva.servicioNombre}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3.5 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => void abrirDetalle(m.id)}
                          className="btn-suave px-3 py-1 text-[12.5px] font-semibold"
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL / DETALLE DE MEMBRESÍA & HISTORIAL LEDGER ──────────── */}
      {cargandoDetalle && !seleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="rounded-lg bg-white p-6 shadow-xl text-[14px] text-slate-700 font-semibold">
            Cargando detalle operacional y ledger…
          </div>
        </div>
      )}

      {seleccionada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-white shadow-2xl" style={{ borderColor: "var(--borde)" }}>
            {/* Cabecera modal */}
            <div className="flex items-start justify-between border-b p-5" style={{ borderColor: "var(--borde)" }}>
              <div>
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                  Membresía & Créditos
                </span>
                <h2 className="mt-1 text-[19px] font-bold text-slate-900">{seleccionada.contactoNombre}</h2>
                <p className="text-[13px] text-slate-500">
                  Plan: <b>{seleccionada.planNombre}</b> · Vigencia: {fechaCorta(seleccionada.inicio)} al{" "}
                  <b>{fechaCorta(seleccionada.fin)}</b>
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[13.5px] font-bold text-slate-900">
                    Saldo:{" "}
                    {seleccionada.esIlimitada
                      ? "Ilimitado"
                      : `${seleccionada.creditosSaldo} de ${seleccionada.creditosTotales ?? "—"} créditos`}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                      seleccionada.estado === "activa"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-amber-50 text-amber-800 border-amber-200"
                    }`}
                  >
                    {seleccionada.estado === "activa" ? "Activa" : "Vencida"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSeleccionada(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* Contenido scrolleable */}
            <div className="max-h-[440px] overflow-y-auto p-5 space-y-6">
              {/* Acciones principales del staff */}
              <div className="flex flex-wrap items-center gap-2 border-b pb-4">
                <button
                  type="button"
                  onClick={() => setMostrarAjuste(!mostrarAjuste)}
                  className="btn-suave px-3 py-1.5 text-[12.5px] font-semibold"
                >
                  {mostrarAjuste ? "Cerrar ajuste" : "Ajuste manual de créditos"}
                </button>

                <form
                  action={async (fd) => {
                    if (confirm(`¿Renovar plan "${seleccionada.planNombre}" para ${seleccionada.contactoNombre}?`)) {
                      setEnviando(true);
                      fd.set("membresiaId", seleccionada.id);
                      await onRenovarMembresia(fd);
                      await recargarDetalle(seleccionada.id);
                      setEnviando(false);
                    }
                  }}
                >
                  <button
                    type="submit"
                    disabled={enviando}
                    className="btn-primario px-3 py-1.5 text-[12.5px]"
                  >
                    Renovar plan
                  </button>
                </form>

                {seleccionada.contactoChatId && (
                  <Link
                    href={`/conversaciones?chat=${encodeURIComponent(seleccionada.contactoChatId)}`}
                    className="btn-suave px-3 py-1.5 text-[12.5px]"
                  >
                    Abrir conversación →
                  </Link>
                )}

                {seleccionada.contactoTelefono && (
                  <a
                    href={`https://wa.me/${seleccionada.contactoTelefono.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-suave px-3 py-1.5 text-[12.5px]"
                  >
                    WhatsApp directo ↗
                  </a>
                )}
              </div>

              {/* Formulario de Ajuste Manual (exige motivo!) */}
              {mostrarAjuste && (
                <form
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  action={async (fd) => {
                    setEnviando(true);
                    setErrorAjuste(null);
                    fd.set("membresiaId", seleccionada.id);
                    const res = await onAjustarCreditos(fd);
                    setEnviando(false);
                    if (res.ok) {
                      setMostrarAjuste(false);
                      await recargarDetalle(seleccionada.id);
                    } else {
                      setErrorAjuste(res.error ?? "No se pudo realizar el ajuste");
                    }
                  }}
                >
                  <div className="text-[13.5px] font-bold text-slate-900">
                    Ajuste manual en el Ledger de Créditos
                  </div>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    Registra un movimiento inmutable auditado. Requiere justificación obligatoria.
                  </p>

                  {errorAjuste && (
                    <div className="mt-2 rounded bg-red-100 p-2 text-[12px] text-red-800">
                      {errorAjuste}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className="text-[11.5px] font-semibold text-slate-600">Delta créditos</label>
                      <input
                        type="number"
                        name="delta"
                        placeholder="+1 o -1"
                        required
                        className="campo mt-1 text-[13px]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11.5px] font-semibold text-slate-600">
                        Motivo obligatorio
                      </label>
                      <input
                        type="text"
                        name="motivo"
                        placeholder="Ej: Compensación por clase cancelada por lluvia"
                        required
                        className="campo mt-1 text-[13px]"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setMostrarAjuste(false)}
                      className="btn-suave px-3 py-1 text-[12px]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={enviando}
                      className="btn-primario px-3 py-1 text-[12px]"
                    >
                      {enviando ? "Guardando en ledger…" : "Aplicar ajuste en ledger"}
                    </button>
                  </div>
                </form>
              )}

              {/* Próximas reservas */}
              <div>
                <h3 className="text-[14px] font-bold text-slate-800">Próximas reservas</h3>
                {seleccionada.proximasReservas.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-slate-400">Sin reservas agendadas a futuro.</p>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {seleccionada.proximasReservas.map((r) => (
                      <div key={r.citaId} className="flex items-center justify-between p-2.5 text-[12.5px]">
                        <div>
                          <span className="font-semibold text-slate-800">{r.servicioNombre}</span>
                          <span className="text-slate-500"> · {fechaHora(r.inicio)}</span>
                        </div>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          {r.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* HISTORIAL DE CRÉDITOS (DESDE ED_CREDITOS_LEDGER) */}
              <div>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[14px] font-bold text-slate-800">
                    Historial de créditos (Ledger inmutable)
                  </h3>
                  <span className="text-[11px] text-slate-400">Fuente oficial de auditoría</span>
                </div>

                {seleccionada.movimientosLedger.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-slate-400">No hay movimientos registrados.</p>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {seleccionada.movimientosLedger.map((m) => {
                      const esPositivo = m.delta > 0;
                      return (
                        <div key={m.id} className="flex items-center justify-between p-2.5 text-[12.5px]">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                  esPositivo
                                    ? "bg-emerald-100 text-emerald-800"
                                    : m.delta < 0
                                      ? "bg-rose-100 text-rose-800"
                                      : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {esPositivo ? `+${m.delta}` : m.delta}
                              </span>
                              <span className="font-semibold text-slate-800">
                                {m.tipoMovimiento === "alta_plan"
                                  ? "Alta de plan"
                                  : m.tipoMovimiento === "consumo_reserva"
                                    ? "Consumo por reserva"
                                    : m.tipoMovimiento === "devolucion_cancelacion"
                                      ? "Devolución por cancelación"
                                      : m.tipoMovimiento === "renovacion"
                                        ? "Renovación"
                                        : "Ajuste manual staff"}
                              </span>
                            </div>
                            {m.motivo && (
                              <div className="mt-0.5 text-[11.5px] text-slate-500">{m.motivo}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-[11.5px] font-semibold text-slate-700">
                              Saldo: {m.saldoResultante}
                            </div>
                            <div className="text-[10.5px] text-slate-400">{fechaHora(m.creadoEn)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Pie modal */}
            <div className="flex justify-end border-t p-4" style={{ borderColor: "var(--borde)" }}>
              <button
                type="button"
                onClick={() => setSeleccionada(null)}
                className="btn-suave px-4 py-2 text-[13.5px]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
