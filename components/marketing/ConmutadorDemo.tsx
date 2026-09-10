"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarModoDemo } from "@/app/(marketing)/marketing/acciones";

/**
 * El interruptor de «Datos de demostración».
 *
 * Vive en el riel, abajo, siempre visible: cuando está encendido, la persona
 * tiene que poder ver en cualquier pantalla que lo que mira no es su negocio,
 * y poder apagarlo sin buscar. Es una cookie del navegador: no toca la base.
 */
export default function ConmutadorDemo({ activo }: { activo: boolean }) {
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            await cambiarModoDemo(!activo);
            router.refresh();
          })
        }
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left"
        style={{ opacity: pendiente ? 0.6 : 1 }}
      >
        <span className="min-w-0">
          <span className="block font-semibold" style={{ fontSize: "var(--t-micro)", color: activo ? "var(--alerta)" : "var(--muted)" }}>
            {activo ? "Datos de demostración" : "Ver con datos de demostración"}
          </span>
          <span className="block" style={{ fontSize: "10.5px", color: "var(--muted-3)" }}>
            {activo ? "Negocio ficticio. Nada se guarda." : "Para explorar el producto completo."}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="relative inline-block h-[18px] w-[32px] shrink-0 rounded-full transition-colors"
          style={{ background: activo ? "var(--alerta)" : "var(--borde-fuerte)" }}
        >
          <span
            className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
            style={{ left: activo ? 16 : 2, boxShadow: "0 1px 2px rgba(15,23,42,.2)" }}
          />
        </span>
      </button>
    </div>
  );
}
