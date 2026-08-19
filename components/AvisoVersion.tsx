"use client";

import { useEffect, useState } from "react";

/**
 * AVISO DE VERSIÓN NUEVA.
 *
 * EL PROBLEMA QUE RESUELVE: tras cada despliegue, las pestañas ya abiertas
 * siguen con el JavaScript anterior. En cuanto el dueño aprieta un botón que
 * llama a una acción del servidor —"Enviar", "Tomar el control"—, esa acción ya
 * no existe con el mismo identificador y el portal se cae con un error que no
 * significa nada para él. Pasó de verdad el 17-ago-2026, con el portal abierto
 * mientras se desplegaba varias veces seguidas.
 *
 * Antes solo había recuperación: el límite de error atrapaba el golpe y pedía
 * recargar. Eso llega tarde — el cliente ya perdió lo que estaba escribiendo y
 * ya vio una pantalla rota mientras atendía a alguien.
 *
 * Esto lo detecta ANTES: compara la versión horneada en el paquete contra la
 * que está viva en el servidor.
 *
 * POR QUÉ NO RECARGA SOLO: puede haber un mensaje a medio escribir en la
 * bandeja. Recargar sin avisar lo borraría, y eso es peor que el problema que
 * arregla. Se muestra un aviso discreto y decide la persona.
 *
 * CUÁNDO CONSULTA: al volver a la pestaña y cada 10 minutos. No en cada
 * navegación: son negocios con el portal abierto todo el día y no hace falta
 * preguntar cada dos minutos por algo que cambia una vez por semana.
 */

const MIA = process.env.NEXT_PUBLIC_VERSION_DESPLIEGUE ?? "local";
const CADA_MS = 10 * 60_000;

export default function AvisoVersion() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    // En desarrollo no aplica: el valor es "local" en las dos puntas.
    if (MIA === "local") return;

    let vivo = true;

    const revisar = async () => {
      if (!vivo || hayNueva || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { version?: string };
        // Si el servidor no sabe su versión, no se molesta a nadie.
        if (j.version && j.version !== "local" && j.version !== MIA) setHayNueva(true);
      } catch {
        /* sin conexión: no es asunto de este aviso */
      }
    };

    const alVolver = () => {
      if (document.visibilityState === "visible") revisar();
    };

    document.addEventListener("visibilitychange", alVolver);
    const id = setInterval(revisar, CADA_MS);
    revisar();

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(id);
    };
  }, [hayNueva]);

  if (!hayNueva) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-3 shadow-lg"
      style={{ background: "var(--tinta)", color: "#fff" }}
    >
      <span style={{ fontSize: "13.5px" }}>Hay una versión nueva de Respondo.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full px-3.5 py-1.5 font-bold"
        style={{ background: "var(--indigo)", color: "#fff", fontSize: "13px" }}
      >
        Actualizar
      </button>
    </div>
  );
}
