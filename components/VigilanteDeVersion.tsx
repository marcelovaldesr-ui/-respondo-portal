"use client";

import { useEffect } from "react";
import { esErrorDeVersion, intentarRecargarPorVersion } from "@/lib/erroresDeVersion";

/**
 * VIGILANTE DE VERSIÓN — ataja el desajuste de deploy ANTES del borde de error.
 *
 * POR QUÉ NO BASTA CON LOS BORDES
 * Un borde de error de React solo se entera de lo que revienta DURANTE un
 * render. Cuando lo que falla es la descarga de un archivo de la app, el fallo
 * ocurre fuera de React: es una promesa rechazada del cargador de módulos. A
 * veces React se entera y monta el borde —y ahí el cliente ve el cartel medio
 * segundo— y a veces no se entera y la navegación simplemente no pasa nada.
 *
 * Escuchando los eventos del navegador se atrapa el caso antes: la pestaña se
 * recarga sola y la persona ve, como mucho, el parpadeo normal de una recarga.
 * El cartel queda como lo que debe ser —una red por si acaso— y no como algo
 * que aparece cada vez que subimos una versión.
 *
 * QUÉ NO HACE
 * No toca ningún otro error. Si algo se rompe de verdad, el borde lo muestra y
 * la persona decide. Recargar solo tiene sentido cuando el problema es que la
 * pestaña quedó vieja, y eso se sabe por el mensaje del error.
 */
export default function VigilanteDeVersion() {
  useEffect(() => {
    /**
     * Lo que NO es un error de versión se reporta al servidor.
     *
     * Antes se descartaba en silencio, y eso nos dejó ciegos: el 19-ago-2026 el
     * portal se caía en todas las pantallas y en varios computadores, y en
     * Vercel no había ni una línea, porque el fallo nunca salía del navegador.
     * Un error que solo ve el cliente es un error que nadie arregla.
     */
    const reportar = (error: unknown, origen: string) => {
      try {
        const e = error as { message?: string; stack?: string } | null;
        const mensaje = e?.message ?? String(error);
        if (!mensaje || mensaje === "null" || mensaje === "undefined") return;
        // keepalive: si el error ocurre justo antes de una navegación, el envío
        // igual sale. Sin esto se pierde justo el caso más interesante.
        void fetch("/api/error-cliente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            mensaje,
            pila: e?.stack ?? "",
            ruta: window.location.pathname,
            origen,
            version: process.env.NEXT_PUBLIC_VERSION_DESPLIEGUE ?? "",
          }),
        }).catch(() => {
          /* si ni siquiera se puede reportar, no hay nada más que hacer */
        });
      } catch {
        /* reportar un error jamás puede provocar otro */
      }
    };

    const recargar = (error: unknown, origen: string) => {
      if (!esErrorDeVersion(error)) {
        reportar(error, origen);
        return;
      }
      if (!intentarRecargarPorVersion(error)) return;
      console.info(`[respondo] versión desactualizada (${origen}) — recargando`);
      window.location.reload();
    };

    // Promesas rechazadas: es la forma en que llega el fallo de import().
    const onRechazo = (e: PromiseRejectionEvent) => recargar(e.reason, "promesa");
    // Errores sueltos, incluidos los de carga de <script>.
    const onError = (e: ErrorEvent) => recargar(e.error ?? { message: e.message }, "error");

    window.addEventListener("unhandledrejection", onRechazo);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRechazo);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
