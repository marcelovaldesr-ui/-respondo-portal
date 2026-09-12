"use client";

import { useState } from "react";
import Link from "next/link";
import { aprobar, rechazar } from "@/app/(portal)/seguimientos/acciones";
import type { PropuestaConContacto } from "@/lib/propuestasSeguimiento";

/**
 * LA LISTA DE PROPUESTAS DE BETO.
 *
 * Dos decisiones de diseño que no son cosméticas:
 *
 * 1 · **El botón dice «Retomar», no «Aprobar».** Quien mira esta pantalla no
 *     está auditando a una IA: está decidiendo si vuelve a hablarle a un
 *     cliente. La palabra tiene que ser la del negocio.
 *
 * 2 · **El texto exacto que va a salir se muestra siempre, no detrás de un
 *     «ver detalle».** Es un mensaje pagado que sale a nombre del negocio; que
 *     haya que abrir algo para verlo es como firmar sin leer.
 */

function armarMensaje(nombre: string, negocio: string, cotizado: string): string {
  // Espejo del cuerpo aprobado en Meta (lib/plantillas.ts → cotizacion_pendiente).
  return (
    `Hola ${nombre || "hola"}, te escribimos de ${negocio} por la cotización de ` +
    `${cotizado || "lo que nos consultaste"} que nos pediste.\n\n` +
    "¿Sigue en pie? Si nos dices que sí, la retomamos hoy mismo."
  );
}

export function PropuestasLista({
  propuestas: iniciales,
  puedeAprobar = false,
  puedeDescartar = false,
  negocio = "",
}: {
  propuestas: PropuestaConContacto[];
  /** Aprobar = autorizar un mensaje pagado: solo el dueño (Fase 0). */
  puedeAprobar?: boolean;
  /**
   * Descartar no gasta ni escribe a nadie: el staff puede hacerlo, como dice
   * lib/permisos.ts. Antes la UI le escondía también este botón (Fase 1).
   */
  puedeDescartar?: boolean;
  negocio?: string;
}) {
  const [propuestas, setPropuestas] = useState(iniciales);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const decidir = async (p: PropuestaConContacto, accion: "si" | "no") => {
    if (ocupado) return;
    setOcupado(p.id);
    setError(null);
    setAviso(null);
    try {
      const fd = new FormData();
      fd.set("propuestaId", p.id);
      const r: { ok: boolean; error?: string; aviso?: string; retirar?: boolean } =
        accion === "si" ? await aprobar(fd) : await rechazar(fd);
      if (r.ok || r.retirar) setPropuestas((xs) => xs.filter((x) => x.id !== p.id));
      if (r.ok) setAviso(r.aviso ?? null);
      else setError(r.error ?? "No se pudo guardar");
    } finally {
      setOcupado(null);
    }
  };

  if (!propuestas.length) {
    return (
      <div className="tarjeta p-8 text-center" style={{ color: "var(--muted)" }}>
        {(error || aviso) && (
          <p className="mb-2 text-[13px]" style={{ color: error ? "var(--alerta, #B91C1C)" : "var(--muted)" }}>
            {error ?? aviso}
          </p>
        )}
        {!puedeAprobar && !puedeDescartar
          ? "Nada por acá todavía."
          : "No hay cotizaciones por retomar. Cuando el asistente encuentre alguna que quedó sin respuesta, aparecerá acá antes de que salga."}
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
      {aviso && (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {aviso}
        </p>
      )}
      {propuestas.map((p) => (
        <div key={p.id} className="tarjeta p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[15px] font-bold">{p.nombre || "(sin nombre)"}</span>
            {p.diasEsperando !== null && (
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                sin respuesta hace {p.diasEsperando} día{p.diasEsperando === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="mt-1 text-[13.5px]">
            Cotizó: <strong>{p.cotizado || "no se pudo determinar"}</strong>
          </div>

          {p.motivo_juez && (
            <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
              {p.motivo_juez}
            </div>
          )}

          {/* El último mensaje se lee AHORA, no cuando se generó la propuesta:
              si el cliente escribió en el intertanto, hay que verlo antes de
              mandarle un «¿sigue en pie?». */}
          {p.ultimoMensaje && (
            <div
              className="mt-2 rounded p-2 text-[12.5px]"
              style={{ background: "#F1F2F7", color: "var(--muted)" }}
            >
              {p.ultimoMensaje.slice(0, 220)}
            </div>
          )}

          <div
            className="mt-2 whitespace-pre-line rounded p-2.5 text-[12.5px]"
            style={{ background: "#F5F7FF" }}
          >
            {armarMensaje(p.nombre, negocio, p.cotizado ?? "")}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {puedeAprobar && (
              <button
                onClick={() => void decidir(p, "si")}
                disabled={ocupado === p.id}
                className="btn-fila-azul disabled:opacity-50"
              >
                Retomar
              </button>
            )}
            {puedeDescartar && (
              <button onClick={() => void decidir(p, "no")} disabled={ocupado === p.id} className="btn-fila disabled:opacity-50">
                Descartar
              </button>
            )}
            <Link
              href={
                p.empleadoId
                  ? `/conversaciones?emp=${encodeURIComponent(p.empleadoId)}&chat=${encodeURIComponent(p.chat_id)}`
                  : `/clientes/${encodeURIComponent(p.chat_id)}`
              }
              className="btn-texto"
              style={{ fontSize: "var(--t-menor)" }}
            >
              Ver conversación →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
