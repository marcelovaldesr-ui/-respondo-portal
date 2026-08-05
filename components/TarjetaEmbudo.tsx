"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cambiarEtapa, volverAutomatico } from "@/app/(portal)/embudo/acciones";
import { ETAPAS, type Etapa } from "@/lib/embudo";
import { metaEtiqueta } from "@/lib/etiquetas";
import { fechaCorta } from "@/lib/fechas";

/**
 * Tarjeta de una conversación en el tablero.
 *
 * Sin arrastrar y soltar a propósito: en un teléfono —que es donde Cecilia lo va
 * a usar— arrastrar es incómodo y propenso a errores. Un menú de "mover a" es
 * más rápido, funciona igual en escritorio y no necesita librerías.
 */
export default function TarjetaEmbudo({
  chatId,
  contacto,
  etapa,
  etapaManual,
  etiquetas,
  ultimoMensaje,
  ultimoEn,
  esperandoHumano,
  empleadoId,
}: {
  chatId: string;
  contacto: string;
  etapa: Etapa;
  etapaManual: boolean;
  etiquetas: string[];
  ultimoMensaje: string;
  ultimoEn: string | null;
  esperandoHumano: boolean;
  empleadoId: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const mover = (destino: Etapa) => {
    setAbierto(false);
    iniciar(async () => {
      const fd = new FormData();
      fd.set("chatId", chatId);
      fd.set("etapa", destino);
      await cambiarEtapa(fd);
    });
  };

  return (
    <div
      className="tarjeta relative p-3.5"
      style={{ opacity: pendiente ? 0.5 : 1, transition: "opacity .15s" }}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/conversaciones?emp=${empleadoId}&chat=${chatId}`}
          className="min-w-0 flex-1"
        >
          <div className="truncate text-[14px] font-bold">{contacto}</div>
        </Link>
        <button
          type="button"
          aria-label="Mover de etapa"
          onClick={() => setAbierto((v) => !v)}
          className="shrink-0 rounded-lg px-1.5 py-0.5 text-[16px] leading-none"
          style={{ color: "var(--muted-2)" }}
        >
          ⋯
        </button>
      </div>

      {ultimoMensaje && (
        <div className="mt-1 line-clamp-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
          {ultimoMensaje}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {esperandoHumano && <span className="pildora-alerta">Te espera</span>}
        {etiquetas.slice(0, 2).map((v) => {
          const m = metaEtiqueta(v);
          return (
            <span key={v} className="pildora" style={{ background: m.fondo, color: m.color }}>
              {m.label}
            </span>
          );
        })}
        {etapaManual && (
          <span
            className="pildora"
            style={{ background: "#F1F2F7", color: "var(--muted)" }}
            title="La moviste a mano: el asistente ya no la cambia sola"
          >
            fijada
          </span>
        )}
        {ultimoEn && (
          <span className="ml-auto text-[11px]" style={{ color: "var(--muted-2)" }}>
            {fechaCorta(ultimoEn)}
          </span>
        )}
      </div>

      {/* Menú de movimiento */}
      {abierto && (
        <div
          className="tarjeta absolute right-2 top-9 z-20 w-[190px] p-1.5"
          style={{ boxShadow: "var(--sombra-alta)" }}
        >
          {ETAPAS.filter((e) => e.valor !== etapa).map((e) => (
            <button
              key={e.valor}
              type="button"
              onClick={() => mover(e.valor)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold hover:bg-[#F6F7FB]"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
              Mover a {e.label}
            </button>
          ))}
          {etapaManual && (
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                iniciar(async () => {
                  const fd = new FormData();
                  fd.set("chatId", chatId);
                  await volverAutomatico(fd);
                });
              }}
              className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-[#F6F7FB]"
              style={{ color: "var(--muted)", borderTop: "1px solid var(--borde)" }}
            >
              Que la maneje el asistente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
