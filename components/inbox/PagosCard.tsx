"use client";

import { useEffect, useState } from "react";
import { avisarPedidoListo, marcarPago } from "@/app/(portal)/conversaciones/accionesPagos";
import { formatearMonto } from "@/lib/pagosCore";
import type { Pago } from "@/lib/pagos";
import { ESTADO_COBRO } from "@/lib/estadoComercialVista";
import { Estado } from "@/components/estado/Estados";

/**
 * TARJETAS DEL PANEL DE CONTEXTO: los cobros del chat y el aviso de pedido.
 *
 * Manejan su propio estado local: al marcar pagado no se recarga el detalle
 * entero, la fila cambia al tiro. La condición de carrera real (dos personas
 * marcando a la vez) la resuelve el servidor con el update condicionado — si
 * este cliente llegó segundo, recibe el error y se le muestra.
 */


export function PagosCard({ pagos: iniciales }: { pagos: Pago[] | undefined }) {
  /**
   * ⚠️ `?? []` NO ES PARANOIA (auditoría 27-ago, 2ª pasada): el detalle de la
   * conversación se cachea en sessionStorage por 10 minutos y SOBREVIVE AL
   * DEPLOY. Un detalle guardado con la forma anterior no trae `pagos`, y
   * `undefined.length` habría roto la pantalla justo después de desplegar —
   * para todos los que tenían el portal abierto, que es cuando peor se ve.
   */
  const [pagos, setPagos] = useState(iniciales ?? []);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Cuando el detalle se refresca (cobro nuevo, refresco de la lista), la
  // tarjeta sigue a la lista del servidor en vez de quedarse con la primera.
  useEffect(() => {
    setPagos(iniciales ?? []);
  }, [iniciales]);

  if (!pagos.length) return null;

  const cambiar = async (p: Pago, hacia: "pagado" | "anulado") => {
    if (ocupado) return;
    setOcupado(p.id);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("pagoId", p.id);
      fd.set("desde", p.estado);
      fd.set("hacia", hacia);
      const r = await marcarPago(fd);
      if (r.ok) {
        setPagos((xs) => xs.map((x) => (x.id === p.id ? { ...x, estado: hacia } : x)));
        window.dispatchEvent(new Event("respondo:detalle-cambio"));
      } else {
        setError(r.error ?? "No se pudo actualizar");
      }
    } finally {
      setOcupado(null);
    }
  };

  /**
   * (Fase 1) Sección plana dentro de la ficha lateral: sin tarjeta anidada,
   * estados con el tono compartido (lib/estadoComercialVista.ts) y botones
   * de 12,5 px con objetivo táctil real. El mapa de colores estaba copiado
   * con los mismos hex acá y en CobrosLista.
   */
  return (
    <section className="px-4 py-3.5">
      <h3 className="rotulo mb-2">Cobros de este chat</h3>
      <ul className="space-y-2">
        {pagos.map((p) => {
          const e = ESTADO_COBRO[p.estado] ?? ESTADO_COBRO.pendiente;
          return (
            <li key={p.id} className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--borde)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="cifra font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                  {formatearMonto(p.monto)}
                </span>
                <Estado tono={e.tono}>{e.label}</Estado>
              </div>
              <div className="truncate" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                {p.concepto}
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="cifra" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                  {/* El folio del negocio manda: es el que se le pidió al
                      cliente y con el que se encuentra el trabajo. La
                      referencia interna queda detrás, para conciliar. */}
                  {p.referenciaExterna ? `N° ${p.referenciaExterna} · ${p.referencia}` : p.referencia}
                </span>
                {p.estado === "pendiente" && (
                  <span className="flex gap-1.5">
                    <button
                      onClick={() => void cambiar(p, "pagado")}
                      disabled={ocupado === p.id}
                      className="btn-fila disabled:opacity-50"
                      style={{ minHeight: 28, fontSize: "var(--t-menor)", color: "var(--ok)" }}
                    >
                      Marcar pagado
                    </button>
                    <button
                      onClick={() => void cambiar(p, "anulado")}
                      disabled={ocupado === p.id}
                      className="btn-texto disabled:opacity-50"
                      style={{ minHeight: 28, padding: "0 6px", fontSize: "var(--t-menor)" }}
                    >
                      Anular
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2" role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * AVISAR QUE EL PEDIDO ESTÁ LISTO — el camino universal, sin ERP.
 *
 * Un toque programa el aviso por el motor de seguimientos, que decide solo si
 * sale como texto libre (ventana abierta, gratis) o como la plantilla
 * `pedido_listo`. Sale en la próxima pasada del cron (≤5 min); para «tu pedido
 * está listo» esa espera es irrelevante y a cambio hereda todas las
 * salvaguardas: horario hábil, no_contactar, reintentos.
 */
export function AvisarPedido({
  empleadoId,
  chatId,
}: {
  empleadoId: string;
  chatId: string;
}) {
  const [detalle, setDetalle] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "listo" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const avisar = async () => {
    if (estado === "enviando") return;
    setEstado("enviando");
    setError(null);
    try {
      const fd = new FormData();
      fd.set("empleadoId", empleadoId);
      fd.set("chatId", chatId);
      fd.set("detalle", detalle.trim());
      const r = await avisarPedidoListo(fd);
      if (r.ok) {
        setEstado("listo");
        setDetalle("");
      } else {
        setEstado("error");
        setError(r.error ?? "No se pudo programar el aviso");
      }
    } catch {
      setEstado("error");
      setError("No se pudo programar el aviso");
    }
  };

  return (
    <section className="px-4 py-3.5">
      <h3 className="rotulo mb-2">Pedido listo</h3>
      {estado === "listo" ? (
        <p style={{ fontSize: "var(--t-menor)", color: "var(--ok)" }}>
          ✓ Aviso programado. Sale en minutos dentro del horario hábil — si es de
          noche o fin de semana, parte a primera hora.
        </p>
      ) : (
        <>
          <input
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            maxLength={80}
            placeholder="qué pedido (ej: 500 tarjetas)"
            className="campo mb-2 w-full"
          />
          <button
            onClick={() => void avisar()}
            disabled={estado === "enviando"}
            className="btn-suave w-full justify-center disabled:opacity-50"
          >
            {estado === "enviando" ? "Programando…" : "Avisar que está listo para retirar"}
          </button>
          {error && (
            <p className="mt-2" role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
