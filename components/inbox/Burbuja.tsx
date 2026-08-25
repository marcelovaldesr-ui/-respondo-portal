"use client";

import { memo } from "react";
import { Adjunto } from "./Adjunto";
import type { EstadoEnvio, MensajeUI } from "./tipos";

/** Hora del mensaje, SIEMPRE en hora de Chile. */
const hora = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("es-CL", {
      hour: "2-digit",
      minute: "2-digit",
      // Sin fijar la zona, el servidor (UTC) y el navegador (Chile) dibujan
      // horas distintas y falla la hidratación de React. Pasó en producción.
      timeZone: "America/Santiago",
    });
  } catch {
    return "";
  }
};

/**
 * ACUSE DE ENTREGA, como en WhatsApp.
 *
 * Los estados ya se guardaban en `ed_mensajes.estado_envio` desde la migración
 * 213 —el webhook los venía escribiendo— pero **el inbox no los mostraba**. O
 * sea que teníamos el dato de si un mensaje llegó y la persona no tenía forma de
 * verlo: quedaba con la duda de si el cliente lo recibió.
 */
function Acuse({ estado }: { estado: EstadoEnvio }) {
  if (!estado || estado === "pendiente") {
    return (
      <span title="Enviando" aria-label="Enviando" style={{ opacity: 0.55 }}>
        🕘
      </span>
    );
  }
  if (estado === "error") {
    return (
      <span title="No se pudo entregar" aria-label="No se pudo entregar" style={{ color: "#DC2626" }}>
        ⚠
      </span>
    );
  }
  const doble = estado === "entregado" || estado === "leido";
  const leido = estado === "leido";
  return (
    <span
      title={leido ? "Leído" : doble ? "Entregado" : "Enviado"}
      aria-label={leido ? "Leído" : doble ? "Entregado" : "Enviado"}
      style={{ color: leido ? "#38BDF8" : undefined, opacity: leido ? 1 : 0.75, letterSpacing: "-2px" }}
    >
      {doble ? "✓✓" : "✓"}
    </span>
  );
}

function BurbujaBase({ m }: { m: MensajeUI }) {
  const delCliente = m.rol === "cliente";
  const esHumano = m.rol === "humano";

  return (
    <div className={`flex ${delCliente ? "justify-start" : "justify-end"}`}>
      <div
        className={
          "max-w-[76%] px-3.5 py-2 leading-relaxed " +
          (delCliente ? "rounded-2xl rounded-bl-md border bg-white" : "rounded-2xl rounded-br-md")
        }
        style={
          /*
             BURBUJA DEL ASISTENTE EN ÍNDIGO CLARO, NO EN COLOR SÓLIDO.
             En una conversación donde el asistente escribe el 60% de los
             mensajes, el color pleno son bloques saturados ocupando media
             pantalla, y el ojo va al color en vez del texto. Un chat se lee.
          */
          delCliente
            ? { borderColor: "var(--borde)" }
            : esHumano
              ? { background: "#334155", color: "#fff" }
              : { background: "var(--indigo-suave)", color: "var(--tinta)" }
        }
      >
        {esHumano && (
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest opacity-80">
            Tú
          </div>
        )}
        {m.texto ? <div className="whitespace-pre-wrap">{m.texto}</div> : null}
        <Adjunto media={m.media} previa={m.previa} />
        <div
          className={"mt-1 flex items-center justify-end gap-1 text-[10.5px] " + (delCliente ? "" : "opacity-75")}
          style={delCliente ? { color: "var(--muted-2)" } : undefined}
        >
          <span>{hora(m.creadoEn)}</span>
          {!delCliente && <Acuse estado={m.fallido ? "error" : (m.estado ?? null)} />}
        </div>
      </div>
    </div>
  );
}

/**
 * `memo` con comparación explícita.
 *
 * ESTE ES EL CAMBIO QUE MÁS SE NOTA. Antes, cada tecla que se escribía en el
 * compositor volvía a dibujar las 200 burbujas, porque el texto en curso vivía
 * en el mismo componente que la lista. Con esto, una burbuja solo se vuelve a
 * dibujar si algo SUYO cambió.
 */
export const Burbuja = memo(
  BurbujaBase,
  (a, b) =>
    a.m.id === b.m.id &&
    a.m.texto === b.m.texto &&
    a.m.estado === b.m.estado &&
    a.m.fallido === b.m.fallido &&
    a.m.previa === b.m.previa &&
    a.m.media?.url === b.m.media?.url,
);
