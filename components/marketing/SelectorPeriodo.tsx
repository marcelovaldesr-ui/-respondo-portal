import Link from "next/link";
import { RANGOS, rangoLegible, type Rango } from "@/lib/ads/periodos";

/**
 * Selector de período como control segmentado de enlaces. El período queda en
 * la URL (se puede compartir), la página se rearma en el servidor y funciona
 * con teclado sin programar nada.
 *
 * El rango legible («12 ago al 10 sept») va DEBAJO como metadato y no al lado
 * como si fuera otro control: es una aclaración, no una opción.
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
  const visibles = RANGOS.filter((r) => ["7d", "30d", "mes", "mes_anterior"].includes(r.clave));
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="mk-segmentos" role="group" aria-label="Período">
        {visibles.map((r) => (
          <Link key={r.clave} href={href(r.clave)} className="mk-segmento" aria-pressed={r.clave === rango.clave}>
            {r.etiqueta}
          </Link>
        ))}
      </div>
      <span className="hidden sm:block" style={{ fontSize: "10.5px", color: "var(--muted-3)" }}>
        {rangoLegible(rango)}
      </span>
    </div>
  );
}
