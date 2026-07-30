"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Auto-refresco de la bandeja de Conversaciones.
 *
 * El chat abierto ya se actualiza solo (InboxConversacion hace poll cada 4s),
 * pero la LISTA era estática: con un inbox ocupado, las conversaciones nuevas
 * no aparecían hasta recargar a mano. Este componente refresca los datos del
 * servidor cada `segundos` (default 25s) usando router.refresh(), que re-rinde
 * el server component SIN recargar la página ni perder el scroll/estado.
 *
 * Se detiene cuando la pestaña no está visible (ahorra requests) y se reanuda
 * al volver.
 */
export default function RefrescarLista({ segundos = 25 }: { segundos?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, segundos * 1000);
    // refresco inmediato al volver a la pestaña
    const onVis = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, segundos]);

  return null;
}
