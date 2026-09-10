import Link from "next/link";
import type { Hallazgo } from "@/lib/ads/insights";

/**
 * Los hallazgos automáticos como tarjetas. Cada una lleva su evidencia con
 * cifras exactas y un enlace a donde se puede comprobar. Son deterministas:
 * salen de `lib/ads/insights.ts` con umbrales mínimos, no de un modelo.
 */
export default function Hallazgos({ items, columnas = 2 }: { items: Hallazgo[]; columnas?: 1 | 2 | 3 }) {
  if (!items.length) return null;
  const cols = columnas === 3 ? "lg:grid-cols-3" : columnas === 2 ? "lg:grid-cols-2" : "";
  return (
    <div className={`grid gap-3 ${cols}`}>
      {items.map((h) => (
        <div key={h.clave} className={`tarjeta mk-hallazgo ${h.tono}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold" style={{ fontSize: "var(--t-fila)", lineHeight: 1.3 }}>
              {h.titulo}
            </div>
            <span className={h.tono === "alerta" ? "pildora-peligro" : h.tono === "oportunidad" ? "pildora-ok" : "pildora-neutra"}>
              {h.tono === "alerta" ? "cuesta plata" : h.tono === "oportunidad" ? "oportunidad" : "para saber"}
            </span>
          </div>
          <p className="leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            {h.evidencia}
          </p>
          {h.href && (
            <Link href={h.href} className="mt-1 inline-flex items-center gap-1 font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
              Ver el detalle →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
