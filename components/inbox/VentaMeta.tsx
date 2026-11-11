"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  estadoVentaMeta,
  marcarCotizacionCalificada,
  marcarVenta,
  type EstadoVentaMeta,
} from "@/app/(portal)/conversaciones/accionesConversionesMeta";

/**
 * VENTA Y COTIZACIÓN — bloque de la ficha para negocios con conversiones a
 * Meta activas. Con el flag apagado el servidor devuelve null y esto no dibuja
 * nada: un negocio que no usa la función no ve ningún cambio.
 *
 * Hecho para quien atiende el mesón, no para un técnico: dos botones, en
 * español, y la venta en dos toques (botón → monto → Confirmar).
 */

const ETIQUETA_EVENTO: Record<string, string> = {
  LeadSubmitted: "Pidió cotización",
  QualifiedLead: "Cotización calificada",
  Purchase: "Venta",
};
const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "por enviar",
  enviado: "enviado a Meta",
  fallido: "reintentando",
  descartado: "no se envía",
};

const pesos = (n: number) => `$${n.toLocaleString("es-CL")}`;

export default function VentaMeta({ chatId, empleadoId }: { chatId: string; empleadoId: string }) {
  const [estado, setEstado] = useState<EstadoVentaMeta | null>(null);
  const [form, setForm] = useState(false);
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const cargar = useCallback(() => {
    estadoVentaMeta(chatId)
      .then(setEstado)
      .catch(() => setEstado(null));
  }, [chatId]);

  useEffect(() => {
    cargar();
    const alCambiar = () => cargar();
    window.addEventListener("respondo:detalle-cambio", alCambiar);
    return () => window.removeEventListener("respondo:detalle-cambio", alCambiar);
  }, [cargar]);

  if (!estado) return null;

  const cot = estado.cotizacion;
  const datos = [
    cot.producto && `${cot.producto}${cot.tipo ? ` (${cot.tipo})` : ""}`,
    cot.cantidad && `${cot.cantidad.toLocaleString("es-CL")} unidades`,
    cot.empresa,
    cot.fechaNecesita && `para ${cot.fechaNecesita}`,
    cot.tieneLogo === true ? "con logo" : cot.tieneLogo === false ? "sin logo" : null,
  ].filter(Boolean) as string[];

  const tras = (r: { ok: boolean; error?: string }, ok: string) => {
    if (!r.ok) {
      setError(r.error ?? "No se pudo completar.");
      return;
    }
    setError(null);
    setAviso(ok);
    setForm(false);
    setMonto("");
    window.dispatchEvent(new Event("respondo:detalle-cambio"));
    cargar();
  };

  return (
    <section className="px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="rotulo">Venta y cotización</h3>
        {estado.vieneDeAnuncio && (
          <span style={{ fontSize: "var(--t-meta)", color: "var(--azul)" }}>Vino de un anuncio</span>
        )}
      </div>

      <p style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
        {estado.vieneDeAnuncio
          ? `Anuncio: ${estado.anuncio ?? "sin título"}. Lo que marques acá se le informa a Meta.`
          : "No vino de un anuncio: lo que marques queda en Respondo, pero no se le informa a Meta."}
      </p>

      {datos.length > 0 && (
        <p className="mt-2" style={{ fontSize: "var(--t-cuerpo)" }}>
          {datos.join(" · ")}
        </p>
      )}

      {estado.calificada && (
        <p className="mt-1" style={{ fontSize: "var(--t-meta)", color: "var(--ok)" }}>
          ✓ Cotización calificada{estado.calificadaManual ? " (marcada a mano)" : ""}
        </p>
      )}

      {estado.ventas.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {estado.ventas.map((v) => (
            <li key={v.id} style={{ fontSize: "var(--t-menor)" }}>
              ✓ Venta {pesos(v.monto)} neto
            </li>
          ))}
        </ul>
      )}

      {!form ? (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className="btn-azul w-full justify-center" disabled={pendiente} onClick={() => { setAviso(null); setForm(true); }}>
            Marcar como venta
          </button>
          {!estado.calificada && (
            <button
              type="button"
              className="btn-suave w-full justify-center"
              disabled={pendiente}
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("chatId", chatId);
                  tras(await marcarCotizacionCalificada(fd), "Cotización marcada como calificada.");
                })
              }
            >
              {pendiente ? "Guardando…" : "Cotización calificada"}
            </button>
          )}
        </div>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const fd = new FormData();
              fd.set("empleadoId", empleadoId);
              fd.set("chatId", chatId);
              fd.set("monto", monto);
              tras(await marcarVenta(fd), "Venta guardada.");
            });
          }}
        >
          <label className="block">
            <span className="rotulo">Monto neto de la venta (CLP, sin IVA)</span>
            <input
              className="campo mt-1"
              inputMode="numeric"
              autoFocus
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="450.000"
              required
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-azul flex-1 justify-center" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Confirmar venta"}
            </button>
            <button type="button" className="btn-suave" onClick={() => setForm(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {aviso && !error && (
        <p className="mt-2" style={{ fontSize: "var(--t-meta)", color: "var(--ok)" }}>
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
          {error}
        </p>
      )}

      {estado.vieneDeAnuncio && estado.eventos.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {estado.eventos.map((e, i) => (
            <li key={`${e.tipo}-${i}`} style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }} title={e.motivo ?? undefined}>
              Meta · {ETIQUETA_EVENTO[e.tipo] ?? e.tipo}: {ETIQUETA_ESTADO[e.estado] ?? e.estado}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
