"use client";

import { useMemo, useState } from "react";
import { BotonesHora, CalendarioMes, claveDia, mesDeClave, tituloDeClave } from "@/components/agenda/piezas";

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
  const [mes, setMes] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
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
          style={{ background: anulada ? "var(--coral-medio)" : "var(--ok-suave)" }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d={anulada ? "M7 7l10 10M17 7L7 17" : "M4.5 12.5l5 5 10-11"}
              stroke={anulada ? "var(--peligro)" : "var(--ok)"}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="titular mt-4 font-bold" style={{ fontSize: "var(--t-ficha)" }}>
          {anulada ? "Tu hora quedó anulada" : "Listo, tu hora cambió"}
        </h1>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          {anulada
            ? "Liberamos el cupo. Cuando quieras, puedes reservar de nuevo."
            : "Te llegará el recordatorio en la fecha nueva."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {anulada && cita.negocio.slug && (
            <a href={`/reservar/${cita.negocio.slug}`} className="btn-azul px-4 py-2.5">
              Reservar otra hora
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-suave px-4 py-2.5">
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
        <div className="mt-5 rounded-xl p-4" style={{ background: "var(--coral-medio)" }}>
          <div className="text-[15px] font-bold" style={{ color: "var(--peligro)" }}>
            ¿Seguro que quieres anular?
          </div>
          <p className="mt-1" style={{ color: "var(--peligro)" }}>
            Se libera el cupo y no se puede deshacer. Si solo necesitas otro día,
            mejor cámbiala.
          </p>
        </div>
        {error && <Aviso texto={error} />}
        <div className="mt-4 grid gap-2">
          <button
            onClick={anular}
            disabled={ocupado}
            className="btn-peligro w-full justify-center px-4 py-3 disabled:opacity-50"
          >
            {ocupado ? "Anulando…" : "Sí, anular mi hora"}
          </button>
          <button
            onClick={() => { setVista("inicio"); setError(null); }}
            disabled={ocupado}
            className="btn-suave w-full justify-center px-4 py-3"
          >
            Mejor no
          </button>
        </div>
      </Marco>
    );
  }

  // ── Elegir nueva hora ────────────────────────────────────────────────────
  if (vista === "reagendar") {
    /**
     * (Fase 2) MISMO control que la página pública: calendario del mes y horas
     * del día, en vez de la lista plana de 14 días que había acá. Son dos
     * pantallas del mismo cliente; que se vieran distintas no tenía defensa, y
     * obligaba a arreglar cada detalle dos veces.
     */
    const diasConCupo = [...new Set((slots ?? []).map((s) => claveDia(s.inicio)))].sort();
    const mesVisible = mes ?? (diasConCupo[0] ? mesDeClave(diasConCupo[0]) : claveDia(cita.inicioIso).slice(0, 7));
    const diaVisible = dia ?? diasConCupo.find((d) => mesDeClave(d) === mesVisible) ?? null;
    const horasDelDia = (slots ?? []).filter((s) => claveDia(s.inicio) === diaVisible);

    return (
      <Marco cita={cita}>
        <div className="mt-5 flex items-baseline justify-between">
          <div className="font-bold" style={{ fontSize: "var(--t-titulo)" }}>Elige tu nueva hora</div>
          <button
            onClick={() => { setVista("inicio"); setError(null); setElegido(null); }}
            className="btn-texto"
            style={{ color: "var(--azul)" }}
          >
            Volver
          </button>
        </div>

        <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          Se mantiene {cita.profesionalNombre ? `con ${cita.profesionalNombre}` : "con quien te atiende"}.
        </p>

        {ocupado && !slots && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="esqueleto" style={{ height: 44, borderRadius: "var(--r-input)" }} />
            ))}
          </div>
        )}
        {error && <Aviso texto={error} />}
        {slots && slots.length === 0 && (
          <p className="mt-4" style={{ fontSize: "var(--t-cuerpo)", color: "var(--muted)" }}>
            No quedan horas disponibles por internet. Escríbenos y te acomodamos.
          </p>
        )}

        {slots && slots.length > 0 && (
          <div className="mt-4 grid gap-5">
            <CalendarioMes
              mes={mesVisible}
              dias={diasConCupo}
              elegido={diaVisible}
              puedeRetroceder={mesVisible > claveDia(new Date().toISOString()).slice(0, 7)}
              onMes={(m) => { setMes(m); setDia(null); setElegido(null); }}
              onDia={(d) => { setDia(d); setElegido(null); }}
            />
            {diaVisible && (
              <div>
                <div className="mb-2 font-semibold first-letter:capitalize" style={{ fontSize: "var(--t-fila)" }}>
                  {tituloDeClave(diaVisible)}
                </div>
                <BotonesHora horas={horasDelDia} elegida={elegido} onElegir={setElegido} />
              </div>
            )}
          </div>
        )}

        {elegido && (
          <button
            onClick={confirmarCambio}
            disabled={ocupado}
            className="btn-azul mt-5 w-full justify-center px-4 py-3 disabled:opacity-50"
          >
            {ocupado ? "Cambiando…" : `Cambiar a ${diaCorto(elegido)}, ${hora(elegido)}`}
          </button>
        )}
      </Marco>
    );
  }

  // ── Vista principal ──────────────────────────────────────────────────────
  return (
    <Marco cita={cita}>
      {permisos.anulada || permisos.yaPaso ? (
        <div className="mt-5 rounded-xl p-4" style={{ background: "var(--fondo-hundido)", color: "var(--muted)" }}>
          {permisos.cancelar.motivo}
          {wa && (
            <>
              {" "}
              <a href={wa} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: "var(--azul)" }}>
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
            <p className="mt-4 text-center" style={{ color: "var(--muted-2)" }}>
              ¿Otra cosa?{" "}
              <a href={wa} target="_blank" rel="noopener noreferrer" className="font-bold underline" style={{ color: "var(--azul)" }}>
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
      <h1 className="titular mt-1 font-bold leading-tight" style={{ fontSize: "var(--t-ficha)" }}>
        Hola {cita.nombreContacto.split(" ")[0]}, esta es tu hora
      </h1>

      <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--borde)", background: "#fbfcfe" }}>
        <div className="font-bold first-letter:uppercase" style={{ fontSize: "var(--t-titulo)" }}>{fechaLarga(cita.inicioIso)}</div>
        <div className="mt-0.5 text-[26px] font-bold tabular-nums" style={{ color: "var(--azul)" }}>
          {hora(cita.inicioIso)} h
        </div>
        <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: "var(--borde)", color: "var(--muted)" }}>
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
      <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--borde)", background: "var(--fondo-hundido)" }}>
        <div className="text-[14.5px] font-bold" style={{ color: "var(--muted-2)" }}>{titulo}</div>
        <div className="mt-0.5" style={{ color: "var(--muted-2)" }}>{permiso.motivo}</div>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${principal ? "btn-azul" : "btn-suave"} w-full justify-center px-4 py-3`}
    >
      {titulo}
    </button>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="mt-4 rounded-xl p-3.5 font-semibold" style={{ background: "var(--coral-medio)", color: "var(--peligro)" }}>
      {texto}
    </div>
  );
}
