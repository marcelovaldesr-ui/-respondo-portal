"use client";

import { useState, useTransition } from "react";
import { desconectar, elegirCuenta } from "@/app/(marketing)/marketing/integraciones/acciones";
import type { CuentaPublicitaria } from "@/lib/ads/proveedor";

/**
 * Elegir cuál de las cuentas publicitarias autorizadas es la de este negocio.
 *
 * POR QUÉ SE PREGUNTA EN VEZ DE ADIVINAR: quien administra dos negocios ve las
 * dos cuentas. Tomar la primera de la lista significaría mostrarle durante
 * semanas las cifras del otro negocio, y como los números «se ven bien», nadie
 * lo notaría hasta tomar una decisión de plata con ellos.
 *
 * El mismo componente sirve para desconectar (`soloDesconectar`), porque las
 * dos acciones viven en la misma tarjeta y no vale la pena un archivo más.
 */
export default function SelectorCuenta({
  cuentas,
  soloDesconectar = false,
}: {
  cuentas: CuentaPublicitaria[];
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
                  const r = await desconectar();
                  if (!r.ok) setError(r.motivo ?? "No se pudo desconectar.");
                })
              }
            >
              {pendiente ? "Desconectando…" : "Sí, desconectar"}
            </button>
            <button type="button" className="btn-texto" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" className="btn-texto" onClick={() => setConfirmando(true)}>
            Desconectar
          </button>
        )}
        {error && (
          <span style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>{error}</span>
        )}
      </>
    );
  }

  if (!cuentas.length) {
    return (
      <p style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
        No encontramos cuentas publicitarias en esa cuenta de Meta.
      </p>
    );
  }

  return (
    <div>
      <div style={{ fontSize: "var(--t-menor)", fontWeight: 600 }}>
        ¿Cuál es la cuenta de este negocio?
      </div>
      <p className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        Elegimos nosotros solo si hay una. Con varias preferimos preguntarte antes que mostrarte
        las cifras equivocadas.
      </p>

      <ul className="mt-3 space-y-2">
        {cuentas.map((c) => (
          <li key={c.id} className="tarjeta-plana flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ fontSize: "var(--t-fila)", fontWeight: 600 }}>
                {c.nombre}
              </div>
              <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                {c.id} · factura en {c.moneda} · {c.zonaHoraria}
                {!c.activa && " · sin publicar en Meta"}
              </div>
            </div>
            <button
              type="button"
              className="btn-chico"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const fd = new FormData();
                  fd.set("cuentaId", c.id);
                  const r = await elegirCuenta(fd);
                  if (!r.ok) setError(r.motivo ?? "No se pudo guardar.");
                })
              }
            >
              Usar esta
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--alerta)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
