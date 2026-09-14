"use client";

import { useRef, useState, useTransition } from "react";

/**
 * Formulario de "agregar" que se LIMPIA solo después de enviarse.
 *
 * POR QUÉ EXISTE: en Next 14 (React 18) los formularios con Server Actions no
 * se resetean solos. El texto quedaba escrito y bastaba un segundo clic —o un
 * Enter de más— para crear el mismo servicio dos veces. Pasó de verdad en la
 * primera prueba del 31-jul-2026: quedaron tres servicios, dos idénticos.
 *
 * De paso deshabilita el botón mientras se envía, para que no haya doble envío
 * por doble clic.
 *
 * FEEDBACK DE ERROR (microfix 14-sep-2026): la acción puede devolver
 * `{ok:false, error}` (mismo patrón ya usado en NuevaCita/reagendar) en vez
 * de nada. Si lo hace, el mensaje se muestra inline y el formulario NO se
 * limpia —para que el dueño pueda corregir y reintentar—; si la acción sigue
 * devolviendo `void` (como crearServicio/crearProfesional), nada cambia: se
 * limpia igual que siempre.
 */
export default function FormularioAgregar({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string } | void>;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={ref}
      className={className}
      action={(formData) => {
        iniciar(async () => {
          const r = await action(formData);
          if (r && r.ok === false) {
            setError(r.error ?? "No se pudo completar la acción.");
            return;
          }
          setError(null);
          ref.current?.reset();
        });
      }}
      // Bloquea el envío mientras hay uno en curso (evita duplicados por doble clic).
      style={enviando ? { opacity: 0.6, pointerEvents: "none" } : undefined}
    >
      {children}
      {error && (
        <p
          role="alert"
          className="rounded-[var(--r-chico)] px-3 py-2"
          style={{
            background: "var(--coral-medio)",
            color: "var(--peligro)",
            fontSize: "var(--t-menor)",
            gridColumn: "1 / -1",
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}
