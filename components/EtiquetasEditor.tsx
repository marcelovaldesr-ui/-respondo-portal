"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarEtiqueta } from "@/app/(portal)/conversaciones/acciones";
import { ETIQUETAS_MANUALES, metaEtiqueta } from "@/lib/etiquetas";

/**
 * Editor de etiquetas de una conversación (inbox). Muestra las etiquetas
 * actuales con una "x" para quitar, y un botón para agregar del catálogo.
 * Cualquiera del negocio (ej: Cecilia) puede clasificar a mano.
 */
export default function EtiquetasEditor({
  chatId,
  etiquetas,
}: {
  chatId: string;
  etiquetas: string[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();

  function mutar(etiqueta: string, accion: "agregar" | "quitar") {
    const fd = new FormData();
    fd.set("chatId", chatId);
    fd.set("etiqueta", etiqueta);
    fd.set("accion", accion);
    startTransition(async () => {
      await cambiarEtiqueta(fd);
      setAbierto(false);
      router.refresh();
    });
  }

  const disponibles = ETIQUETAS_MANUALES.filter((e) => !etiquetas.includes(e.valor));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {etiquetas.map((v) => {
        const m = metaEtiqueta(v);
        return (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold"
            style={{ background: m.fondo, color: m.color }}
          >
            {m.label}
            <button
              onClick={() => mutar(v, "quitar")}
              disabled={pendiente}
              className="ml-0.5 opacity-60 hover:opacity-100"
              aria-label={`Quitar ${m.label}`}
            >
              ✕
            </button>
          </span>
        );
      })}

      <div className="relative">
        <button
          onClick={() => setAbierto((v) => !v)}
          disabled={pendiente || disponibles.length === 0}
          className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40"
          style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted)" }}
        >
          + etiqueta
        </button>
        {abierto && disponibles.length > 0 && (
          <div
            className="absolute z-10 mt-1 w-48 rounded-xl border bg-white p-1 shadow-lg"
            style={{ borderColor: "var(--borde)" }}
          >
            {disponibles.map((e) => (
              <button
                key={e.valor}
                onClick={() => mutar(e.valor, "agregar")}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[#F3F4F9]"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: e.color }}
                />
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
