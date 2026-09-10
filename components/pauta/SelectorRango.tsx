import Link from "next/link";
import { RANGOS, rangoLegible, type Rango } from "@/lib/ads/periodos";

/**
 * EL SELECTOR DE PERÍODO.
 *
 * Es un grupo de enlaces y no un menú con JavaScript, por tres razones que se
 * notan al usarlo: el período queda en la URL (se puede compartir un enlace a
 * «los últimos 7 días» y mandárselo a alguien), la página se rearma en el
 * servidor con los datos correctos sin estados intermedios raros, y funciona
 * con el teclado sin que haya que programar nada.
 *
 * Usa `.btn-chico` con `aria-pressed`, que es el patrón que el portal ya tiene
 * para un grupo de opciones: la misma altura, el mismo borde y el mismo estado
 * activo que en el resto del producto.
 */
export default function SelectorRango({
  rango,
  base,
  extra,
}: {
  rango: Rango;
  /** Ruta sobre la que se arman los enlaces, p. ej. "/pauta/anuncios". */
  base: string;
  /**
   * Parámetros que hay que conservar al cambiar de período (por ejemplo el
   * anuncio por el que se está filtrando). Se arman con URLSearchParams y no
   * pegando texto: un nombre de anuncio con «&» rompería el enlace y el filtro
   * se perdería sin que se note.
   */
  extra?: Record<string, string | undefined>;
}) {
  const armarHref = (clave: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v) p.set(k, v);
    }
    p.set("p", clave);
    return `${base}?${p}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RANGOS.map((r) => {
        const activo = r.clave === rango.clave;
        return (
          <Link
            key={r.clave}
            href={armarHref(r.clave)}
            className="btn-chico"
            aria-pressed={activo}
            aria-label={`Ver ${r.etiqueta}`}
          >
            {r.etiqueta}
          </Link>
        );
      })}
      <span
        className="ml-1"
        style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
      >
        {rangoLegible(rango)}
      </span>
    </div>
  );
}
