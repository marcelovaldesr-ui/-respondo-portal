import Link from "next/link";
import { RANGOS, rangoLegible, type Rango } from "@/lib/ads/periodos";

/**
 * Selector de período como control segmentado de enlaces. El período queda
 * en la URL (se puede compartir), la página se rearma en el servidor y
 * funciona con teclado sin programar nada. Mismo criterio que en Pauta.
 */
export default function SelectorPeriodo({
  rango,
  base,
  extra,
}: {
  rango: Rango;
  base: string;
  extra?: Record<string, string | undefined>;
}) {
  const href = (clave: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra ?? {})) if (v) p.set(k, v);
    p.set("p", clave);
    return `${base}?${p}`;
  };
  const visibles = RANGOS.filter((r) => ["7d", "14d", "30d", "mes", "mes_anterior"].includes(r.clave));
  return (
    <div className="flex items-center gap-2">
      <div className="mk-segmentos" role="group" aria-label="Período">
        {visibles.map((r) => (
          <Link key={r.clave} href={href(r.clave)} className="mk-segmento" aria-pressed={r.clave === rango.clave}>
            {r.etiqueta}
          </Link>
        ))}
      </div>
      <span className="hidden sm:inline" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        {rangoLegible(rango)}
      </span>
    </div>
  );
}
