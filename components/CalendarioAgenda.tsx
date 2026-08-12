"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fechaChileDe, horaChileAUtc, ZONA_AGENDA } from "@/lib/agendaCore";
import { repartirEnCarriles } from "@/lib/calendarioCarriles";

/**
 * CALENDARIO DE LA AGENDA — la vista que hace que esto se sienta software de
 * agendamiento y no una lista de filas.
 *
 * Decisiones de diseño (referencia: AgendaPro, Fresha, Google Calendar):
 *  - Grilla real: el eje vertical es el tiempo y cada cita ocupa el alto que
 *    dura. De un vistazo se ve la carga del día y los huecos.
 *  - Tres vistas: LISTA (lo más directo para saber "qué tengo por delante"),
 *    DÍA (una columna por profesional, para repartir el trabajo) y SEMANA (una
 *    columna por día, para ver la ocupación general).
 *  - Nunca se aterriza en una semana vacía: si la semana de hoy no tiene horas
 *    pero sí las hay más adelante, el calendario parte ahí y lo dice.
 *  - Las reservas se leen SOLAS: barra de color por profesional, fondo por
 *    estado, hora y nombre siempre visibles, y una leyenda que explica cada
 *    color. Era el reclamo de la primera versión.
 *
 * Todo se calcula en hora de Chile con Intl, nunca con el reloj del navegador
 * (un cliente en otro huso vería las horas corridas).
 */

export type CitaCal = {
  id: string;
  inicio: string;
  fin: string;
  estado: string;
  origen: string;
  nombre: string;
  telefono: string | null;
  servicio: string;
  profesionalId: string;
  profesional: string;
  /** Ficha del servicio respondida al reservar (migración 277). */
  datosExtra?: Record<string, string> | null;
};

export type ProfCal = { id: string; nombre: string };

/** Horario de atención por día de la semana (0=domingo), en minutos. */
export type FranjaSemanal = { diaSemana: number; desdeMin: number; hastaMin: number };

type Vista = "lista" | "dia" | "semana";

const PX_POR_MIN = 1.5; // 30 min = 45 px: cómodo sin desperdiciar pantalla
const MARGEN = 12; // aire arriba y abajo para que la 1ª y última hora no se corten
const PALETA = ["#4f46e5", "#0d9488", "#b84a86", "#b45309", "#2563eb", "#7c3aed"];

const ACTIVOS = ["agendada", "confirmada", "reagendada"];

/**
 * Colores por estado. Se subió el contraste respecto de la primera versión:
 * con los tonos pastel de antes los bloques se confundían con la grilla y no
 * se distinguía una hora confirmada de una por confirmar.
 */
const ESTILO_ESTADO: Record<string, { etiqueta: string; fondo: string; borde: string; texto: string }> = {
  agendada: { etiqueta: "Por confirmar", fondo: "#e0e7ff", borde: "#4f46e5", texto: "#312e81" },
  confirmada: { etiqueta: "Confirmada", fondo: "#d1fae5", borde: "#059669", texto: "#065f46" },
  reagendada: { etiqueta: "Reagendada", fondo: "#e0e7ff", borde: "#4f46e5", texto: "#312e81" },
  completada: { etiqueta: "Ya vino", fondo: "#e2e8f0", borde: "#64748b", texto: "#334155" },
  cancelada: { etiqueta: "Cancelada", fondo: "#f1f5f9", borde: "#cbd5e1", texto: "#94a3b8" },
  no_show: { etiqueta: "No llegó", fondo: "#fee2e2", borde: "#dc2626", texto: "#991b1b" },
};

const LEYENDA = ["agendada", "confirmada", "completada", "no_show", "cancelada"];

const HATCH = "repeating-linear-gradient(45deg,#f8fafc,#f8fafc 6px,#f1f5f9 6px,#f1f5f9 12px)";

// ---------------------------------------------------------------------------
// Helpers de fecha (siempre en hora de Chile)
// ---------------------------------------------------------------------------

