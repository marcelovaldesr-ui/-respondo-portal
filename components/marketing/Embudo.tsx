import Link from "next/link";
import { formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import type { EscalonEmbudo } from "@/lib/marketing/tipos";

/**
 * DEL ANUNCIO A LA VENTA — la visualización insignia de Respondo.
 *
 * La idea que tiene que entrar en cinco segundos: **la plataforma mide el
 * anuncio; Respondo mide al cliente.** Por eso el embudo se dibuja en
 * horizontal, como una línea de tiempo, y lleva una frontera marcada: a la
 * izquierda, en tono apagado, lo que reporta la plataforma sobre la entrega del
 * aviso; a la derecha, en color, lo que pasa en el negocio —persona, nombre,
 * conversación y monto—.
 *
 * ⚠️ CUIDADO CON EL CLAIM. Antes decía «Meta ve hasta acá / Respondo ve desde
 * acá», y eso es falso: con el Pixel y la API de conversiones —que nosotros
 * mismos alimentamos— Meta recibe señales de lo que pasa después del clic. La
 * diferencia real no es quién ve, es QUÉ se mide: Meta mide la entrega del
 * anuncio y recibe señales agregadas para optimizar; Respondo tiene el hilo
 * completo de cada persona. Esa versión es igual de fuerte y además es cierta.
 *
 * Cada etapa muestra tres cosas y ninguna más: la cifra (grande), qué es, y
 * qué porcentaje del paso anterior sobrevivió. La barra es proporcional
 * dentro de su lado —si se escalaran las conversaciones contra las
 * impresiones, el lado que importa sería un pelo invisible—.
 *
 * Cuando una etapa tiene a dónde ir, la etapa ENTERA es un enlace.
 */
const DE_META = new Set(["impresiones", "clics"]);

/** Rótulos de una línea: dos líneas desalinean toda la fila de escalones. */
const CORTO: Partial<Record<EscalonEmbudo["clave"], string>> = {
  avanzados: "Cotizaron",
};

export default function Embudo({
  escalones,
  enlaces,
  compacto = false,
}: {
  escalones: EscalonEmbudo[];
  enlaces?: Partial<Record<EscalonEmbudo["clave"], string>>;
  /** Versión vertical para paneles angostos (detalle de campaña). */
  compacto?: boolean;
}) {
  const visibles = escalones.filter((e) => e.valor !== null);
  if (visibles.length === 0) return null;

  const nuestros = visibles.filter((e) => !DE_META.has(e.clave));
  const maxNuestro = Math.max(...nuestros.map((e) => e.valor ?? 0), 1);
  const deMeta = visibles.filter((e) => DE_META.has(e.clave));
  const maxMeta = Math.max(...deMeta.map((e) => e.valor ?? 0), 1);
  /**
   * ⭐ ESCALA DE RAÍZ, y es una decisión.
   *
   * Un embudo real abarca órdenes de magnitud: 2,7 millones de impresiones y
   * 34 ventas. En escala lineal, todo lo que viene después del primer escalón
   * mide un píxel y el dibujo deja de decir nada —que es justo lo que pasaba
   * antes—. Con raíz cuadrada, cada escalón se sigue viendo MENOR que el
   * anterior (que es la lectura que importa) y ninguno desaparece.
   *
   * La cifra exacta y el porcentaje van escritos al lado, siempre: la barra es
   * el gesto, el número es la verdad.
   */
  const alturaDe = (e: EscalonEmbudo) => {
    const esMeta = DE_META.has(e.clave);
    const base = esMeta ? maxMeta : maxNuestro;
    const pct = Math.sqrt(Math.max(0, (e.valor ?? 0) / base)) * 100;
    return `${Math.max(6, Math.min(100, pct))}%`;
  };
  const primerNuestro = nuestros[0]?.clave;
  const ultimoMeta = deMeta[deMeta.length - 1]?.clave;

  if (compacto) {
    return (
      <div className="mk-embudo">
        {visibles.map((e) => {
          const esMeta = DE_META.has(e.clave);
          const href = enlaces?.[e.clave];
          const Cuerpo = (
            <>
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: esMeta ? "var(--muted)" : "var(--tinta)" }}>
                {e.etiqueta}
                {esMeta && <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted-3)" }}>META</span>}
              </span>
              <span className="mk-embudo-barra">
                <span style={{ width: alturaDe(e) }} />
              </span>
              <span className="flex items-baseline justify-end gap-1.5">
                <span className="cifra font-semibold" style={{ fontSize: "13.5px" }}>
                  {formatearNumero(e.valor)}
                </span>
                <span style={{ fontSize: "11px", color: "var(--muted-2)" }}>{e.tasa === null ? "" : formatearPorcentaje(e.tasa)}</span>
              </span>
            </>
          );
          const clase = `mk-embudo-fila ${esMeta ? "meta" : ""} ${e.clave === "ventas" ? "venta" : ""}`;
          return href ? (
            <Link key={e.clave} href={href} className={clase} data-tip={e.definicion}>
              {Cuerpo}
            </Link>
          ) : (
            <div key={e.clave} className={clase} data-tip={e.definicion}>
              {Cuerpo}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mk-embudo-h">
      {visibles.map((e) => {
        const esMeta = DE_META.has(e.clave);
        const href = enlaces?.[e.clave];
        const clases = [
          "mk-embudo-etapa",
          esMeta ? "meta" : "",
          e.clave === "ventas" ? "venta" : "",
          e.clave === primerNuestro && deMeta.length > 0 ? "frontera" : "",
          e.clave === ultimoMeta ? "meta-fin" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const cuerpo = (
          <>
            <span className="mk-embudo-columna">
              <span style={{ height: alturaDe(e) }} />
            </span>
            <span className="mk-embudo-valor">{formatearNumero(e.valor)}</span>
            <span className="mk-embudo-rotulo" title={e.etiqueta}>
              {CORTO[e.clave] ?? e.etiqueta}
              {esMeta && (
                <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted-3)" }}>META</span>
              )}
            </span>
            <span className="mk-embudo-tasa">
              {e.tasa === null ? (
                ""
              ) : (
                <>
                  {/* Solo se pinta la caída donde el negocio puede actuar: de la
                      conversación en adelante. Lo que pasa antes del clic no lo
                      controla nadie desde acá. */}
                  <strong className={e.tasa < 25 && !esMeta && e.clave !== "conversaciones" && e.clave !== "ventas" ? "caida" : ""}>
                    {formatearPorcentaje(e.tasa)}
                  </strong>{" "}
                  {/* Ventas se mide contra conversaciones, no contra el paso
                      previo: hay gente que compra sin pedir cotización, y una
                      tasa de 120% sobre el paso anterior no se entiende. */}
                  <span title={e.clave === "ventas" ? "Sobre las conversaciones, no sobre el paso anterior" : undefined}>
                    {e.clave === "ventas" ? "de las conv." : "del paso anterior"}
                  </span>
                </>
              )}
            </span>
          </>
        );
        return href ? (
          <Link key={e.clave} href={href} className={clases} data-tip={e.definicion}>
            {cuerpo}
          </Link>
        ) : (
          <div key={e.clave} className={clases} data-tip={e.definicion}>
            {cuerpo}
          </div>
        );
      })}
    </div>
  );
}
