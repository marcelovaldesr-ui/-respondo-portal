"use client";

import { memo, useState } from "react";
import type { MediaUI } from "./tipos";

/**
 * EL ADJUNTO DENTRO DE UNA BURBUJA.
 *
 * QUÉ ESTABA MAL ANTES
 * --------------------
 *  - `<img>` suelto, sin dimensiones: la burbuja crecía de golpe al terminar la
 *    descarga y **empujaba toda la conversación hacia abajo**. Si estabas
 *    leyendo, perdías el punto.
 *  - Sin `loading="lazy"`: un chat con treinta fotos las pedía todas de una,
 *    aunque veintiocho estuvieran fuera de pantalla.
 *  - Sin manejo de error: si el archivo no estaba, quedaba el ícono roto del
 *    navegador dentro de la conversación de un cliente.
 *  - Abrir la imagen te sacaba del portal a una pestaña nueva.
 *
 * LO QUE HACE AHORA
 * -----------------
 * Reserva el espacio ANTES de cargar (caja de tamaño fijo, como WhatsApp Web),
 * carga solo lo visible, aparece con una transición corta en vez de saltar, y
 * al tocar abre un visor encima sin salir de la página.
 */

const CAJA = { ancho: 240, alto: 200 };

function VisorImagen({
  url,
  nombre,
  onCerrar,
}: {
  url: string;
  nombre: string;
  onCerrar: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={nombre}
      onClick={onCerrar}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(6,9,20,.86)", backdropFilter: "blur(2px)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={nombre}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-lg"
        style={{ objectFit: "contain" }}
      />
      <div className="absolute right-4 top-4 flex gap-2">
        <a
          href={url}
          download={nombre}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
          style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}
        >
          Descargar
        </a>
        <button
          onClick={onCerrar}
          aria-label="Cerrar"
          className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
          style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

function AdjuntoBase({ media, previa }: { media?: MediaUI | null; previa?: string | null }) {
  const [cargada, setCargada] = useState(false);
  const [rota, setRota] = useState(false);
  const [abierta, setAbierta] = useState(false);

  // Vista previa local mientras sube: se ve la foto al instante, igual que en
  // WhatsApp, en vez de un hueco hasta que el servidor confirme.
  const url = previa || media?.url;
  if (!url) return null;

  const esImagen =
    Boolean(previa) || media?.tipo === "imagen" || media?.mime?.startsWith("image/");
  const nombre = media?.nombre || "imagen";

  if (esImagen) {
    if (rota) {
      return (
        <div
          className="mt-1 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px]"
          style={{ borderColor: "var(--borde)", color: "var(--muted)" }}
        >
          🖼️ No se pudo cargar la imagen
        </div>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => !previa && setAbierta(true)}
          className="relative mt-1 block overflow-hidden rounded-lg border"
          style={{
            borderColor: "var(--borde)",
            // El espacio se reserva ANTES de que llegue el archivo: sin esto la
            // conversación entera salta cuando termina la descarga.
            width: CAJA.ancho,
            height: CAJA.alto,
            background: "#EEF0F5",
            cursor: previa ? "default" : "zoom-in",
          }}
          aria-label={previa ? "Enviando imagen" : "Ampliar imagen"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={nombre}
            loading="lazy"
            decoding="async"
            onLoad={() => setCargada(true)}
            onError={() => setRota(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: cargada ? 1 : 0,
              transition: "opacity .18s ease-out",
            }}
          />
          {previa && (
            <span
              className="absolute inset-x-0 bottom-0 py-1 text-center text-[11px] font-semibold"
              style={{ background: "rgba(10,14,32,.55)", color: "#fff" }}
            >
              Enviando…
            </span>
          )}
        </button>
        {abierta && media?.url && (
          <VisorImagen url={media.url} nombre={nombre} onCerrar={() => setAbierta(false)} />
        )}
      </>
    );
  }

  if (media?.tipo === "audio" || media?.mime?.startsWith("audio/")) {
    // `preload="none"`: un chat con muchos audios no debe descargarlos todos
    // solo por estar abierto.
    return <audio controls preload="none" src={media.url} className="mt-1 w-full max-w-[260px]" />;
  }

  const etiqueta =
    media?.tipo === "video" ? "Ver video" : media?.nombre ? `Abrir ${media.nombre}` : "Ver archivo";
  return (
    <a
      href={media?.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px]"
      style={{ borderColor: "var(--borde)", color: "var(--tinta)" }}
    >
      📎 {etiqueta}
    </a>
  );
}

/**
 * `memo` porque el adjunto es lo más caro de la burbuja y su contenido no cambia
 * nunca: una foto enviada es inmutable. Sin esto se volvía a evaluar en cada
 * actualización de la lista.
 */
export const Adjunto = memo(AdjuntoBase);
