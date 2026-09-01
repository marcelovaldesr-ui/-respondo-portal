"use client";

import { useState } from "react";
import { avisarPedidoListo, marcarPago } from "@/app/(portal)/conversaciones/accionesPagos";
import { formatearMonto } from "@/lib/pagosCore";
import type { Pago } from "@/lib/pagos";

/**
 * TARJETAS DEL PANEL DE CONTEXTO: los cobros del chat y el aviso de pedido.
 *
 * Manejan su propio estado local: al marcar pagado no se recarga el detalle
 * entero, la fila cambia al tiro. La condición de carrera real (dos personas
 * marcando a la vez) la resuelve el servidor con el update condicionado — si
 * este cliente llegó segundo, recibe el error y se le muestra.
 */

const ETIQUETA: Record<Pago["estado"], { txt: string; color: string; fondo: string }> = {
  pendiente: { txt: "pendiente", color: "#92400E", fondo: "#FEF3C7" },
  pagado: { txt: "pagado", color: "#166534", fondo: "#DCFCE7" },
  anulado: { txt: "anulado", color: "#6B7280", fondo: "#F3F4F6" },
};

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
      } else {
        setError(r.error ?? "No se pudo actualizar");
      }
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="tarjeta p-3.5">
      <div
        className="mb-2 font-semibold uppercase"
        style={{ fontSize: "var(--t-micro)", letterSpacing: ".08em", color: "var(--muted-3)" }}
      >
        Cobros de este chat
      </div>
      <div className="space-y-2">
        {pagos.map((p) => {
          const e = ETIQUETA[p.estado];
          return (
            <div
              key={p.id}
              className="rounded-lg border p-2"
              style={{ borderColor: "var(--borde)" }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="cifra text-[13px] font-bold">{formatearMonto(p.monto)}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ color: e.color, background: e.fondo }}
                >
                  {e.txt}
                </span>
              </div>
              <div className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                {p.concepto}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="cifra text-[10.5px]" style={{ color: "var(--muted-2)" }}>
                  {p.referencia}
                </span>
                {p.estado === "pendiente" && (
                  <span className="flex gap-1">
                    <button
                      onClick={() => void cambiar(p, "pagado")}
                      disabled={ocupado === p.id}
                      className="rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
                      style={{ background: "#DCFCE7", color: "#166534" }}
                    >
                      Marcar pagado
                    </button>
                    <button
                      onClick={() => void cambiar(p, "anulado")}
                      disabled={ocupado === p.id}
                      className="rounded px-2 py-0.5 text-[11px] disabled:opacity-50"
                      style={{ background: "#F3F4F6", color: "#6B7280" }}
                    >
                      Anular
                    </button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-[12px]" style={{ color: "var(--alerta, #B91C1C)" }}>
          {error}
        </p>
      )}
    </div>
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
    <div className="tarjeta p-3.5">
      <div
        className="mb-2 font-semibold uppercase"
        style={{ fontSize: "var(--t-micro)", letterSpacing: ".08em", color: "var(--muted-3)" }}
      >
        Pedido listo
      </div>
      {estado === "listo" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ok, #15803D)" }}>
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
            className="campo mb-2 w-full text-[12.5px]"
          />
          <button
            onClick={() => void avisar()}
            disabled={estado === "enviando"}
            className="btn-suave w-full justify-center text-[12.5px] disabled:opacity-50"
          >
            {estado === "enviando" ? "Programando…" : "Avisar que está listo para retirar"}
          </button>
          {error && (
            <p className="mt-2 text-[12px]" style={{ color: "var(--alerta, #B91C1C)" }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
