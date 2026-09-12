"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cambiarEtapa, volverAutomatico } from "@/app/(portal)/embudo/acciones";
import { ETAPAS, MOTIVOS_PERDIDA, etiquetaMotivoEtapa, type Etapa } from "@/lib/etapasCore";
import { metaEtiqueta } from "@/lib/etiquetas";
import { fechaCorta } from "@/lib/fechas";
import { Estado } from "@/components/estado/Estados";

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
  motivo,
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
  motivo?: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const mover = (destino: Etapa, motivoPerdida?: string) => {
    setAbierto(false);
    setPidiendoMotivo(false);
    iniciar(async () => {
      const fd = new FormData();
      fd.set("chatId", chatId);
      fd.set("etapa", destino);
      if (motivoPerdida) fd.set("motivo", motivoPerdida);
      const r = await cambiarEtapa(fd);
      // (Fase 1) El error ya no queda mudo.
      setError(r.ok ? null : r.error ?? "No se pudo mover");
    });
  };
  // Motivo visible solo donde informa: por qué se perdió o por qué se ganó.
  const textoMotivo = etapa === "perdido" || etapa === "ganado" ? etiquetaMotivoEtapa(etapa, motivo) : null;

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
          <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
            {contacto}
          </div>
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
        <div className="mt-1 line-clamp-2" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          {ultimoMensaje}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {textoMotivo && <Estado tono={etapa === "ganado" ? "ok" : "neutro"}>{textoMotivo}</Estado>}
        {/* «Te espera» con el mismo tono que en la bandeja y la ficha. */}
        {esperandoHumano && (
          <Estado tono="peligro" punto>
            Te espera
          </Estado>
        )}
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
            style={{ background: "var(--fondo-hundido)", color: "var(--muted)" }}
            title="La moviste a mano: el asistente ya no la cambia sola"
          >
            fijada
          </span>
        )}
        {ultimoEn && (
          <span className="cifra ml-auto" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
            {fechaCorta(ultimoEn)}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2" role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
          {error}
        </p>
      )}

      {/* Menú de movimiento */}
      {abierto && (
        <div
          className="tarjeta absolute right-2 top-9 z-20 w-[220px] p-1.5"
          style={{ boxShadow: "var(--sombra-alta)" }}
        >
          {pidiendoMotivo ? (
            /*
              POR QUÉ SE PERDIÓ (Fase 1). «Sin respuesta» deja que Beto la
              retome; los demás motivos la cierran de verdad, y «no quiere
              que lo contacten» además marca la conversación para que nada
              del producto le vuelva a escribir.
            */
            <>
              <div className="px-2.5 pb-1 pt-1.5 font-semibold" style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>
                ¿Por qué se perdió?
              </div>
              {MOTIVOS_PERDIDA.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => mover("perdido", m.valor)}
                  className="flex w-full items-center rounded-md px-2.5 py-2 text-left font-semibold hover:bg-[var(--fondo-hundido)]"
                  style={{ fontSize: "var(--t-cuerpo)" }}
                >
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPidiendoMotivo(false)}
                className="mt-1 w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--fondo-hundido)]"
                style={{ fontSize: "var(--t-menor)", color: "var(--muted)", borderTop: "1px solid var(--borde)" }}
              >
                ← Volver
              </button>
            </>
          ) : (
            <>
              {ETAPAS.filter((e) => e.valor !== etapa).map((e) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => (e.valor === "perdido" ? setPidiendoMotivo(true) : mover(e.valor))}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-semibold hover:bg-[var(--fondo-hundido)]"
                  style={{ fontSize: "var(--t-cuerpo)" }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
                  Mover a {e.label}
                  {e.valor === "perdido" && <span className="ml-auto" aria-hidden>›</span>}
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
                  className="mt-1 w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--fondo-hundido)]"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)", borderTop: "1px solid var(--borde)" }}
                >
                  Que la maneje el asistente
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
