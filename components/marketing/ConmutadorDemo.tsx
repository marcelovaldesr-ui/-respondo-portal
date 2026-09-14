"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarModoDemo } from "@/app/(marketing)/marketing/acciones";
import type { VarianteDemo } from "@/lib/marketing/demo";

/**
 * El interruptor de «Datos de demostración».
 *
 * Vive en el riel, abajo, siempre visible: cuando está encendido, la persona
 * tiene que poder ver en cualquier pantalla que lo que mira no es su negocio,
 * y poder apagarlo sin buscar. Es una cookie del navegador: no toca la base.
 *
 * ⭐ FASE 6 — TRES NEGOCIOS, NO UNO. Con el interruptor encendido aparecen las
 * tres formas reales de usar Marketing, porque son tres pantallas distintas y
 * mostrar solo una obligaba a explicar con palabras las otras dos:
 *   · Completo   — pauta + conversaciones + ventas (el circuito cerrado).
 *   · Solo Meta  — pauta en Meta sin traer la conversación a Respondo.
 *   · Solo Google— pauta en Búsqueda, con palabras clave y términos.
 */
const OPCIONES: { clave: VarianteDemo; texto: string; ayuda: string }[] = [
  { clave: "completo", texto: "Completo", ayuda: "Publicidad, conversaciones y ventas" },
  { clave: "meta", texto: "Solo Meta", ayuda: "Pauta sin conversaciones en Respondo" },
  { clave: "google", texto: "Solo Google", ayuda: "Búsqueda, palabras y términos" },
];

export default function ConmutadorDemo({
  activo,
  variante = "completo",
}: {
  activo: boolean;
  variante?: VarianteDemo;
}) {
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  const cambiar = (encendido: boolean, v: VarianteDemo) =>
    iniciar(async () => {
      await cambiarModoDemo(encendido, v);
      router.refresh();
    });

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={pendiente}
        onClick={() => cambiar(!activo, variante)}
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

      {activo && (
        <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Qué negocio se demuestra">
          {OPCIONES.map((o) => (
            <button
              key={o.clave}
              type="button"
              disabled={pendiente}
              onClick={() => cambiar(true, o.clave)}
              aria-pressed={variante === o.clave}
              title={o.ayuda}
              className="rounded px-1.5 py-0.5"
              style={{
                fontSize: "10.5px",
                border: "1px solid var(--borde)",
                background: variante === o.clave ? "var(--alerta)" : "transparent",
                color: variante === o.clave ? "#fff" : "var(--muted-2)",
              }}
            >
              {o.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
