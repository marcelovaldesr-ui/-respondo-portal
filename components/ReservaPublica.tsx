"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Widget público de reserva (F1): servicio → día → hora → datos → listo.
 * Sin dependencias externas; toda hora se muestra en hora de Chile explícita
 * (el visitante puede estar con el reloj del celular en otra zona).
 */

const ZONA = "America/Santiago";

type Servicio = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  precioClp: number | null;
};

type Slot = { inicio: string; profesionalId: string };

function claveDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function tituloDia(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

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
  const [slot, setSlot] = useState<Slot | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<{ cuando: string; whatsapp: string | null; pendiente: boolean } | null>(null);

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
    return () => {
      vivo = false;
    };
  }, [servicio, slug]);

  const porDia = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const c = claveDia(s.inicio);
      m.set(c, [...(m.get(c) ?? []), s]);
    }
    return m;
  }, [slots]);

  async function reservar() {
    if (!servicio || !slot) return;
    setEnviando(true);
    setError(null);
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
          web: "", // honeypot
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setListo({ cuando: d.cuando, whatsapp: d.whatsapp ?? null, pendiente: !!d.requiereConfirmacion });
      } else if (d.error === "cupo_tomado") {
        setError(d.mensaje ?? "Ese horario se acaba de ocupar. Elige otro.");
        setSlot(null);
        // recargar cupos
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

  if (listo) {
    return (
      <div className="tarjeta mt-8 p-6 text-center">
        <div className="text-[40px]">🎉</div>
        <h2 className="titular mt-2 text-[22px] font-extrabold">
          {listo.pendiente ? "¡Solicitud recibida!" : "¡Hora reservada!"}
        </h2>
        <p className="mt-2 text-[15px]">
          {servicio?.nombre} · <b>{listo.cuando}</b>
        </p>
        <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted)" }}>
          {listo.pendiente
            ? "El equipo la confirmará por WhatsApp a la brevedad."
            : "Te llegará un recordatorio por WhatsApp antes de tu hora."}
        </p>
        {listo.whatsapp && (
          <a
            href={listo.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primario mt-5 inline-block px-5 py-2.5 text-[14.5px]"
          >
            Escribir por WhatsApp
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* Paso 1: servicio */}
      <div className="text-[13px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
        1 · Elige tu servicio
      </div>
      <div className="mt-2 grid gap-2">
        {servicios.map((s) => (
          <button
            key={s.id}
            onClick={() => setServicio(s)}
            className="tarjeta flex items-center justify-between gap-3 p-4 text-left transition"
            style={servicio?.id === s.id ? { borderColor: "var(--indigo)", boxShadow: "0 0 0 3px var(--indigo-suave)" } : undefined}
          >
            <div>
              <div className="text-[15px] font-bold">{s.nombre}</div>
              <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {s.duracionMin} min{s.descripcion ? ` · ${s.descripcion}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-[14.5px] font-extrabold" style={{ color: "var(--indigo)" }}>
              {s.precioClp != null ? `$${s.precioClp.toLocaleString("es-CL")}` : "según evaluación"}
            </div>
          </button>
        ))}
      </div>

      {/* Paso 2: día y hora */}
      {servicio && (
        <>
          <div className="mt-6 text-[13px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
            2 · Elige día y hora <span className="normal-case">(hora de Chile)</span>
          </div>
          {cargando && <div className="tarjeta mt-2 p-4 text-[14px]" style={{ color: "var(--muted)" }}>Buscando horas disponibles…</div>}
          {!cargando && slots && slots.length === 0 && (
            <div className="tarjeta mt-2 p-4 text-[14px]" style={{ color: "var(--muted)" }}>
              No hay cupos online por ahora — escríbenos por WhatsApp y te acomodamos.
            </div>
          )}
          {!cargando && porDia.size > 0 && (
            <>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {[...porDia.keys()].slice(0, 14).map((c) => {
                  const primero = porDia.get(c)![0];
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        setDia(c);
                        setSlot(null);
                      }}
                      className="pildora shrink-0"
                      style={
                        dia === c
                          ? { background: "var(--indigo)", color: "#fff" }
                          : { background: "var(--indigo-suave)", color: "var(--indigo)" }
                      }
                    >
                      {tituloDia(primero.inicio)}
                    </button>
                  );
                })}
              </div>
              {dia && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {porDia.get(dia)!.map((s) => (
                    <button
                      key={s.inicio + s.profesionalId}
                      onClick={() => setSlot(s)}
                      className="btn-suave px-4 py-2 text-[14px] font-bold"
                      style={
                        slot?.inicio === s.inicio && slot.profesionalId === s.profesionalId
                          ? { background: "var(--indigo)", color: "#fff" }
                          : undefined
                      }
                    >
                      {hora(s.inicio)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Paso 3: datos */}
      {slot && (
        <>
          <div className="mt-6 text-[13px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
            3 · Tus datos
          </div>
          <div className="tarjeta mt-2 grid gap-3 p-4">
            <div>
              <label className="text-[13px] font-bold">Tu nombre</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="campo mt-1.5" placeholder="Camila Rojas" />
            </div>
            <div>
              <label className="text-[13px] font-bold">Tu WhatsApp</label>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className="campo mt-1.5" placeholder="9 1234 5678" inputMode="tel" />
              <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
                Ahí te llega la confirmación y el recordatorio.
              </p>
            </div>
            <button
              onClick={reservar}
              disabled={enviando || nombre.trim().length < 2 || telefono.replace(/\D/g, "").length < 8}
              className="btn-primario px-5 py-2.5 text-[15px]"
            >
              {enviando ? "Reservando…" : `Reservar · ${hora(slot.inicio)}`}
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="mt-4 rounded-xl p-3 text-[13.5px] font-semibold" style={{ background: "#FDE9EA", color: "#B33A3A" }}>
          {error}
        </div>
      )}
    </div>
  );
}
