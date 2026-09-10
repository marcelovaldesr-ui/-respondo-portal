"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Cuando Pauta se cae.
 *
 * Dos cosas que no puede hacer una pantalla de error: culpar al usuario y
 * dejarlo sin salida. Acá se dice lo que pasó en una línea, se ofrece
 * reintentar —la mayoría de las caídas son una consulta que tardó— y se deja la
 * puerta al portal, porque el resto del producto sigue funcionando.
 *
 * El detalle técnico va a la consola y al registro de errores, nunca a la
 * pantalla: un stack trace no ayuda a nadie que esté mirando su publicidad.
 */
export default function ErrorMarketing({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pauta] error de render:", error.message, error.digest);
  }, [error]);

  return (
    <main className="px-5 py-10 sm:px-7">
      <div className="tarjeta mx-auto max-w-lg">
        <div className="vacio">
          <div className="vacio-titulo">No pudimos cargar Pauta</div>
          <p className="vacio-texto">
            Suele ser una consulta que tardó más de la cuenta. Los datos están bien; es solo esta
            pantalla.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primario" onClick={() => reset()}>
              Reintentar
            </button>
            <Link href="/inicio" className="btn-suave">
              Volver al portal
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
