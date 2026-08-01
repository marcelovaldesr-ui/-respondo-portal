"use client";

import { useEffect, useState } from "react";
import { intentarRecargarPorVersion } from "@/lib/erroresDeVersion";

/**
 * Límite de error GLOBAL (cubre fallos del layout raíz y del layout del portal).
 * Debe traer su propio <html>/<body> porque reemplaza al layout raíz cuando se
 * dispara. Mensaje mínimo y autosuficiente: no depende de estilos que quizá no
 * alcanzaron a cargar.
 *
 * DOS COSAS QUE ESTABAN MAL Y ERAN LA CAUSA DEL CARTEL (corregido 31-jul)
 *
 * 1. La auto-recarga por desajuste de versión estaba SOLO en el borde del
 *    portal. Pero un fallo en el layout del portal no lo atrapa su propio
 *    borde: sube al global. O sea que justo el caso más frecuente —navegar
 *    entre pantallas después de un deploy— caía en el único borde que no sabía
 *    recargarse solo. Por eso el cartel aparecía tanto.
 *
 * 2. El botón decía "Recargar" pero llamaba a `reset()`, que reintenta el
 *    render sin volver a pedir nada al servidor. Con un archivo que ya no
 *    existe, falla de nuevo en el acto: el botón no hacía lo que prometía.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Se decide en el primer render para no mostrar el cartel un instante antes
  // de recargar (ese parpadeo es justo lo que se quiere evitar).
  const [recargando] = useState(() => intentarRecargarPorVersion(error));

  useEffect(() => {
    console.error("[respondo] error global", error);
    if (recargando) window.location.reload();
  }, [error, recargando]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#F6F7FB",
          color: "#0F172A",
        }}
      >
        {recargando ? (
          <div style={{ fontSize: 14, color: "#5B6981" }}>Actualizando…</div>
        ) : (
          <div style={{ maxWidth: 420, padding: 28, textAlign: "center" }}>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.025em",
                margin: "0 0 8px",
              }}
            >
              Se cortó algo por un momento
            </h1>
            <p style={{ fontSize: 14, color: "#5B6981", margin: "0 0 20px" }}>
              Recarga la página y debería quedar bien. Si vuelve a pasar, avísanos.
            </p>
            <button
              /* Recarga de verdad. `reset()` solo reintenta el render con lo que
                 el navegador ya tiene en memoria, que es exactamente lo que está
                 fallando; se deja como respaldo por si la recarga no procede. */
              onClick={() => {
                try {
                  window.location.reload();
                } catch {
                  reset();
                }
              }}
              style={{
                background: "#4F46E5",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                padding: "9px 18px",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Recargar
            </button>
          </div>
        )}
      </body>
    </html>
  );
}
