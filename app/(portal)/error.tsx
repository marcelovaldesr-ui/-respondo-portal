"use client";

import { useEffect } from "react";

/**
 * Límite de error del portal. Reemplaza el "Application error" en blanco de
 * Next por un mensaje amable con recarga. Cubre, entre otros, el caso típico
 * tras un deploy nuevo en Vercel: una pestaña abierta con chunks viejos lanza
 * una excepción de cliente al navegar; una recarga completa lo resuelve.
 */
export default function ErrorPortal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal error boundary]", error);
  }, [error]);

  return (
    <main
      className="flex min-h-[70vh] items-center justify-center px-6"
      style={{ background: "var(--fondo)" }}
    >
      <div className="tarjeta w-full max-w-[440px] p-7 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/isotipo.svg" alt="Respondo" width={34} height={34} className="mx-auto" />
        <h1 className="titular mt-4 text-[21px] font-bold">Se cortó algo por un momento</h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          Suele pasar justo después de una actualización: tu navegador tenía una
          versión anterior abierta. Recarga y debería quedar perfecto.
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
