import Link from "next/link";
import { formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import type { EscalonEmbudo } from "@/lib/marketing/tipos";

/**
 * EL EMBUDO — lo que Meta no ve.
 *
 * Meta ve hasta el clic. Nosotros seguimos: conversación, calificado,
 * cotización/reserva, venta. La barra de cada escalón es proporcional al
 * ESCALÓN ANTERIOR VISIBLE, no al primero: si se dibujara todo respecto de
 * las impresiones, las conversaciones serían un pelo invisible y el embudo
 * no diría nada.
 *
 * Cada escalón lleva su definición en un tooltip. Un embudo cuyo «calificado»
 * nadie sabe qué significa es un embudo del que nadie se fía.
 */
export default function Embudo({
  escalones,
  compacto = false,
  enlaces,
}: {
  escalones: EscalonEmbudo[];
  compacto?: boolean;
  /** Enlaces por escalón para bajar hasta las personas. */
  enlaces?: Partial<Record<EscalonEmbudo["clave"], string>>;
}) {
  const visibles = escalones.filter((e) => e.valor !== null);
  // La barra se escala contra el mayor de los escalones NUESTROS (conversaciones
  // en adelante) para que la parte que importa ocupe la pantalla; impresiones y
  // clics, cuando existen, se dibujan en una escala aparte y en tono suave.
  const nuestros = visibles.filter((e) => !["impresiones", "clics"].includes(e.clave));
  const maxNuestro = Math.max(...nuestros.map((e) => e.valor ?? 0), 1);
  const deMeta = visibles.filter((e) => ["impresiones", "clics"].includes(e.clave));
  const maxMeta = Math.max(...deMeta.map((e) => e.valor ?? 0), 1);

  return (
    <div className="mk-embudo">
      {visibles.map((e) => {
        const esMeta = ["impresiones", "clics"].includes(e.clave);
        const ancho = Math.max(2, ((e.valor ?? 0) / (esMeta ? maxMeta : maxNuestro)) * 100);
        const href = enlaces?.[e.clave];
        const etiqueta = (
          <span className="flex items-center gap-1.5 font-semibold" data-tip={e.definicion}>
            {e.etiqueta}
            {esMeta && <span className="mk-certeza">Meta</span>}
          </span>
        );
        return (
          <div key={e.clave} className={`mk-embudo-fila ${esMeta ? "meta" : ""} ${e.clave === "ventas" ? "venta" : ""}`}>
            {href ? <Link href={href} className="hover:underline">{etiqueta}</Link> : etiqueta}
            <div className="mk-embudo-barra" style={{ height: compacto ? 16 : 22 }}>
              <span style={{ width: `${ancho}%` }} />
            </div>
            <div className="text-right">
              <span className="cifra font-semibold">{formatearNumero(e.valor)}</span>
              {e.tasa !== null && (
                <span className="ml-1.5" style={{ color: "var(--muted-2)", fontSize: "var(--t-micro)" }}>
                  {formatearPorcentaje(e.tasa)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
