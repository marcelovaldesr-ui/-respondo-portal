"use client";

import { useEffect, useState } from "react";
import { intentarRecargarPorVersion } from "@/lib/erroresDeVersion";

/**
 * Límite de error del portal.
 *
 * El caso más común es un error de "chunk" tras un deploy nuevo: una pestaña
 * abierta con la versión anterior pide un archivo JS que ya cambió. Para eso NO
 * mostramos un cartel (queda feo, y peor si estás grabando): detectamos ese tipo
 * de error y **recargamos la página solos**, una sola vez (guardia anti-loop en
 * sessionStorage). El usuario ve, como mucho, un parpadeo de "Actualizando…".
 *
 * Para cualquier otro error mostramos el mensaje amable con recarga manual.
 */
export default function ErrorPortal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Decidir en el primer render si vamos a auto-recargar (para no parpadear el cartel).
  const [autorecarga] = useState(() => intentarRecargarPorVersion(error));

  /**
   * ¿Es de verdad una versión vieja, o estamos adivinando?
   *
   * El cartel afirmaba «suele pasar tras una actualización» para CUALQUIER
   * error. A un cliente con un problema real le decía que recargara, y el
   * problema seguía ahí. Ahora se pregunta: si la versión del servidor difiere
   * de la horneada en este paquete, la explicación es cierta; si coinciden,
   * falló otra cosa y hay que decirlo.
   */
  const [esVersionVieja, setEsVersionVieja] = useState<boolean | null>(null);

  useEffect(() => {
    console.error("[portal error boundary]", error);
    // Que quede también en los registros del servidor: en la consola del
    // cliente solo lo vemos si alguien está mirando en ese preciso momento.
    void fetch("/api/error-cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        mensaje: error.message,
        pila: error.stack ?? "",
        ruta: window.location.pathname,
        origen: `borde-portal${error.digest ? `:${error.digest}` : ""}`,
        version: process.env.NEXT_PUBLIC_VERSION_DESPLIEGUE ?? "",
      }),
    }).catch(() => {});
    if (autorecarga) {
      // Recarga completa: trae la última versión y resuelve el desajuste de chunks.
      window.location.reload();
      return;
    }
    const mia = process.env.NEXT_PUBLIC_VERSION_DESPLIEGUE ?? "local";
    if (mia === "local") return;
    fetch("/api/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { version?: string } | null) => {
        if (j?.version) setEsVersionVieja(j.version !== mia);
      })
      .catch(() => {
        /* sin red no se puede saber; se queda en null y el texto es neutro */
      });
  }, [error, autorecarga]);

  if (autorecarga) {
    return (
      <main
        className="flex min-h-[70vh] items-center justify-center px-6"
        style={{ background: "var(--fondo)" }}
      >
        <div className="text-center" style={{ color: "var(--muted)" }}>
          <div className="titular text-[16px] font-bold">Actualizando…</div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-[70vh] items-center justify-center px-6"
      style={{ background: "var(--fondo)" }}
    >
      <div className="tarjeta w-full max-w-[440px] p-7 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/isotipo.svg" alt="Respondo" width={34} height={34} className="mx-auto" />
        <h1 className="titular mt-4 text-[21px] font-bold">
          {esVersionVieja === false ? "Algo falló acá" : "Se cortó algo por un momento"}
        </h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          {esVersionVieja === true
            ? "Tu navegador tenía abierta una versión anterior de Respondo. Recarga y queda listo."
            : esVersionVieja === false
              ? "No fue tu navegador: hay un problema de nuestro lado y ya quedó registrado. Puedes reintentar; si vuelve a pasar, escríbenos."
              : "Recarga la página. Si vuelve a pasar, escríbenos y lo revisamos."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button onClick={() => reset()} className="btn-suave px-4 py-2 text-[14px]">
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            className="btn-primario px-4 py-2 text-[14px]"
          >
            Recargar la página
          </button>
        </div>
      </div>
    </main>
  );
}