const dtfHora = new Intl.DateTimeFormat("es-CL", {
  timeZone: ZONA_AGENDA, hour: "2-digit", minute: "2-digit", hour12: false,
});

function minutosDelDia(iso: string): number {
  const p = dtfHora.format(new Date(iso)).split(":");
  return Number(p[0]) * 60 + Number(p[1]);
}
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function claveDia(iso: string): string {
  const f = fechaChileDe(new Date(iso));
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
}
function claveDeFecha(f: { anio: number; mes: number; dia: number }): string {
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
}
/** Suma días de calendario sin que el cambio de hora mueva el resultado. */
function sumarDias(f: { anio: number; mes: number; dia: number }, n: number) {
  const mediodia = horaChileAUtc(f.anio, f.mes, f.dia, 12, 0).getTime();
  return fechaChileDe(new Date(mediodia + n * 86_400_000));
}
function etiquetaDia(f: { anio: number; mes: number; dia: number }, largo = false): string {
  const d = horaChileAUtc(f.anio, f.mes, f.dia, 12, 0);
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    weekday: largo ? "long" : "short",
    day: "numeric",
    ...(largo ? { month: "long" } : {}),
  }).format(d);
}
/** Solo la primera letra en mayúscula. NO usar la clase `capitalize` de CSS:
 *  deja "Lunes, 27 De Julio", que en español está mal. */
function mayus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Lunes de la semana que contiene esa fecha. */
function lunesDe(f: { anio: number; mes: number; dia: number; diaSemana: number }) {
  return sumarDias(f, f.diaSemana === 0 ? -6 : 1 - f.diaSemana);
}
function estilo(estado: string) {
  return ESTILO_ESTADO[estado] ?? ESTILO_ESTADO.agendada;
}

// ---------------------------------------------------------------------------

