"use client";

import { useState } from "react";

/**
 * AUTOGESTIÓN — lo que ve el cliente final al abrir el enlace de su hora.
 *
 * Criterio de diseño: esta pantalla la abre alguien apurado, en el celular,
 * probablemente para cancelar. Tiene que resolverse en un toque y sin
 * ambigüedad. Nada de menús ni de "administrar mi reserva".
 *
 * Dos cuidados que marcan la diferencia:
 *  - Anular pide confirmación explícita: es irreversible y el botón está a un
 *    dedo de distancia del de reagendar.
 *  - Cuando algo NO se puede (pasó el plazo, el negocio no lo permite), no se
 *    esconde el botón: se muestra apagado CON el motivo y la salida por
 *    WhatsApp. Un botón que desaparece deja a la persona sin entender nada.
 */

const ZONA = "America/Santiago";

type Politica = { permiteCancelar: boolean; permiteReagendar: boolean; cancelacionMinHoras: number };
type Permiso = { permitido: boolean; motivo?: string };

export type DatosCita = {
  nombreContacto: string;
  servicioNombre: string;
  profesionalNombre: string | null;
  inicioIso: string;
  duracionMin: number;
  precioClp: number | null;
  estado: string;
  negocio: { nombre: string; slug: string | null; whatsapp: string | null };
  politica: Politica;
};

