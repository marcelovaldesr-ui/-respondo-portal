"use client";

import { useState, useTransition } from "react";
import { desconectarGoogle, elegirCuentaGoogle } from "@/app/(marketing)/marketing/integraciones/acciones";

/**
 * Elegir cuál de las cuentas de Google Ads autorizadas es la de este negocio.
 *
 * MISMA REGLA QUE EN META Y POR EL MISMO MOTIVO: no se adivina. En Google es
 * todavía más frecuente ver varias —quien administra su negocio y el de un
 * familiar, o una agencia con veinte cuentas bajo una administradora— y tomar
 * la primera sería mostrarle a alguien las cifras de otro negocio sin que se
 * note, que es la clase de error que se descubre recién al tomar una decisión
 * de plata.
 *
 * ⭐ Las cuentas ADMINISTRADORAS se muestran, pero no se pueden elegir: no
 * tienen campañas propias. Ocultarlas haría que alguien buscara «su» cuenta en
 * una lista donde falta la que reconoce; mostrarlas deshabilitadas explica por
 * qué no sirve la que estaba buscando.
 */
export type CuentaGoogleUI = {
  id: string;
  nombre: string;
  moneda: string;
  administradora: boolean;
  /** Formateado 123-456-7890 para que se reconozca al primer vistazo. */
  idLegible: string;
};

export default function SelectorCuentaGoogle({
  cuentas,
  soloDesconectar = false,
}: {
  cuentas: CuentaGoogleUI[];
  soloDesconectar?: boolean;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  if (soloDesconectar) {
    return (
      <>
        {confirmando ? (
          <>
            <button
              type="button"
              className="btn-peligro"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const r = await desconectarGoogle();
                  if (!r.ok) setError(r.motivo ?? "No se pudo desconectar.");
                })
              }
            >
              Confirmar
            </button>
            <button type="button" className="btn-chico" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" className="btn-chico" onClick={() => setConfirmando(true)}>
            Desconectar
          </button>
        )}
        {error && (
          <p className="mt-2" style={{ fontSize: "12px", color: "var(--alerta)" }}>
            {error}
          </p>
        )}
      </>
    );
  }

  const elegibles = cuentas.filter((c) => !c.administradora);

  return (
    <div>
      <p className="mk-dato-mini-etiqueta">¿Cuál de estas cuentas es la de este negocio?</p>
      <ul className="mt-2 space-y-1.5">
        {cuentas.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate" style={{ fontSize: "13px", fontWeight: 600 }}>
                {c.nombre}
              </span>
              <span className="mk-meta">
                {c.idLegible} · {c.moneda}
                {c.administradora ? " · administradora (no tiene campañas propias)" : ""}
              </span>
            </span>
            <button
              type="button"
              className="btn-chico shrink-0"
              disabled={pendiente || c.administradora}
              onClick={() =>
                iniciar(async () => {
                  setError(null);
                  const fd = new FormData();
                  fd.set("cuentaId", c.id);
                  const r = await elegirCuentaGoogle(fd);
                  if (!r.ok) setError(r.motivo ?? "No se pudo guardar.");
                })
              }
            >
              Elegir
            </button>
          </li>
        ))}
      </ul>
      {elegibles.length === 0 && (
        <p className="mt-2" style={{ fontSize: "12px", color: "var(--alerta)" }}>
          Solo hay cuentas administradoras autorizadas. Hay que autorizar la cuenta que tiene las campañas.
        </p>
      )}
      {error && (
        <p className="mt-2" style={{ fontSize: "12px", color: "var(--alerta)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
