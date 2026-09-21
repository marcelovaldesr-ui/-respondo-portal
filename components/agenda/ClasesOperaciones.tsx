"use client";

import { useState } from "react";
import type { ClaseOperacional, GruposClases, AsistenteClase } from "@/lib/classes/classesOperations";

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function ClasesOperaciones({
  grupos,
  onObtenerDetalle,
  onInscribir,
  onCancelarInscripcion,
  onMarcarAsistencia,
  onMarcarNoShow,
  onCancelarClase,
}: {
  grupos: GruposClases;
  onObtenerDetalle: (claseId: string) => Promise<{ inscritos: AsistenteClase[] } | null>;
  onInscribir: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  onCancelarInscripcion: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  onMarcarAsistencia: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  onMarcarNoShow: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  onCancelarClase: (fd: FormData) => Promise<void>;
}) {
  const [tab, setTab] = useState<"hoy" | "semana" | "proximas">("hoy");
  const [claseSeleccionada, setClaseSeleccionada] = useState<ClaseOperacional | null>(null);
  const [inscritos, setInscritos] = useState<AsistenteClase[]>([]);
  const [cargandoInscritos, setCargandoInscritos] = useState(false);
  const [mostrarInscribir, setMostrarInscribir] = useState(false);
  const [errorOperacion, setErrorOperacion] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const listaActual = tab === "hoy" ? grupos.hoy : tab === "semana" ? grupos.estaSemana : grupos.proximas;

  async function abrirDetalle(clase: ClaseOperacional) {
    setClaseSeleccionada(clase);
    setCargandoInscritos(true);
    setErrorOperacion(null);
    setMostrarInscribir(false);
    try {
      const res = await onObtenerDetalle(clase.id);
      setInscritos(res?.inscritos ?? []);
    } finally {
      setCargandoInscritos(false);
    }
  }

  async function recargarInscritos(claseId: string) {
    setCargandoInscritos(true);
    try {
      const res = await onObtenerDetalle(claseId);
      setInscritos(res?.inscritos ?? []);
    } finally {
      setCargandoInscritos(false);
    }
  }

  return (
    <div>
      {/* ── Filtros de tiempo: Hoy / Esta semana / Próximas ──────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("hoy")}
          className={`rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition ${
            tab === "hoy"
              ? "bg-[var(--azul,#2563eb)] font-bold text-white shadow-sm"
              : "border border-[var(--borde)] bg-white text-[var(--muted)] hover:bg-slate-50"
          }`}
        >
          Hoy ({grupos.hoy.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("semana")}
          className={`rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition ${
            tab === "semana"
              ? "bg-[var(--azul,#2563eb)] font-bold text-white shadow-sm"
              : "border border-[var(--borde)] bg-white text-[var(--muted)] hover:bg-slate-50"
          }`}
        >
          Esta semana ({grupos.estaSemana.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("proximas")}
          className={`rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition ${
            tab === "proximas"
              ? "bg-[var(--azul,#2563eb)] font-bold text-white shadow-sm"
              : "border border-[var(--borde)] bg-white text-[var(--muted)] hover:bg-slate-50"
          }`}
        >
          Próximas ({grupos.proximas.length})
        </button>
      </div>

      {/* ── Lista de clases ──────────────────────────────────────────────── */}
      {listaActual.length === 0 ? (
        <div className="tarjeta p-8 text-center text-[14px]" style={{ color: "var(--muted)" }}>
          {tab === "hoy"
            ? "No hay clases programadas para hoy."
            : tab === "semana"
              ? "No hay más clases programadas para esta semana."
              : "No hay clases programadas a futuro."}
        </div>
      ) : (
        <div className="grid gap-3">
          {listaActual.map((c) => {
            const llena = c.lugaresLibres === 0;
            const pct = c.cupoMaximo > 0 ? Math.round((c.cupoOcupado / c.cupoMaximo) * 100) : 0;
            return (
              <div
                key={c.id}
                className="tarjeta flex flex-wrap items-center justify-between gap-4 p-4 transition hover:border-slate-400"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[16px] font-bold text-[var(--texto)]">{c.servicioNombre}</span>
                    <span className="text-[12.5px] font-medium" style={{ color: "var(--muted)" }}>
                      con {c.profesionalNombre}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[13px]" style={{ color: "var(--muted)" }}>
                    <span className="font-semibold text-slate-700">{cuando(c.inicio)}</span>
                    <span>·</span>
                    <span>Duración: {Math.round((new Date(c.fin).getTime() - new Date(c.inicio).getTime()) / 60000)} min</span>
                  </div>
                </div>

                {/* Ocupación visual */}
                <div className="w-44 shrink-0">
                  <div className="flex items-baseline justify-between text-[12.5px]">
                    <span className="font-bold text-[var(--texto)]">
                      {c.cupoOcupado} / {c.cupoMaximo} inscritos
                    </span>
                    <span
                      className="font-medium text-[11px]"
                      style={{ color: llena ? "var(--peligro, #dc2626)" : "var(--muted)" }}
                    >
                      {llena ? "Lleno" : `Quedan ${c.lugaresLibres}`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, pct)}%`,
                        background: llena ? "var(--peligro, #dc2626)" : "var(--azul, #2563eb)",
                      }}
                    />
                  </div>
                </div>

                {/* Acciones */}
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void abrirDetalle(c)}
                    className="btn-suave px-3.5 py-2 text-[13px] font-semibold"
                  >
                    Ver inscritos ({c.cupoOcupado})
                  </button>
                  <form action={onCancelarClase}>
                    <input type="hidden" name="claseId" value={c.id} />
                    <button
                      type="submit"
                      className="btn-peligro px-3 py-2 text-[12.5px]"
                      onClick={(e) => {
                        if (!confirm(`¿Seguro que deseas cancelar la clase de ${c.servicioNombre}?`)) {
                          e.preventDefault();
                        }
                      }}
                    >
                      Cancelar clase
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL / DETALLE DE CLASE E INSCRITOS ─────────────────────────── */}
      {claseSeleccionada && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-white shadow-2xl" style={{ borderColor: "var(--borde)" }}>
            <div className="flex items-start justify-between border-b p-5" style={{ borderColor: "var(--borde)" }}>
              <div>
                <span className="rounded bg-sky-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sky-800">
                  Clase grupal
                </span>
                <h2 className="mt-1 text-[19px] font-bold text-slate-900">{claseSeleccionada.servicioNombre}</h2>
                <p className="text-[13.5px] text-slate-500">
                  {cuando(claseSeleccionada.inicio)} · Instructor: <b>{claseSeleccionada.profesionalNombre}</b>
                </p>
                <div className="mt-2 flex items-center gap-2 text-[13px] font-medium text-slate-700">
                  <span className="font-bold text-slate-900">{claseSeleccionada.cupoOcupado} / {claseSeleccionada.cupoMaximo}</span>{" "}
                  alumnos inscritos ·{" "}
                  <span className={claseSeleccionada.lugaresLibres === 0 ? "font-bold text-red-600" : "text-emerald-700"}>
                    {claseSeleccionada.lugaresLibres === 0 ? "Sin cupos disponibles" : `${claseSeleccionada.lugaresLibres} cupo(s) libre(s)`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClaseSeleccionada(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {errorOperacion && (
              <div className="border-b bg-red-50 p-3 text-[13px] text-red-700">{errorOperacion}</div>
            )}

            {/* Listado de inscritos */}
            <div className="max-h-[380px] overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-slate-800">Alumnos inscritos</h3>
                <button
                  type="button"
                  onClick={() => setMostrarInscribir(!mostrarInscribir)}
                  className="btn-primario px-3 py-1.5 text-[12.5px]"
                >
                  {mostrarInscribir ? "Cerrar formulario" : "+ Inscribir cliente"}
                </button>
              </div>

              {/* Formulario rápido para inscribir */}
              {mostrarInscribir && (
                <form
                  className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5"
                  action={async (fd) => {
                    setEnviando(true);
                    setErrorOperacion(null);
                    fd.set("claseId", claseSeleccionada.id);
                    const res = await onInscribir(fd);
                    setEnviando(false);
                    if (res.ok) {
                      setMostrarInscribir(false);
                      await recargarInscritos(claseSeleccionada.id);
                    } else {
                      setErrorOperacion(res.error ?? "No se pudo inscribir");
                    }
                  }}
                >
                  <div className="text-[13px] font-bold text-slate-800">Inscribir alumno manualmente</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      name="nombre"
                      placeholder="Nombre completo"
                      required
                      className="campo text-[13px]"
                    />
                    <input
                      name="telefono"
                      placeholder="Teléfono (ej: +569...)"
                      required
                      className="campo text-[13px]"
                    />
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setMostrarInscribir(false)}
                      className="btn-suave px-3 py-1 text-[12px]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={enviando}
                      className="btn-primario px-3 py-1 text-[12px]"
                    >
                      {enviando ? "Inscribiendo…" : "Confirmar inscripción"}
                    </button>
                  </div>
                </form>
              )}

              {cargandoInscritos ? (
                <div className="py-8 text-center text-[13px] text-slate-400">Cargando lista de inscritos…</div>
              ) : inscritos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-[13px] text-slate-500">
                  Todavía no hay alumnos inscritos en esta clase.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {inscritos.map((a) => {
                    const asistio = a.estado === "completada";
                    const noShow = a.estado === "no_show";
                    const cancelada = a.estado === "cancelada";
                    return (
                      <div key={a.citaId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[14px] font-semibold ${cancelada ? "line-through text-slate-400" : "text-slate-800"}`}>
                              {a.nombre}
                            </span>
                            {a.planNombre && (
                              <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                                {a.planNombre}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[12px] text-slate-500">
                            {a.telefono || "Sin teléfono"}
                          </div>
                        </div>

                        {/* Estado y acciones individuales */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                              asistio
                                ? "bg-emerald-100 text-emerald-800"
                                : noShow
                                  ? "bg-rose-100 text-rose-800"
                                  : cancelada
                                    ? "bg-slate-100 text-slate-500"
                                    : "bg-blue-50 text-blue-700"
                            }`}
                          >
                            {asistio ? "Asistió" : noShow ? "No-Show" : cancelada ? "Cancelada" : "Confirmada"}
                          </span>

                          {!cancelada && (
                            <div className="flex items-center gap-1">
                              {!asistio && (
                                <button
                                  type="button"
                                  title="Marcar como presente"
                                  onClick={async () => {
                                    const fd = new FormData();
                                    fd.set("citaId", a.citaId);
                                    await onMarcarAsistencia(fd);
                                    await recargarInscritos(claseSeleccionada.id);
                                  }}
                                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                >
                                  ✓ Vino
                                </button>
                              )}
                              {!noShow && (
                                <button
                                  type="button"
                                  title="Marcar como inasistencia"
                                  onClick={async () => {
                                    const fd = new FormData();
                                    fd.set("citaId", a.citaId);
                                    await onMarcarNoShow(fd);
                                    await recargarInscritos(claseSeleccionada.id);
                                  }}
                                  className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                                >
                                  ✗ No llegó
                                </button>
                              )}
                              <button
                                type="button"
                                title="Cancelar reserva"
                                onClick={async () => {
                                  if (confirm(`¿Cancelar inscripción de ${a.nombre}?`)) {
                                    const fd = new FormData();
                                    fd.set("citaId", a.citaId);
                                    if (a.contactoId) fd.set("contactoId", a.contactoId);
                                    await onCancelarInscripcion(fd);
                                    await recargarInscritos(claseSeleccionada.id);
                                  }
                                }}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t p-4" style={{ borderColor: "var(--borde)" }}>
              <button
                type="button"
                onClick={() => setClaseSeleccionada(null)}
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
