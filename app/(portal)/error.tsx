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
    }
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
        {/*
          TEXTO NEUTRO A PROPÓSITO (19-ago-2026).

          Antes afirmaba "suele pasar tras una actualización", que es falso en la
          mayoría de los casos. Lo cambié por uno honesto que decía que el
          problema era nuestro, y eso tampoco sirve: esta pantalla la puede ver
          un prospecto en medio de una demostración en vivo.

          La salida no es mentir ni confesar, es no diagnosticar. Se dice lo
          único que el usuario necesita —que reintente— y el detalle real viaja
          a /api/error-cliente, que es donde tiene que estar.

          Cuando el fallo de fondo esté resuelto, vale la pena volver a
          distinguir el caso de versión vieja, que sí es cierto y sí es útil.
        */}
        <h1 className="titular mt-4 text-[21px] font-bold">Se cortó algo por un momento</h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          Vuelve a intentarlo o recarga la página.
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
