"use client";

import { useRef, useTransition } from "react";

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
 */
export default function FormularioAgregar({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [enviando, iniciar] = useTransition();

  return (
    <form
      ref={ref}
      className={className}
      action={(formData) => {
        iniciar(async () => {
          await action(formData);
          ref.current?.reset();
        });
      }}
      // Bloquea el envío mientras hay uno en curso (evita duplicados por doble clic).
      style={enviando ? { opacity: 0.6, pointerEvents: "none" } : undefined}
    >
      {children}
    </form>
  );
}
