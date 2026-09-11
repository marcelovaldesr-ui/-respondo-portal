import Link from "next/link";
import type { Hallazgo } from "@/lib/ads/insights";
import { Ico } from "@/components/marketing/Iconos";

/**
 * LO QUE CONVIENE MIRAR — hallazgos con prioridad, no otra tabla.
 *
 * Cada tarjeta dice, en este orden: de qué tipo es (alerta u oportunidad), la
 * conclusión en una línea que se lee sola, la evidencia con cifras exactas, y
 * a dónde ir a comprobarla. Las cifras salen de `lib/ads/insights.ts`, que es
 * determinista y tiene umbrales mínimos: si el volumen no alcanza, el
 * hallazgo no existe. Ningún modelo opina acá.
 *
 * El borde izquierdo de color es la única señal cromática: coral cuesta
 * plata, verde es oportunidad. Nada de fondos de color, que convertirían una
 * pantalla de trabajo en un semáforo.
 */
const TIPO = {
  alerta: { texto: "Cuesta plata", icono: Ico.alerta },
  oportunidad: { texto: "Oportunidad", icono: Ico.rayo },
  neutro: { texto: "Para saber", icono: Ico.grafico },
} as const;

export default function Hallazgos({ items, max }: { items: Hallazgo[]; max?: number }) {
  if (!items.length) return null;
  const visibles = max ? items.slice(0, max) : items;
  return (
    <div className="mk-hallazgos">
      {visibles.map((h) => {
        const t = TIPO[h.tono];
        return (
          <article key={h.clave} className={`mk-hallazgo ${h.tono}`}>
            <div className="mk-hallazgo-tipo flex items-center gap-1.5">
              {t.icono({ className: "h-3.5 w-3.5" })}
              {t.texto}
            </div>
            <h3 className="mk-hallazgo-titulo">{h.titulo}</h3>
            <p className="mk-hallazgo-evidencia">{h.evidencia}</p>
            {h.href && (
              <Link href={h.href} className="mk-enlace mt-auto pt-1">
                {h.tono === "alerta" ? "Analizar" : "Ver el detalle"} {Ico.flecha({ className: "h-3.5 w-3.5" })}
              </Link>
            )}
          </article>
        );
      })}
    </div>
  );
}
