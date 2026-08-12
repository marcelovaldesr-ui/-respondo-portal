"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * PÁGINA PÚBLICA DE RESERVA — servicio → día → hora → datos → listo.
 *
 * Rediseño (31-jul-2026): antes era una tira de píldoras con los próximos 14
 * días. Ahora es un CALENDARIO MENSUAL de verdad, que es lo que la gente espera
 * al reservar (Fresha, Booksy, AgendaPro, Calendly, todos usan mes). Con el mes
 * a la vista se entiende de un golpe qué días atiende el negocio y cuáles no,
 * en vez de tener que desplazar una lista.
 *
 * Otras decisiones:
 *  - Las horas se agrupan en Mañana / Tarde / Noche: 30 botones seguidos no se
 *    leen, tres bloques de 10 sí.
 *  - Hay un resumen fijo con lo elegido, para que nadie llegue al final sin
 *    saber qué está reservando.
 *  - Todo se muestra en hora de Chile explícita: el visitante puede tener el
 *    celular en otro huso.
 *
 * Sin dependencias externas, a propósito: esta página la abre gente en 3G.
 */

const ZONA = "America/Santiago";
const DIAS_CORTOS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Un campo de la ficha que el negocio definió para ESTE servicio
 * (migración 277). Lo que hace que la misma pantalla sirva para una barbería
 * que no pregunta nada y para una clínica que necesita RUT y previsión.
 */
export type CampoPublico = {
  id: string;
  etiqueta: string;
  tipo: "texto" | "parrafo" | "numero" | "telefono" | "email" | "opciones" | "si_no" | "fecha" | "rut";
  opciones: string[] | null;
  obligatorio: boolean;
  ayuda: string | null;
  orden: number;
};

type Servicio = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  precioClp: number | null;
  campos?: CampoPublico[];
};

type Slot = { inicio: string; profesionalId: string };

/** "2026-08-03" en hora de Chile. */
function claveDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}
function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}
function minutosDe(iso: string): number {
  const [h, m] = hora(iso).split(":").map(Number);
  return h * 60 + m;
}
/** Día largo a partir de la clave, sin volver a tocar husos. */
function tituloDeClave(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number);
  const nombreDia = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][
    new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  ];
  return `${nombreDia} ${d} de ${MESES[m - 1]}`;
}
function mesDeClave(clave: string): string {
  return clave.slice(0, 7); // "2026-08"
}
function precio(v: number | null): string {
  return v != null ? `$${v.toLocaleString("es-CL")}` : "según evaluación";
}

