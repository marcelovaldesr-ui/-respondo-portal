import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { variacion, type Metrica as TipoMetrica } from "@/lib/ads/metricas";

/**
 * UNA MÉTRICA, CON SU CERTEZA A LA VISTA.
 *
 * La regla que gobierna este componente: **una métrica que no podemos calcular
 * NO se dibuja como un cero.** Un «$0» y un «no lo sabemos» se ven igual y
 * llevan a conclusiones opuestas — y la que se ve bien es la falsa.
 *
 * Por eso hay tres formas de pintarse y solo una es un número:
 *   · disponible  → la cifra, en grande.
 *   · parcial     → la cifra + una línea que dice qué NO incluye.
 *   · no disponible → una raya y qué habría que conectar. Sin alarma roja: no
 *     está roto, está sin configurar, y son cosas distintas.
 */

function valorLegible(m: TipoMetrica, monedaNegocio?: string): string {
  if (m.certeza === "no_disponible" || m.valor === null) return "—";
  if (m.monto) return formatearMonto(m.monto, { monedaDelNegocio: monedaNegocio });
  if (m.clave === "ctr" || m.clave === "conversion") return formatearPorcentaje(m.valor);
  if (m.clave === "roas") return `${m.valor.toFixed(1)}×`;
  return formatearNumero(m.valor);
}

export default function Metrica({
  m,
  monedaNegocio,
}: {
  m: TipoMetrica;
  monedaNegocio?: string;
}) {
  const sinDato = m.certeza === "no_disponible" || m.valor === null;
  const v = variacion(m.valor, m.antes);

  /**
   * Verde y coral se asignan por lo que le CONVIENE al negocio, no por el signo.
   * Que suba el costo por venta es una mala noticia aunque el número crezca:
   * pintarla de verde por subir sería mentir con el color.
   */
  const mejora = v ? (m.menosEsMejor ? v.signo < 0 : v.signo > 0) : false;
  const empeora = v ? (m.menosEsMejor ? v.signo > 0 : v.signo < 0) : false;

  return (
    <div className="tarjeta p-4">
      <div className="flex items-start justify-between gap-2">
        <span
          style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
          title={m.ayuda}
        >
          {m.etiqueta}
        </span>
        {m.certeza === "parcial" && !sinDato && (
          <span className="pildora-alerta" title={m.motivo}>
            piso
          </span>
        )}
      </div>

      <div
        className="h-cifra mt-1.5"
        style={{ color: sinDato ? "var(--muted-3)" : "var(--tinta)" }}
      >
        {valorLegible(m, monedaNegocio)}
      </div>

      {sinDato ? (
        <p
          className="mt-1 leading-snug"
          style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
        >
          {m.motivo ?? "Todavía no se puede calcular."}
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          {v && (
            <span
              style={{
                fontSize: "var(--t-micro)",
                fontWeight: 600,
                color: mejora ? "var(--ok)" : empeora ? "var(--peligro)" : "var(--muted-2)",
              }}
            >
              {v.texto}
            </span>
          )}
          {m.certeza === "parcial" && m.motivo && (
            <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              {m.motivo}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
