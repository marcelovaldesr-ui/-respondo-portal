"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  ClienteOperacionalFila,
  FichaClienteOperacional,
} from "@/lib/clients/clientsOperations";

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

export default function ClientesOperaciones({
  clientesIniciales,
  onBuscar,
  onObtenerFicha,
  onAjustarCreditos,
  onRenovarMembresia,
}: {
  clientesIniciales: ClienteOperacionalFila[];
  onBuscar: (q: string) => Promise<ClienteOperacionalFila[]>;
  onObtenerFicha: (contactoId: string) => Promise<FichaClienteOperacional | null>;
  onAjustarCreditos: (fd: FormData) => Promise<{ ok: boolean; nuevoSaldo?: number; error?: string }>;
  onRenovarMembresia: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [clientes, setClientes] = useState(clientesIniciales);
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [ficha, setFicha] = useState<FichaClienteOperacional | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [mostrarAjuste, setMostrarAjuste] = useState(false);
  const [errorAjuste, setErrorAjuste] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function buscar(texto: string) {
    setBusqueda(texto);
    setBuscando(true);
    try {
      const res = await onBuscar(texto);
      setClientes(res);
    } finally {
      setBuscando(false);
    }
  }

  async function abrirFicha(contactoId: string) {
    setCargandoFicha(true);
    setMostrarAjuste(false);
    setErrorAjuste(null);
    try {
      const datos = await onObtenerFicha(contactoId);
      setFicha(datos);
    } finally {
      setCargandoFicha(false);
    }
  }

  async function recargarFicha(contactoId: string) {
    setCargandoFicha(true);
    try {
      const datos = await onObtenerFicha(contactoId);
      setFicha(datos);
    } finally {
      setCargandoFicha(false);
    }
  }

  return (
    <div>
      {/* ── Buscador de clientes ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-md">
          <input
            type="text"
            placeholder="Buscar por nombre, teléfono o email…"
            value={busqueda}
            onChange={(e) => void buscar(e.target.value)}
            className="campo text-[13.5px]"
          />
        </div>
        <div className="text-[13px] text-slate-500">
          {buscando ? "Buscando…" : `${clientes.length} clientes encontrados`}
        </div>
      </div>

      {/* ── Tabla operacional de clientes ───────────────────────────────── */}
      <div className="tarjeta mt-4 overflow-hidden">
        {clientes.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-slate-500">
            {busqueda.trim()
              ? "No se encontraron clientes con esos datos."
              : "No hay clientes registrados aún."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11.5px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="p-3.5 pl-4">Cliente</th>
                  <th className="p-3.5">Teléfono / WhatsApp</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5">Membresía / Plan</th>
                  <th className="p-3.5">Créditos</th>
                  <th className="p-3.5 pr-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientes.map((c) => (
                  <tr key={c.contactoId} className="transition hover:bg-slate-50/80">
                    <td className="p-3.5 pl-4 font-semibold text-slate-900">
                      {c.nombre}
                    </td>
                    <td className="p-3.5 text-slate-600">
                      {c.telefono || c.chatId || "—"}
                    </td>
                    <td className="p-3.5 text-slate-500">
                      {c.email || "—"}
                    </td>
                    <td className="p-3.5">
                      {c.membresia ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800">{c.membresia.planNombre}</span>
                          <span
                            className={`rounded border px-1.5 py-0.2 text-[10.5px] font-semibold ${
                              c.membresia.estado === "activa"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : "bg-amber-50 text-amber-800 border-amber-200"
                            }`}
                          >
                            {c.membresia.estado}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">Sin membresía</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      {c.membresia ? (
                        c.membresia.esIlimitada ? (
                          <span className="font-bold text-indigo-700">Ilimitado</span>
                        ) : (
                          <span className="font-bold text-slate-900">
                            {c.membresia.creditosSaldo} / {c.membresia.creditosTotales ?? "—"}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-3.5 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => void abrirFicha(c.contactoId)}
                        className="btn-suave px-3 py-1 text-[12.5px] font-semibold"
                      >
                        Ver ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL / FICHA OPERACIONAL DEL CLIENTE ─────────────────────── */}
      {cargandoFicha && !ficha && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
          <div className="rounded-lg bg-white p-6 shadow-xl text-[14px] text-slate-700 font-semibold">
            Cargando ficha de cliente…
          </div>
        </div>
      )}

      {ficha && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-white shadow-2xl" style={{ borderColor: "var(--borde)" }}>
            {/* Cabecera */}
            <div className="flex items-start justify-between border-b p-5" style={{ borderColor: "var(--borde)" }}>
              <div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Ficha de cliente
                </span>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">{ficha.nombre}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-slate-500">
                  <span>Tel: <b>{ficha.telefono || ficha.chatId || "Sin teléfono"}</b></span>
                  {ficha.email && <span>· Email: <b>{ficha.email}</b></span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFicha(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* Contenido scrolleable */}
            <div className="max-h-[460px] overflow-y-auto p-5 space-y-6">
              {/* Acciones principales */}
              <div className="flex flex-wrap items-center gap-2 border-b pb-4">
                {ficha.chatId && (
                  <Link
                    href={`/conversaciones?chat=${encodeURIComponent(ficha.chatId)}`}
                    className="btn-primario px-3 py-1.5 text-[12.5px]"
                  >
                    Abrir conversación →
                  </Link>
                )}

                {ficha.telefono && (
                  <a
                    href={`https://wa.me/${ficha.telefono.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-suave px-3 py-1.5 text-[12.5px]"
                  >
                    WhatsApp ↗
                  </a>
                )}

                {ficha.membresia && (
                  <>
                    <button
                      type="button"
                      onClick={() => setMostrarAjuste(!mostrarAjuste)}
                      className="btn-suave px-3 py-1.5 text-[12.5px]"
                    >
                      {mostrarAjuste ? "Cerrar ajuste" : "Ajustar créditos"}
                    </button>
                    <form
                      action={async (fd) => {
                        if (confirm(`¿Renovar plan "${ficha.membresia?.planNombre}"?`)) {
                          setEnviando(true);
                          fd.set("membresiaId", ficha.membresia!.id);
                          await onRenovarMembresia(fd);
                          await recargarFicha(ficha.contactoId);
                          setEnviando(false);
                        }
                      }}
                    >
                      <button
                        type="submit"
                        disabled={enviando}
                        className="btn-suave px-3 py-1.5 text-[12.5px]"
                      >
                        Renovar membresía
                      </button>
                    </form>
                  </>
                )}
              </div>

              {/* Formulario de Ajuste de Crédito */}
              {mostrarAjuste && ficha.membresia && (
                <form
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  action={async (fd) => {
                    setEnviando(true);
                    setErrorAjuste(null);
                    fd.set("membresiaId", ficha.membresia!.id);
                    const res = await onAjustarCreditos(fd);
                    setEnviando(false);
                    if (res.ok) {
                      setMostrarAjuste(false);
                      await recargarFicha(ficha.contactoId);
                    } else {
                      setErrorAjuste(res.error ?? "No se pudo realizar el ajuste");
                    }
                  }}
                >
                  <div className="text-[13.5px] font-bold text-slate-900">
                    Ajuste de créditos para {ficha.nombre}
                  </div>
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
                      <label className="text-[11.5px] font-semibold text-slate-600">Motivo</label>
                      <input
                        type="text"
                        name="motivo"
                        placeholder="Motivo obligatorio"
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
                      {enviando ? "Guardando…" : "Aplicar en ledger"}
                    </button>
                  </div>
                </form>
              )}

              {/* Bloque Membresía */}
              <div>
                <h3 className="text-[14px] font-bold text-slate-800">Membresía</h3>
                {ficha.membresia ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[15px] font-bold text-slate-900">
                        {ficha.membresia.planNombre}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                          ficha.membresia.estado === "activa"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }`}
                      >
                        {ficha.membresia.estado}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
                      <div>
                        <span className="text-slate-500">Saldo actual:</span>{" "}
                        <b className="text-slate-900">
                          {ficha.membresia.esIlimitada
                            ? "Ilimitado"
                            : `${ficha.membresia.creditosSaldo} de ${ficha.membresia.creditosTotales ?? "—"} créditos`}
                        </b>
                      </div>
                      <div>
                        <span className="text-slate-500">Vigencia hasta:</span>{" "}
                        <b className="text-slate-900">{fechaCorta(ficha.membresia.fin)}</b>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-[12.5px] text-slate-400">Este cliente no tiene membresía activa.</p>
                )}
              </div>

              {/* Próximas reservas */}
              <div>
                <h3 className="text-[14px] font-bold text-slate-800">Próximas reservas</h3>
                {ficha.proximasReservas.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-slate-400">Sin reservas agendadas por delante.</p>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {ficha.proximasReservas.map((r) => (
                      <div key={r.citaId} className="flex items-center justify-between p-2.5 text-[12.5px]">
                        <div>
                          <span className="font-semibold text-slate-800">{r.servicioNombre}</span>
                          {r.esClase && (
                            <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-700">
                              Clase
                            </span>
                          )}
                          <div className="text-slate-500">{fechaHora(r.inicio)}</div>
                        </div>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {r.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Historial reciente */}
              <div>
                <h3 className="text-[14px] font-bold text-slate-800">Historial reciente</h3>
                {ficha.historialReciente.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-slate-400">Sin historial registrado.</p>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {ficha.historialReciente.map((h) => (
                      <div key={h.citaId} className="flex items-center justify-between p-2.5 text-[12.5px]">
                        <div>
                          <span className="font-semibold text-slate-800">{h.servicioNombre}</span>
                          <div className="text-slate-500">{fechaHora(h.inicio)}</div>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          {h.estado}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagos */}
              <div>
                <h3 className="text-[14px] font-bold text-slate-800">Pagos</h3>
                {ficha.pagos.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-slate-400">Sin cobros registrados.</p>
                ) : (
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {ficha.pagos.map((p) => (
                      <div key={p.pagoId} className="flex items-center justify-between p-2.5 text-[12.5px]">
                        <div>
                          <span className="font-semibold text-slate-800">{p.concepto}</span>
                          <div className="text-slate-500">{fechaCorta(p.creadoEn)} · {p.proveedor}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-slate-900">${p.monto.toLocaleString("es-CL")}</div>
                          <span className={`text-[11px] font-semibold ${p.estado === "pagado" ? "text-emerald-700" : "text-amber-700"}`}>
                            {p.estado}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Pie */}
            <div className="flex justify-end border-t p-4" style={{ borderColor: "var(--borde)" }}>
              <button
                type="button"
                onClick={() => setFicha(null)}
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