function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA, weekday: "long", day: "numeric", month: "long",
  }).format(new Date(iso));
}
function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}
function diaCorto(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA, weekday: "short", day: "numeric", month: "short",
  }).format(new Date(iso));
}
function claveDia(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export default function GestionCita({
  token,
  cita,
  permisos,
}: {
  token: string;
  cita: DatosCita;
  permisos: { cancelar: Permiso; reagendar: Permiso; yaPaso: boolean; anulada: boolean };
}) {
  const [vista, setVista] = useState<"inicio" | "confirmar_anular" | "reagendar">("inicio");
  const [slots, setSlots] = useState<{ inicio: string }[] | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<"anulada" | "movida" | null>(null);

  const wa = cita.negocio.whatsapp ? `https://wa.me/${cita.negocio.whatsapp}` : null;

  async function anular() {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch(`/api/cita/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cancelar" }),
      });
      const d = await r.json();
      if (d.ok) setHecho("anulada");
      else setError(d.error ?? "No se pudo anular.");
    } catch {
      setError("Problema de conexión. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  async function abrirReagendar() {
    setVista("reagendar");
    setError(null);
    if (slots) return;
    setOcupado(true);
    try {
      const r = await fetch(`/api/cita/${token}`);
      const d = await r.json();
      if (d.ok) setSlots(d.slots as { inicio: string }[]);
      else setError(d.error ?? "No pudimos cargar los horarios.");
    } catch {
      setError("No pudimos cargar los horarios.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCambio() {
    if (!elegido) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch(`/api/cita/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "reagendar", inicio: elegido }),
      });
      const d = await r.json();
      if (d.ok) setHecho("movida");
      else {
        setError(d.error ?? "No se pudo mover la hora.");
        // El cupo pudo tomarlo otra persona mientras elegía: refrescar.
        const rr = await fetch(`/api/cita/${token}`);
        const dd = await rr.json();
        if (dd.ok) setSlots(dd.slots as { inicio: string }[]);
        setElegido(null);
      }
    } catch {
      setError("Problema de conexión. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  // ── Resultado final ──────────────────────────────────────────────────────
  if (hecho) {
    const anulada = hecho === "anulada";
    return (
      <div className="tarjeta mx-auto mt-8 max-w-md p-7 text-center">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: anulada ? "#FDECEC" : "var(--ok-suave)" }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d={anulada ? "M7 7l10 10M17 7L7 17" : "M4.5 12.5l5 5 10-11"}
              stroke={anulada ? "#C0392B" : "var(--ok)"}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="titular mt-4 text-[22px] font-bold">
          {anulada ? "Tu hora quedó anulada" : "Listo, tu hora cambió"}
        </h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          {anulada
            ? "Liberamos el cupo. Cuando quieras, puedes reservar de nuevo."
            : "Te llegará el recordatorio en la fecha nueva."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {anulada && cita.negocio.slug && (
            <a href={`/reservar/${cita.negocio.slug}`} className="btn-primario px-4 py-2.5 text-[14px]">
              Reservar otra hora
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-suave px-4 py-2.5 text-[14px]">
              Escribirnos
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Confirmación de anulación ────────────────────────────────────────────
  if (vista === "confirmar_anular") {
    return (
      <Marco cita={cita}>
        <div className="mt-5 rounded-xl p-4" style={{ background: "#FDECEC" }}>
          <div className="text-[15px] font-bold" style={{ color: "#9B2C2C" }}>
            ¿Seguro que quieres anular?
          </div>
          <p className="mt-1 text-[13.5px]" style={{ color: "#9B2C2C" }}>
            Se libera el cupo y no se puede deshacer. Si solo necesitas otro día,
            mejor cámbiala.
          </p>
        </div>
        {error && <Aviso texto={error} />}
        <div className="mt-4 grid gap-2">
          <button
            onClick={anular}
            disabled={ocupado}
            className="w-full rounded-xl px-4 py-3 text-[15px] font-bold text-white transition disabled:opacity-50"
            style={{ background: "#C0392B" }}
          >
            {ocupado ? "Anulando…" : "Sí, anular mi hora"}
          </button>
          <button
            onClick={() => { setVista("inicio"); setError(null); }}
            disabled={ocupado}
            className="btn-suave w-full px-4 py-3 text-[15px]"
          >
            Mejor no
          </button>
        </div>
      </Marco>
    );
  }

  // ── Elegir nueva hora ────────────────────────────────────────────────────
  if (vista === "reagendar") {
    const porDia = new Map<string, { inicio: string }[]>();
    for (const s of slots ?? []) {
      const c = claveDia(s.inicio);
      porDia.set(c, [...(porDia.get(c) ?? []), s]);
    }
    const dias = [...porDia.keys()].sort().slice(0, 14);

    return (
      <Marco cita={cita}>
        <div className="mt-5 flex items-baseline justify-between">
          <div className="text-[15px] font-bold">Elige tu nueva hora</div>
          <button
            onClick={() => { setVista("inicio"); setError(null); setElegido(null); }}
            className="text-[13px] font-bold"
            style={{ color: "var(--indigo)" }}
          >
            Volver
          </button>
        </div>

        {ocupado && !slots && (
          <p className="mt-4 text-center text-[14px]" style={{ color: "var(--muted)" }}>
            Buscando horas disponibles…
          </p>
        )}
        {error && <Aviso texto={error} />}
        {slots && slots.length === 0 && (
          <p className="mt-4 text-[14px]" style={{ color: "var(--muted)" }}>
            No quedan horas disponibles por internet. Escríbenos y te acomodamos.
          </p>
        )}

        <div className="mt-4 grid gap-4">
          {dias.map((d) => (
            <div key={d}>
              <div className="text-[12px] font-bold uppercase first-letter:uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.05em" }}>
                {diaCorto(porDia.get(d)![0].inicio)}
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {porDia.get(d)!.map((s) => {
                  const sel = elegido === s.inicio;
                  return (
                    <button
                      key={s.inicio}
                      onClick={() => setElegido(s.inicio)}
                      className="rounded-xl border py-2.5 text-[14px] font-bold tabular-nums transition"
                      style={
                        sel
                          ? { background: "var(--indigo)", color: "#fff", borderColor: "var(--indigo)" }
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

        {elegido && (
          <button
            onClick={confirmarCambio}
            disabled={ocupado}
            className="btn-primario mt-5 w-full px-4 py-3 text-[15px] disabled:opacity-50"
          >
            {ocupado ? "Cambiando…" : `Cambiar a ${diaCorto(elegido)}, ${hora(elegido)} h`}
          </button>
        )}
      </Marco>
    );
  }

  // ── Vista principal ──────────────────────────────────────────────────────
  return (
    <Marco cita={cita}>
      {permisos.anulada || permisos.yaPaso ? (
        <div className="mt-5 rounded-xl p-4 text-[14px]" style={{ background: "#F4F6FB", color: "var(--muted)" }}>
          {permisos.cancelar.motivo}
          {wa && (
            <>
              {" "}
              <a href={wa} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: "var(--indigo)" }}>
                Escríbenos
              </a>{" "}
              si necesitas algo.
            </>
          )}
        </div>
      ) : (
        <>
          {error && <Aviso texto={error} />}
          <div className="mt-5 grid gap-2">
            <Accion
              titulo="Cambiar día u hora"
              permiso={permisos.reagendar}
              onClick={abrirReagendar}
              principal
            />
            <Accion
              titulo="Anular mi hora"
              permiso={permisos.cancelar}
              onClick={() => setVista("confirmar_anular")}
            />
          </div>
          {wa && (
            <p className="mt-4 text-center text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              ¿Otra cosa?{" "}
              <a href={wa} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: "var(--indigo)" }}>
                Escríbenos por WhatsApp
              </a>
            </p>
          )}
        </>
      )}
    </Marco>
  );
}

function Marco({ cita, children }: { cita: DatosCita; children: React.ReactNode }) {
  return (
    <div className="tarjeta mx-auto mt-8 max-w-md p-6 sm:p-7">
      <div className="eyebrow">{cita.negocio.nombre}</div>
      <h1 className="titular mt-1 text-[21px] font-bold leading-tight">
        Hola {cita.nombreContacto.split(" ")[0]}, esta es tu hora
      </h1>

      <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--borde)", background: "#fbfcfe" }}>
        <div className="text-[17px] font-bold first-letter:uppercase">{fechaLarga(cita.inicioIso)}</div>
        <div className="mt-0.5 text-[26px] font-bold tabular-nums" style={{ color: "var(--indigo)" }}>
          {hora(cita.inicioIso)} h
        </div>
        <div className="mt-2.5 border-t pt-2.5 text-[13.5px]" style={{ borderColor: "var(--borde)", color: "var(--muted)" }}>
          <div className="font-semibold" style={{ color: "var(--tinta)" }}>{cita.servicioNombre}</div>
          <div className="mt-0.5">
            {cita.duracionMin} min
            {cita.profesionalNombre ? ` · con ${cita.profesionalNombre}` : ""}
            {cita.precioClp != null ? ` · $${cita.precioClp.toLocaleString("es-CL")}` : ""}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Accion({
  titulo,
  permiso,
  onClick,
  principal,
}: {
  titulo: string;
  permiso: Permiso;
  onClick: () => void;
  principal?: boolean;
}) {
  if (!permiso.permitido) {
    return (
      <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--borde)", background: "#F8F9FC" }}>
        <div className="text-[14.5px] font-bold" style={{ color: "var(--muted-2)" }}>{titulo}</div>
        <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted-2)" }}>{permiso.motivo}</div>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${principal ? "btn-primario" : "btn-suave"} w-full px-4 py-3 text-[15px]`}
    >
      {titulo}
    </button>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="mt-4 rounded-xl p-3.5 text-[13.5px] font-semibold" style={{ background: "#FDE9EA", color: "#B33A3A" }}>
      {texto}
    </div>
  );
}