export default function CalendarioAgenda({
  citas,
  profesionales,
  franjas,
  accionEstado,
  accionReabrir,
}: {
  citas: CitaCal[];
  profesionales: ProfCal[];
  franjas: FranjaSemanal[];
  accionEstado: (formData: FormData) => Promise<void>;
  accionReabrir: (formData: FormData) => Promise<void>;
}) {
  const hoy = fechaChileDe(new Date());
  const [vista, setVista] = useState<Vista>("semana");
  const [ancla, setAncla] = useState(hoy);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const yaOriento = useRef(false);

  const ahoraMs = Date.now();

  /** Próxima cita activa: la que el dueño quiere ver primero. */
  const proxima = useMemo(
    () =>
      citas
        .filter((c) => ACTIVOS.includes(c.estado) && Date.parse(c.inicio) >= ahoraMs)
        .sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null,
    [citas, ahoraMs],
  );

  /**
   * Orientación inicial (una sola vez, en el cliente):
   *  - En celular la semana no cabe → se parte en Día.
   *  - Si la semana/día de hoy no tiene ninguna hora pero sí las hay más
   *    adelante, se salta a la próxima. Aterrizar en una grilla vacía hacía
   *    parecer que la agenda no tenía nada.
   */
  useEffect(() => {
    if (yaOriento.current) return;
    yaOriento.current = true;

    const angosto = typeof window !== "undefined" && window.innerWidth < 900;
    const v: Vista = angosto ? "dia" : "semana";
    setVista(v);

    const clavesFoco = new Set<string>();
    if (v === "dia") clavesFoco.add(claveDeFecha(hoy));
    else {
      const lun = lunesDe(hoy);
      for (let i = 0; i < 7; i++) clavesFoco.add(claveDeFecha(sumarDias(lun, i)));
    }
    const hayEnFoco = citas.some(
      (c) => ACTIVOS.includes(c.estado) && clavesFoco.has(claveDia(c.inicio)),
    );
    if (!hayEnFoco && proxima) setAncla(fechaChileDe(new Date(proxima.inicio)));
    // Solo al montar: después el dueño manda con ‹ › y no queremos moverle la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape cierra el panel de detalle.
  useEffect(() => {
    if (!seleccionada) return;
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && setSeleccionada(null);
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [seleccionada]);

  const colorProf = useMemo(() => {
    const m = new Map<string, string>();
    profesionales.forEach((p, i) => m.set(p.id, PALETA[i % PALETA.length]));
    return m;
  }, [profesionales]);

  // Días visibles: 7 en semana (lunes a domingo), 1 en día.
  const dias = useMemo(() => {
    if (vista !== "semana") return [ancla];
    const lun = lunesDe(fechaChileDe(horaChileAUtc(ancla.anio, ancla.mes, ancla.dia, 12, 0)));
    return Array.from({ length: 7 }, (_, i) => sumarDias(lun, i));
  }, [vista, ancla]);

  const clavesVisibles = useMemo(() => new Set(dias.map(claveDeFecha)), [dias]);

  // Rango horario de la grilla: el horario real del negocio, con algo de aire.
  const { inicioGrilla, finGrilla } = useMemo(() => {
    const relevantes = franjas.filter((f) => dias.some((d) => {
      const dow = fechaChileDe(horaChileAUtc(d.anio, d.mes, d.dia, 12, 0)).diaSemana;
      return dow === f.diaSemana;
    }));
    const base = relevantes.length ? relevantes : franjas;
    let min = base.length ? Math.min(...base.map((f) => f.desdeMin)) : 9 * 60;
    let max = base.length ? Math.max(...base.map((f) => f.hastaMin)) : 20 * 60;
    // Que ninguna cita quede fuera de la grilla (ej. una cita manual a las 8).
    for (const c of citas) {
      if (!clavesVisibles.has(claveDia(c.inicio))) continue;
      min = Math.min(min, minutosDelDia(c.inicio));
      max = Math.max(max, minutosDelDia(c.fin) || 24 * 60);
    }
    return {
      inicioGrilla: Math.max(0, Math.floor((min - 30) / 60) * 60),
      finGrilla: Math.min(24 * 60, Math.ceil((max + 30) / 60) * 60),
    };
  }, [franjas, dias, citas, clavesVisibles]);

  const totalMin = Math.max(60, finGrilla - inicioGrilla);
  const alto = totalMin * PX_POR_MIN + MARGEN * 2;
  /** Píxeles desde el borde superior de la columna para un minuto del día. */
  const posY = (min: number) => MARGEN + (min - inicioGrilla) * PX_POR_MIN;

  const horas = useMemo(() => {
    const out: number[] = [];
    for (let m = inicioGrilla; m <= finGrilla; m += 60) out.push(m);
    return out;
  }, [inicioGrilla, finGrilla]);

  // Columnas: profesionales (día) o días (semana).
  const columnas = useMemo(() => {
    if (vista === "dia") {
      const activos = profesionales.length ? profesionales : [{ id: "—", nombre: "Sin profesionales" }];
      return activos.map((p) => ({ clave: p.id, titulo: p.nombre, esProf: true }));
    }
    return dias.map((d) => ({ clave: claveDeFecha(d), titulo: mayus(etiquetaDia(d)), esProf: false }));
  }, [vista, profesionales, dias]);

  const citasVisibles = useMemo(
    () => citas.filter((c) => clavesVisibles.has(claveDia(c.inicio))),
    [citas, clavesVisibles],
  );

  function citasDeColumna(clave: string): CitaCal[] {
    return vista === "dia"
      ? citasVisibles.filter((c) => c.profesionalId === clave)
      : citasVisibles.filter((c) => claveDia(c.inicio) === clave);
  }

  /** Minutos en los que el negocio SÍ atiende, por columna. */
  function franjaAbierta(clave: string): { desde: number; hasta: number } | null {
    const f = vista === "dia" ? ancla : (() => {
      const [a, m, d] = clave.split("-").map(Number);
      return { anio: a, mes: m, dia: d };
    })();
    const dow = fechaChileDe(horaChileAUtc(f.anio, f.mes, f.dia, 12, 0)).diaSemana;
    const delDia = franjas.filter((x) => x.diaSemana === dow);
    if (delDia.length === 0) return null;
    return {
      desde: Math.min(...delDia.map((x) => x.desdeMin)),
      hasta: Math.max(...delDia.map((x) => x.hastaMin)),
    };
  }

  const claveHoy = claveDeFecha(hoy);
  const ahoraMin = minutosDelDia(new Date().toISOString());
  const detalle = citas.find((c) => c.id === seleccionada) ?? null;

  const tituloRango =
    vista === "lista"
      ? "Próximas reservas"
      : vista === "dia"
        ? mayus(etiquetaDia(ancla, true))
        : mayus(`${etiquetaDia(dias[0], true)} — ${etiquetaDia(dias[6], true)}`);

  const mover = (n: number) => setAncla(sumarDias(ancla, vista === "dia" ? n : n * 7));
  const irA = (iso: string) => {
    setAncla(fechaChileDe(new Date(iso)));
    setVista((v) => (v === "lista" ? "dia" : v));
  };

  // ── Vista LISTA: próximas reservas en orden ─────────────────────────
  const porDiaLista = useMemo(() => {
    const desde = ahoraMs - 12 * 3600_000; // lo de hoy más temprano sigue siendo útil
    const futuras = citas
      .filter((c) => Date.parse(c.fin) >= desde && c.estado !== "cancelada")
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    const m = new Map<string, CitaCal[]>();
    for (const c of futuras) {
      const k = claveDia(c.inicio);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [citas, ahoraMs]);

  return (
    <div>
      {/* ── Barra de control ─────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {vista !== "lista" && (
          <div className="flex items-center gap-1 rounded-[7px] border bg-white p-1" style={{ borderColor: "var(--borde)" }}>
            <button onClick={() => mover(-1)} className="rounded-lg px-2.5 py-1.5 text-[15px] font-bold hover:bg-slate-50" aria-label="Anterior">‹</button>
            <button
              onClick={() => setAncla(hoy)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-bold hover:bg-slate-50"
              style={{ color: "var(--indigo)" }}
            >
              Hoy
            </button>
            <button onClick={() => mover(1)} className="rounded-lg px-2.5 py-1.5 text-[15px] font-bold hover:bg-slate-50" aria-label="Siguiente">›</button>
          </div>
        )}

        {/* En celular el título se va a su propia línea: entre las dos botoneras
            no le quedan más de 60 px y salía cortado ("Vierne…"). */}
        <div className="h-seccion order-last w-full min-w-0 truncate sm:order-none sm:w-auto sm:flex-1">
          {tituloRango}
        </div>

        <div className="flex items-center gap-1 rounded-[7px] border bg-white p-1" style={{ borderColor: "var(--borde)" }}>
          {([["lista", "Lista"], ["dia", "Día"], ["semana", "Semana"]] as const).map(([v, t]) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-bold transition"
              style={vista === v
                ? { background: "var(--indigo)", color: "#fff", boxShadow: "var(--glow-indigo)" }
                : { color: "var(--muted)" }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Aviso cuando el tramo visible está vacío pero sí hay horas más adelante:
          sin esto el dueño ve una grilla en blanco y cree que no tiene nada. */}
      {vista !== "lista" && citasVisibles.length === 0 && proxima && (
        <button
          onClick={() => irA(proxima.inicio)}
          className="mb-3 flex w-full flex-wrap items-center gap-2 rounded-[7px] border p-3 text-left text-[13.5px]"
          style={{ borderColor: "var(--borde)", background: "var(--indigo-suave)" }}
        >
          <span className="font-bold" style={{ color: "var(--indigo)" }}>
            Aquí no hay horas.
          </span>
          <span style={{ color: "var(--muted)" }}>
            La próxima es el {etiquetaDia(fechaChileDe(new Date(proxima.inicio)), true)} a las{" "}
            {hhmm(minutosDelDia(proxima.inicio))} — {proxima.nombre}.
          </span>
          <span className="ml-auto font-bold" style={{ color: "var(--indigo)" }}>Ir →</span>
        </button>
      )}

      {/* Leyendas: qué significa cada color */}
      {vista !== "lista" && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {profesionales.length > 1 && vista === "semana" && (
            <div className="flex flex-wrap items-center gap-3">
              {profesionales.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "var(--muted)" }}>
                  <span className="inline-block h-3 w-[3px] rounded-full" style={{ background: colorProf.get(p.id) }} />
                  {p.nombre}
                </span>
              ))}
              <span className="h-3 w-px" style={{ background: "var(--borde-fuerte)" }} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            {LEYENDA.map((e) => (
              <span key={e} className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
                <span
                  className="inline-block h-3.5 w-4 rounded-[3px]"
                  style={{ background: estilo(e).fondo, borderLeft: `3px solid ${estilo(e).borde}` }}
                />
                {estilo(e).etiqueta}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── LISTA ────────────────────────────────────────────────────── */}
      {vista === "lista" ? (
        porDiaLista.length === 0 ? (
          <div className="tarjeta p-8 text-center">
            <p className="text-[15px] font-bold">Todavía no hay horas por delante.</p>
            <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
              Cuando alguien reserve por WhatsApp o por tu página, aparecerá aquí.
            </p>
          </div>
        ) : (
          <div className="grid gap-5">
            {porDiaLista.map(([clave, delDia]) => {
              const f = fechaChileDe(new Date(delDia[0].inicio));
              const esHoy = clave === claveHoy;
              return (
                <section key={clave}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-[15px] font-semibold" style={{ color: esHoy ? "var(--indigo)" : "var(--tinta)" }}>
                      {esHoy ? "Hoy" : mayus(etiquetaDia(f, true))}
                    </h3>
                    <span className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                      {delDia.length} {delDia.length === 1 ? "reserva" : "reservas"}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {delDia.map((c) => {
                      const est = estilo(c.estado);
                      const pasada = Date.parse(c.fin) < ahoraMs;
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSeleccionada(c.id)}
                          className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-[7px] border bg-white p-4 text-left transition hover:shadow-md"
                          style={{
                            borderColor: "var(--borde)",
                            borderLeft: `5px solid ${colorProf.get(c.profesionalId) ?? est.borde}`,
                            opacity: pasada ? 0.72 : 1,
                          }}
                        >
                          <div className="w-[64px] shrink-0">
                            <div className="cifra text-[15px] font-semibold leading-none">
                              {hhmm(minutosDelDia(c.inicio))}
                            </div>
                            <div className="mt-1 text-[11.5px] tabular-nums" style={{ color: "var(--muted-2)" }}>
                              {hhmm(minutosDelDia(c.fin))}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-semibold">{c.nombre}</div>
                            <div className="mt-0.5 truncate text-[13px]" style={{ color: "var(--muted)" }}>
                              {c.servicio} · con {c.profesional}
                            </div>
                            <div className="mt-0.5 truncate text-[12px]" style={{ color: "var(--muted-2)" }}>
                              {c.telefono ?? "sin teléfono"} · reservó por {c.origen}
                            </div>
                          </div>
                          {/* En celular el estado baja a su propia línea: si no,
                              se come el ancho del servicio y todo sale cortado. */}
                          <span className="basis-full pl-[80px] sm:ml-auto sm:basis-auto sm:pl-0">
                            <span className="pildora" style={{ background: est.fondo, color: est.texto }}>
                              {est.etiqueta}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : (
        /* ── GRILLA ─────────────────────────────────────────────────── */
        <div className="tarjeta overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: vista === "semana" ? 820 : 340 }}>
              {/* Encabezado de columnas */}
              <div
                className="grid border-b bg-white"
                style={{ gridTemplateColumns: `58px repeat(${columnas.length}, minmax(0,1fr))`, borderColor: "var(--borde)" }}
              >
                <div />
                {columnas.map((col) => {
                  const esHoy = !col.esProf && col.clave === claveHoy;
                  const cuenta = citasDeColumna(col.clave).filter((c) => c.estado !== "cancelada").length;
                  return (
                    <div
                      key={col.clave}
                      className="border-l px-2 py-2.5 text-center"
                      style={{ borderColor: "var(--borde)", background: esHoy ? "var(--indigo-suave)" : undefined }}
                    >
                      <div className="truncate text-[13px] font-bold" style={{ color: esHoy ? "var(--indigo)" : "var(--tinta)" }}>
                        {col.titulo}
                      </div>
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-semibold" style={{ color: cuenta ? "var(--muted)" : "var(--muted-2)" }}>
                        {col.esProf && (
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorProf.get(col.clave) }} />
                        )}
                        {cuenta === 0 ? "sin horas" : `${cuenta} ${cuenta === 1 ? "reserva" : "reservas"}`}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Cuerpo */}
              <div className="relative grid" style={{ gridTemplateColumns: `58px repeat(${columnas.length}, minmax(0,1fr))` }}>
                {/* Eje de horas */}
                <div className="relative" style={{ height: alto }}>
                  {horas.map((m) => (
                    <div
                      key={m}
                      className="absolute right-2 -translate-y-1/2 text-[11.5px] font-semibold tabular-nums"
                      style={{ top: posY(m), color: "var(--muted-2)" }}
                    >
                      {hhmm(m)}
                    </div>
                  ))}
                </div>

                {/* Columnas */}
                {columnas.map((col) => {
                  const abierta = franjaAbierta(col.clave);
                  const lista = repartirEnCarriles(citasDeColumna(col.clave));
                  const esHoyCol = vista === "dia" ? claveDeFecha(ancla) === claveHoy : col.clave === claveHoy;
                  return (
                    <div
                      key={col.clave}
                      className="relative border-l"
                      style={{
                        height: alto,
                        borderColor: "var(--borde)",
                        background: !col.esProf && esHoyCol ? "rgba(79,70,229,0.03)" : undefined,
                      }}
                    >
                      {/* Fuera de horario */}
                      {abierta ? (
                        <>
                          <div className="absolute inset-x-0" style={{ top: 0, height: Math.max(0, posY(abierta.desde)), background: HATCH }} />
                          <div className="absolute inset-x-0" style={{ top: posY(abierta.hasta), bottom: 0, background: HATCH }} />
                        </>
                      ) : (
                        <div className="absolute inset-0" style={{ background: HATCH }} />
                      )}

                      {/* Líneas de hora y media hora */}
                      {Array.from({ length: Math.ceil(totalMin / 30) + 1 }, (_, i) => {
                        const m = inicioGrilla + i * 30;
                        const enPunto = m % 60 === 0;
                        return (
                          <div
                            key={m}
                            className="absolute inset-x-0"
                            style={{
                              top: posY(m),
                              borderTop: `1px ${enPunto ? "solid" : "dashed"} ${enPunto ? "var(--borde)" : "#f1f5f9"}`,
                            }}
                          />
                        );
                      })}

                      {/* Línea de ahora */}
                      {esHoyCol && ahoraMin >= inicioGrilla && ahoraMin <= finGrilla && (
                        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: posY(ahoraMin) }}>
                          <div className="h-[2px] w-full" style={{ background: "var(--coral)" }} />
                          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ background: "var(--coral)" }} />
                        </div>
                      )}

                      {/* Citas */}
                      {lista.map(({ cita, carril, carriles }) => {
                        const ini = minutosDelDia(cita.inicio);
                        const finRaw = minutosDelDia(cita.fin);
                        const fin = finRaw > ini ? finRaw : 24 * 60;
                        const est = estilo(cita.estado);
                        const anulada = cita.estado === "cancelada" || cita.estado === "no_show";
                        const altoBloque = Math.max(22, (fin - ini) * PX_POR_MIN - 3);
                        const lineas = altoBloque >= 62 ? 3 : altoBloque >= 38 ? 2 : 1;
                        const activa = seleccionada === cita.id;
                        const barra = vista === "semana" ? (colorProf.get(cita.profesionalId) ?? est.borde) : est.borde;
                        return (
                          <button
                            key={cita.id}
                            onClick={() => setSeleccionada(cita.id)}
                            className="absolute overflow-hidden rounded-lg py-1 text-left leading-tight transition hover:z-30 hover:shadow-lg"
                            style={{
                              paddingLeft: carriles > 1 ? 5 : 8,
                              paddingRight: carriles > 1 ? 3 : 8,
                              top: posY(ini) + 1,
                              height: altoBloque,
                              left: `calc(${(carril / carriles) * 100}% + 3px)`,
                              width: `calc(${100 / carriles}% - 6px)`,
                              background: est.fondo,
                              borderLeft: `4px solid ${barra}`,
                              color: est.texto,
                              opacity: anulada ? 0.7 : 1,
                              zIndex: activa ? 30 : 5,
                              boxShadow: activa
                                ? "0 0 0 2px var(--indigo)"
                                : "0 1px 2px rgba(15,23,42,0.10)",
                            }}
                            title={`${hhmm(ini)}–${hhmm(fin)} · ${cita.nombre} · ${cita.servicio} · ${cita.profesional} · ${est.etiqueta}`}
                          >
                            {lineas === 1 ? (
                              <div className={`truncate text-[11px] font-semibold ${anulada ? "line-through" : ""}`}>
                                <span className="tabular-nums">{hhmm(ini)}</span> {cita.nombre}
                              </div>
                            ) : (
                              <>
                                {/* Con carriles el bloque va a media columna o menos:
                                    ahí el rango completo no cabe y solo estorba. */}
                                <div className="truncate text-[10.5px] font-bold tabular-nums" style={{ opacity: 0.8 }}>
                                  {carriles > 1 ? hhmm(ini) : `${hhmm(ini)}–${hhmm(fin)}`}
                                </div>
                                <div
                                  className={`truncate font-semibold ${anulada ? "line-through" : ""}`}
                                  style={{ fontSize: carriles > 1 ? "11.5px" : "12.5px" }}
                                >
                                  {cita.nombre}
                                </div>
                                {lineas === 3 && (
                                  <div className="truncate text-[11px]" style={{ opacity: 0.85 }}>
                                    {cita.servicio}
                                    {vista === "semana" ? ` · ${cita.profesional}` : ""}
                                  </div>
                                )}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {vista !== "lista" && citasVisibles.length === 0 && !proxima && (
        <p className="mt-3 text-center text-[13.5px]" style={{ color: "var(--muted-2)" }}>
          Todavía no hay reservas. Cuando alguien agende por WhatsApp o por tu página, aparecerá aquí.
        </p>
      )}

      {/* ── Panel lateral de detalle ─────────────────────────────────── */}
      {detalle && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "rgba(15,23,42,0.35)" }}
          onClick={(e) => e.target === e.currentTarget && setSeleccionada(null)}
        >
          <aside
            className="h-full w-full max-w-[420px] overflow-y-auto bg-white p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de la reserva"
            style={{ boxShadow: "-20px 0 50px -25px rgba(15,23,42,0.4)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="pildora" style={{ background: estilo(detalle.estado).fondo, color: estilo(detalle.estado).texto }}>
                {estilo(detalle.estado).etiqueta}
              </span>
              <button onClick={() => setSeleccionada(null)} className="btn-suave px-2.5 py-1.5 text-[12px]">
                Cerrar
              </button>
            </div>

            <h3 className="h-cifra">{detalle.nombre}</h3>
            <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
              {detalle.servicio}
            </p>

            <div className="mt-4 rounded-[7px] border p-4" style={{ borderColor: "var(--borde)", background: "#fbfcfe" }}>
              <Dato
                etiqueta="Cuándo"
                valor={`${mayus(etiquetaDia(fechaChileDe(new Date(detalle.inicio)), true))} · ${hhmm(minutosDelDia(detalle.inicio))}–${hhmm(minutosDelDia(detalle.fin))}`}
              />
              <Dato etiqueta="Con" valor={detalle.profesional} />
              <Dato etiqueta="Contacto" valor={detalle.telefono ?? "sin teléfono"} />
              <Dato etiqueta="Reservó por" valor={detalle.origen} />
            </div>

            {/* Ficha del servicio (migración 277). Va en su propio bloque y no
                mezclada con los datos de la hora: para una clínica esto es lo
                PRIMERO que se mira al abrir la cita —RUT y previsión—, no un
                detalle secundario. */}
            {detalle.datosExtra && Object.keys(detalle.datosExtra).length > 0 && (
              <div className="mt-3 rounded-[7px] border p-4" style={{ borderColor: "var(--borde)" }}>
                <div className="eyebrow">Datos que dejó</div>
                <div className="mt-1.5">
                  {Object.entries(detalle.datosExtra).map(([k, v]) => (
                    <Dato key={k} etiqueta={k} valor={String(v)} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-2">
              {ACTIVOS.includes(detalle.estado) ? (
                <>
                  {detalle.estado !== "confirmada" && (
                    <form action={accionEstado}>
                      <input type="hidden" name="id" value={detalle.id} />
                      <input type="hidden" name="estado" value="confirmada" />
                      <button className="btn-primario w-full px-4 py-2.5 text-[14px]">Confirmar la hora</button>
                    </form>
                  )}
                  {detalle.telefono && (
                    <a
                      href={`https://wa.me/${detalle.telefono.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-suave block w-full px-4 py-2.5 text-center text-[14px]"
                    >
                      Escribir por WhatsApp
                    </a>
                  )}
                  <div className="my-1 border-t" style={{ borderColor: "var(--borde)" }} />
                  <div className="grid grid-cols-2 gap-2">
                    <form action={accionEstado}>
                      <input type="hidden" name="id" value={detalle.id} />
                      <input type="hidden" name="estado" value="completada" />
                      <button className="btn-suave w-full px-3 py-2 text-[13px]">Ya vino</button>
                    </form>
                    <form action={accionEstado}>
                      <input type="hidden" name="id" value={detalle.id} />
                      <input type="hidden" name="estado" value="no_show" />
                      <button className="btn-suave w-full px-3 py-2 text-[13px]">No llegó</button>
                    </form>
                  </div>
                  <form action={accionEstado}>
                    <input type="hidden" name="id" value={detalle.id} />
                    <input type="hidden" name="estado" value="cancelada" />
                    <button className="btn-suave w-full px-4 py-2 text-[13px]" style={{ color: "#b91c1c" }}>
                      Cancelar hora
                    </button>
                  </form>
                  <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
                    Al cancelar, el cupo vuelve a quedar disponible al instante.
                  </p>
                </>
              ) : (
                <>
                  <form action={accionReabrir}>
                    <input type="hidden" name="id" value={detalle.id} />
                    <button className="btn-suave w-full px-4 py-2.5 text-[14px]">Reabrir esta hora</button>
                  </form>
                  <p className="text-[12px]" style={{ color: "var(--muted-2)" }}>
                    Vuelve a dejarla como agendada, por si fue un clic equivocado.
                  </p>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[12.5px]" style={{ color: "var(--muted)" }}>{etiqueta}</span>
      <span className="text-right text-[13.5px] font-bold first-letter:uppercase">{valor}</span>
    </div>
  );
}