/** Matriz del mes (semanas de 7), empezando en lunes. null = casilla vacía. */
function grillaMes(mes: string): (string | null)[][] {
  const [a, m] = mes.split("-").map(Number);
  const primero = new Date(Date.UTC(a, m - 1, 1));
  const diasEnMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const desplazamiento = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const celdas: (string | null)[] = Array(desplazamiento).fill(null);
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push(`${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}
function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

const BLOQUES = [
  { clave: "manana", titulo: "Mañana", desde: 0, hasta: 12 * 60 },
  { clave: "tarde", titulo: "Tarde", desde: 12 * 60, hasta: 18 * 60 },
  { clave: "noche", titulo: "Noche", desde: 18 * 60, hasta: 24 * 60 },
];

export default function ReservaPublica({
  slug,
  servicios,
}: {
  slug: string;
  servicios: Servicio[];
}) {
  const [servicio, setServicio] = useState<Servicio | null>(
    servicios.length === 1 ? servicios[0] : null,
  );
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [dia, setDia] = useState<string | null>(null);
  const [mes, setMes] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Respuestas de la ficha del servicio, por id de campo.
  const [ficha, setFicha] = useState<Record<string, string>>({});
  const [erroresFicha, setErroresFicha] = useState<Record<string, string>>({});
  const [listo, setListo] = useState<{
    cuando: string;
    whatsapp: string | null;
    pendiente: boolean;
    gestion: string | null;
  } | null>(null);

  const campos = useMemo(
    () => [...(servicio?.campos ?? [])].sort((a, b) => a.orden - b.orden),
    [servicio],
  );

  // Cambiar de servicio cambia la ficha: las respuestas viejas no aplican.
  useEffect(() => {
    setFicha({});
    setErroresFicha({});
  }, [servicio?.id]);

  const fichaCompleta = campos
    .filter((c) => c.obligatorio)
    .every((c) => (ficha[c.id] ?? "").trim().length > 0);

  // Cargar disponibilidad al elegir servicio.
  useEffect(() => {
    if (!servicio) return;
    let vivo = true;
    setCargando(true);
    setSlots(null);
    setDia(null);
    setSlot(null);
    setError(null);
    fetch(`/api/reservas/disponibilidad?slug=${encodeURIComponent(slug)}&servicio=${encodeURIComponent(servicio.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (d.ok) setSlots(d.slots as Slot[]);
        else setError("No pudimos cargar los horarios. Intenta de nuevo.");
      })
      .catch(() => vivo && setError("No pudimos cargar los horarios. Intenta de nuevo."))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [servicio, slug]);

  const porDia = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const c = claveDia(s.inicio);
      m.set(c, [...(m.get(c) ?? []), s]);
    }
    for (const [, v] of m) v.sort((a, b) => a.inicio.localeCompare(b.inicio));
    return m;
  }, [slots]);

  const clavesDisponibles = useMemo(() => [...porDia.keys()].sort(), [porDia]);

  // Meses navegables: los que tienen cupos. Al cargar, se abre el primero y se
  // preselecciona el primer día con horas — un clic menos para el 90% de la gente.
  const mesesConCupo = useMemo(
    () => [...new Set(clavesDisponibles.map(mesDeClave))].sort(),
    [clavesDisponibles],
  );

  useEffect(() => {
    if (clavesDisponibles.length === 0) return;
    setMes(mesDeClave(clavesDisponibles[0]));
    setDia(clavesDisponibles[0]);
  }, [clavesDisponibles]);

  const idxMes = mes ? mesesConCupo.indexOf(mes) : -1;
  const semanas = useMemo(() => (mes ? grillaMes(mes) : []), [mes]);

  const slotsDelDia = dia ? porDia.get(dia) ?? [] : [];
  const grupos = BLOQUES.map((b) => ({
    ...b,
    slots: slotsDelDia.filter((s) => {
      const m = minutosDe(s.inicio);
      return m >= b.desde && m < b.hasta;
    }),
  })).filter((g) => g.slots.length > 0);

  async function reservar() {
    if (!servicio || !slot) return;
    setEnviando(true);
    setError(null);
    setErroresFicha({});
    try {
      const r = await fetch("/api/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          servicioId: servicio.id,
          profesionalId: slot.profesionalId,
          inicio: slot.inicio,
          nombre,
          telefono,
          ficha,
          web: "", // honeypot
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setListo({
          cuando: d.cuando,
          whatsapp: d.whatsapp ?? null,
          pendiente: !!d.requiereConfirmacion,
          gestion: d.gestion ?? null,
        });
      } else if (d.error === "ficha_invalida") {
        // El servidor manda el detalle por campo: se pinta donde corresponde en
        // vez de un error genérico arriba, que obliga a adivinar cuál falló.
        setErroresFicha((d.errores ?? {}) as Record<string, string>);
        setError("Revisa los datos marcados.");
      } else if (d.error === "cupo_tomado") {
        setError(d.mensaje ?? "Ese horario se acaba de ocupar. Elige otro, por favor.");
        setSlot(null);
        const rd = await fetch(`/api/reservas/disponibilidad?slug=${encodeURIComponent(slug)}&servicio=${encodeURIComponent(servicio.id)}`);
        const dd = await rd.json();
        if (dd.ok) setSlots(dd.slots as Slot[]);
      } else {
        setError(d.error ?? "No se pudo reservar. Intenta de nuevo.");
      }
    } catch {
      setError("Problema de conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Pantalla de éxito ───────────────────────────────────────────────
  if (listo) {
    return (
      <div className="tarjeta mx-auto mt-8 max-w-md overflow-hidden">
        <div className="px-6 pb-2 pt-8 text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: listo.pendiente ? "var(--indigo-suave)" : "var(--ok-suave)" }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d={listo.pendiente ? "M12 7v5l3 2" : "M4.5 12.5l5 5 10-11"}
                stroke={listo.pendiente ? "var(--indigo)" : "var(--ok)"}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {listo.pendiente && <circle cx="12" cy="12" r="9" stroke="var(--indigo)" strokeWidth="2.2" />}
            </svg>
          </div>
          <h2 className="mt-4 text-[23px] font-bold leading-tight">
            {listo.pendiente ? "Solicitud recibida" : "¡Tu hora quedó reservada!"}
          </h2>
          <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
            {listo.pendiente
              ? "Te confirmamos por WhatsApp a la brevedad."
              : "Te llegará un recordatorio por WhatsApp antes de tu hora."}
          </p>
        </div>

        <div className="mx-6 mt-5 rounded-xl border p-4" style={{ borderColor: "var(--borde)", background: "#fbfcfe" }}>
          <Fila etiqueta="Servicio" valor={servicio?.nombre ?? ""} />
          <Fila etiqueta="Cuándo" valor={listo.cuando} destacado />
          {servicio && <Fila etiqueta="Duración" valor={`${servicio.duracionMin} minutos`} />}
          {servicio?.precioClp != null && <Fila etiqueta="Valor" valor={precio(servicio.precioClp)} />}
        </div>

        <div className="px-6 pb-7 pt-5 text-center">
          {listo.whatsapp && (
            <a href={listo.whatsapp} target="_blank" rel="noopener noreferrer" className="btn-primario inline-block w-full px-5 py-3 text-[14.5px]">
              Escribirnos por WhatsApp
            </a>
          )}
          {/* Autogestión (migración 277): quien reserva por la web puede no
              tener WhatsApp con el negocio; este enlace es su forma de moverse
              solo. Se muestra completo para que pueda guardarlo. */}
          {listo.gestion ? (
            <div className="mt-4 rounded-xl border p-3.5 text-left" style={{ borderColor: "var(--borde)" }}>
              <div className="text-[13px] font-bold">¿Necesitas moverla o anularla?</div>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
                Guarda este enlace — desde ahí la cambias tú mismo, sin esperar
                a que te respondan.
              </p>
              <a
                href={listo.gestion}
                className="mt-2 inline-block w-full rounded-lg px-3 py-2.5 text-center text-[13.5px] font-bold"
                style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}
              >
                Administrar mi hora
              </a>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              ¿Necesitas moverla o anularla? Escríbenos y lo hacemos al tiro.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Flujo de reserva ────────────────────────────────────────────────
  const paso = !servicio ? 1 : !slot ? 2 : 3;

  return (
    <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div>
        {/* Progreso */}
        <div className="mb-5 flex items-center gap-2">
          {[
            { n: 1, t: "Servicio" },
            { n: 2, t: "Día y hora" },
            { n: 3, t: "Tus datos" },
          ].map((p, i) => (
            <div key={p.n} className="flex flex-1 items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold"
                style={
                  paso >= p.n
                    ? { background: "var(--indigo)", color: "#fff" }
                    : { background: "#eef0f6", color: "var(--muted-2)" }
                }
              >
                {paso > p.n ? "✓" : p.n}
              </span>
              <span
                className="hidden text-[12.5px] font-bold sm:inline"
                style={{ color: paso >= p.n ? "var(--tinta)" : "var(--muted-2)" }}
              >
                {p.t}
              </span>
              {i < 2 && <span className="h-[2px] flex-1 rounded-full" style={{ background: paso > p.n ? "var(--indigo)" : "#eef0f6" }} />}
            </div>
          ))}
        </div>

        {/* ── 1 · Servicio ─────────────────────────────────────────── */}
        <Rotulo n={1} texto="Elige tu servicio" />
        <div className="mt-2.5 grid gap-2">
          {servicios.map((s) => {
            const elegido = servicio?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setServicio(s)}
                className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 text-left transition"
                style={{
                  borderColor: elegido ? "var(--indigo)" : "var(--borde)",
                  boxShadow: elegido ? "0 0 0 3px var(--indigo-suave)" : "var(--sombra)",
                }}
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-bold">{s.nombre}</div>
                  <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
                    {s.duracionMin} min{s.descripcion ? ` · ${s.descripcion}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[14.5px] font-bold" style={{ color: "var(--indigo)" }}>
                    {precio(s.precioClp)}
                  </div>
                  {elegido && (
                    <div className="text-[11.5px] font-bold" style={{ color: "var(--muted-2)" }}>
                      elegido ✓
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── 2 · Día y hora ───────────────────────────────────────── */}
        {servicio && (
          <div className="mt-7">
            <Rotulo n={2} texto="Elige día y hora" nota="hora de Chile" />

            {cargando && (
              <div className="tarjeta mt-2.5 p-8 text-center text-[14px]" style={{ color: "var(--muted)" }}>
                Buscando horas disponibles…
              </div>
            )}

            {!cargando && slots && slots.length === 0 && (
              <div className="tarjeta mt-2.5 p-6 text-center text-[14px]" style={{ color: "var(--muted)" }}>
                No hay cupos online por ahora — escríbenos por WhatsApp y te acomodamos.
              </div>
            )}

            {!cargando && mes && clavesDisponibles.length > 0 && (
              <div className="tarjeta mt-2.5 p-4 sm:p-5">
                {/* Cabecera del mes */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setMes(mesesConCupo[idxMes - 1])}
                    disabled={idxMes <= 0}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[17px] font-bold transition hover:bg-slate-50 disabled:opacity-20"
                    style={{ color: "var(--indigo)", border: "1px solid var(--borde)" }}
                    aria-label="Mes anterior"
                  >
                    ‹
                  </button>
                  <div className="text-[15.5px] font-bold first-letter:uppercase">{nombreMes(mes)}</div>
                  <button
                    onClick={() => setMes(mesesConCupo[idxMes + 1])}
                    disabled={idxMes < 0 || idxMes >= mesesConCupo.length - 1}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[17px] font-bold transition hover:bg-slate-50 disabled:opacity-20"
                    style={{ color: "var(--indigo)", border: "1px solid var(--borde)" }}
                    aria-label="Mes siguiente"
                  >
                    ›
                  </button>
                </div>

                {/* Encabezado de días. El calendario se limita en ancho: en una
                    tarjeta de 700 px las casillas cuadradas quedaban enormes. */}
                <div className="mx-auto max-w-[360px]">
                <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                  {DIAS_CORTOS.map((d) => (
                    <div key={d} className="pb-1 text-[11px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.05em" }}>
                      {d}
                    </div>
                  ))}
                </div>

                {/* Días */}
                <div className="grid grid-cols-7 gap-1">
                  {semanas.flat().map((c, i) => {
                    if (!c) return <div key={`v${i}`} />;
                    const cupos = porDia.get(c)?.length ?? 0;
                    const elegido = dia === c;
                    return (
                      <button
                        key={c}
                        onClick={() => { setDia(c); setSlot(null); }}
                        disabled={cupos === 0}
                        className="relative flex aspect-square flex-col items-center justify-center rounded-xl text-[14px] font-bold transition"
                        style={
                          elegido
                            ? { background: "var(--indigo)", color: "#fff", boxShadow: "var(--glow-indigo)" }
                            : cupos > 0
                              ? { background: "var(--indigo-suave)", color: "var(--indigo)" }
                              : { background: "#f7f8fc", color: "#c3cad8" }
                        }
                        title={cupos > 0 ? `${cupos} ${cupos === 1 ? "hora disponible" : "horas disponibles"}` : "sin horas"}
                      >
                        {Number(c.slice(8))}
                        {cupos > 0 && !elegido && (
                          <span className="absolute bottom-1.5 h-1 w-1 rounded-full" style={{ background: "var(--indigo)" }} />
                        )}
                      </button>
                    );
                  })}
                </div>
                </div>

                <div className="mt-3 flex items-center justify-center gap-4 border-t pt-3 text-[11.5px]" style={{ borderColor: "var(--borde)", color: "var(--muted-2)" }}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded" style={{ background: "var(--indigo-suave)" }} />
                    con horas
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded" style={{ background: "#f7f8fc" }} />
                    sin horas
                  </span>
                </div>
              </div>
            )}

            {/* Horas del día elegido */}
            {!cargando && dia && slotsDelDia.length > 0 && (
              <div className="mt-4">
                <div className="text-[14px] font-bold first-letter:uppercase">{tituloDeClave(dia)}</div>
                <div className="mt-3 grid gap-4">
                  {grupos.map((g) => (
                    <div key={g.clave}>
                      <div className="text-[11.5px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
                        {g.titulo}
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                        {g.slots.map((s) => {
                          const elegido = slot?.inicio === s.inicio && slot.profesionalId === s.profesionalId;
                          return (
                            <button
                              key={s.inicio + s.profesionalId}
                              onClick={() => setSlot(s)}
                              className="rounded-xl border py-2.5 text-[14px] font-bold tabular-nums transition"
                              style={
                                elegido
                                  ? { background: "var(--indigo)", color: "#fff", borderColor: "var(--indigo)", boxShadow: "var(--glow-indigo)" }
                                  : { background: "#fff", borderColor: "var(--borde)", color: "var(--tinta)" }
                              }
                            >
                              {hora(s.inicio)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 3 · Datos ────────────────────────────────────────────── */}
        {slot && (
          <div className="mt-7">
            <Rotulo n={3} texto="Tus datos" />
            <div className="tarjeta mt-2.5 grid gap-3.5 p-5">
              <div>
                <label className="text-[13px] font-bold">Tu nombre</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="campo mt-1.5" placeholder="Camila Rojas" autoComplete="name" />
              </div>
              <div>
                <label className="text-[13px] font-bold">Tu WhatsApp</label>
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="campo mt-1.5" placeholder="9 1234 5678" inputMode="tel" autoComplete="tel" />
                <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
                  Ahí te llega la confirmación y el recordatorio. No lo usamos para nada más.
                </p>
              </div>

              {/* Ficha del servicio: lo que ESTE negocio necesita saber. */}
              {campos.map((c) => (
                <CampoFormulario
                  key={c.id}
                  campo={c}
                  valor={ficha[c.id] ?? ""}
                  error={erroresFicha[c.id]}
                  onChange={(v) => setFicha((f) => ({ ...f, [c.id]: v }))}
                />
              ))}

              <button
                onClick={reservar}
                disabled={
                  enviando ||
                  nombre.trim().length < 2 ||
                  telefono.replace(/\D/g, "").length < 8 ||
                  !fichaCompleta
                }
                className="btn-primario w-full px-5 py-3 text-[15px]"
                style={
                  enviando ||
                  nombre.trim().length < 2 ||
                  telefono.replace(/\D/g, "").length < 8 ||
                  !fichaCompleta
                    ? { opacity: 0.45, cursor: "not-allowed" }
                    : undefined
                }
              >
                {enviando ? "Reservando…" : "Confirmar mi hora"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl p-3.5 text-[13.5px] font-semibold" style={{ background: "#FDE9EA", color: "#B33A3A" }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Resumen fijo ───────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-6">
        <div className="tarjeta p-5">
          <div className="eyebrow">Tu reserva</div>
          {!servicio && !slot ? (
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              Elige un servicio para empezar. Toma menos de un minuto.
            </p>
          ) : (
            <div className="mt-2.5">
              {servicio && (
                <>
                  <Fila etiqueta="Servicio" valor={servicio.nombre} destacado />
                  <Fila etiqueta="Duración" valor={`${servicio.duracionMin} min`} />
                  <Fila etiqueta="Valor" valor={precio(servicio.precioClp)} />
                </>
              )}
              {slot ? (
                <>
                  <div className="my-2.5 border-t" style={{ borderColor: "var(--borde)" }} />
                  <Fila etiqueta="Día" valor={tituloDeClave(claveDia(slot.inicio))} />
                  <Fila etiqueta="Hora" valor={`${hora(slot.inicio)} h`} destacado />
                </>
              ) : (
                <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                  Falta elegir el día y la hora.
                </p>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 px-1 text-[12px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
          Tu hora queda tomada al instante y nadie más puede reservarla. Si necesitas
          cambiarla, escríbenos por WhatsApp.
        </p>
      </aside>
    </div>
  );
}

/**
 * Un campo de la ficha. Se elige el control por TIPO, no un input de texto para
 * todo: en el celular la diferencia es enorme —un teclado numérico, un
 * desplegable en vez de escribir "Fonasa" a mano, dos botones para sí/no—.
 * Cada control equivocado es gente que abandona la reserva.
 */
function CampoFormulario({
  campo,
  valor,
  error,
  onChange,
}: {
  campo: CampoPublico;
  valor: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const borde = error ? { borderColor: "#D98282" } : undefined;

  return (
    <div>
      <label className="text-[13px] font-bold">
        {campo.etiqueta}
        {!campo.obligatorio && (
          <span className="ml-1.5 font-semibold" style={{ color: "var(--muted-2)" }}>
            (opcional)
          </span>
        )}
      </label>

      {campo.tipo === "opciones" ? (
        <select
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="campo mt-1.5"
          style={borde}
        >
          <option value="">Elige una opción…</option>
          {(campo.opciones ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : campo.tipo === "si_no" ? (
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {["Sí", "No"].map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className="rounded-xl border py-2.5 text-[14px] font-bold transition"
              style={
                valor === o
                  ? { background: "var(--indigo)", color: "#fff", borderColor: "var(--indigo)" }
                  : { background: "#fff", borderColor: "var(--borde)", color: "var(--tinta)" }
              }
            >
              {o}
            </button>
          ))}
        </div>
      ) : campo.tipo === "parrafo" ? (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="campo mt-1.5"
          style={borde}
          placeholder={campo.ayuda ?? ""}
        />
      ) : (
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="campo mt-1.5"
          style={borde}
          type={campo.tipo === "fecha" ? "date" : "text"}
          inputMode={
            campo.tipo === "numero" || campo.tipo === "telefono"
              ? "numeric"
              : campo.tipo === "email"
                ? "email"
                : undefined
          }
          placeholder={
            campo.tipo === "rut"
              ? "12.345.678-9"
              : campo.tipo === "email"
                ? "tucorreo@ejemplo.cl"
                : (campo.ayuda ?? "")
          }
          autoComplete={campo.tipo === "email" ? "email" : campo.tipo === "telefono" ? "tel" : "off"}
        />
      )}

      {error ? (
        <p className="mt-1 text-[12px] font-semibold" style={{ color: "#B33A3A" }}>{error}</p>
      ) : campo.ayuda && campo.tipo !== "parrafo" ? (
        <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>{campo.ayuda}</p>
      ) : null}
    </div>
  );
}

function Rotulo({ n, texto, nota }: { n: number; texto: string; nota?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[13px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
        {n} · {texto}
      </span>
      {nota && (
        <span className="text-[12px]" style={{ color: "var(--muted-2)" }}>
          ({nota})
        </span>
      )}
    </div>
  );
}

function Fila({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[12.5px]" style={{ color: "var(--muted)" }}>{etiqueta}</span>
      <span
        className={`text-right text-[13.5px] ${destacado ? "font-bold" : "font-semibold"} first-letter:capitalize`}
        style={{ color: destacado ? "var(--tinta)" : "var(--muted)" }}
      >
        {valor}
      </span>
    </div>
  );
}
