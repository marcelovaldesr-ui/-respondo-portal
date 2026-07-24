"use client";

/**
 * Límite de error GLOBAL (cubre fallos del layout raíz). Debe traer su propio
 * <html>/<body> porque reemplaza al layout raíz cuando se dispara. Mensaje
 * mínimo y autosuficiente (sin depender de estilos que quizá no cargaron).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
          background: "#F7F9FC",
          color: "#0F172A",
        }}
      >
        <div style={{ maxWidth: 420, padding: 28, textAlign: "center" }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: "0 0 8px" }}>
            Se cortó algo por un momento
          </h1>
          <p style={{ fontSize: 15, color: "#5B6981", margin: "0 0 20px" }}>
            Suele pasar tras una actualización. Recarga la página y debería quedar bien.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#4F46E5",
              color: "#fff",
              border: 0,
              borderRadius: 12,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
