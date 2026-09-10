import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { variacion, type Metrica } from "@/lib/ads/metricas";

/**
 * UNA MÉTRICA CON SU CERTEZA Y SU TENDENCIA.
 *
 * Hereda la regla de Pauta: lo que no se puede calcular NO se dibuja como
 * cero. Agrega dos cosas: una chispa (sparkline) con la forma de la serie
 * diaria, y la píldora de certeza al lado de la etiqueta, para que quien lee
 * sepa si está mirando una medición, una división o un piso.
 */
const ROTULO: Record<Metrica["certeza"], string> = {
  medida: "medida",
  derivada: "derivada",
  parcial: "piso",
  no_disponible: "no disponible",
};

/** Etiquetas que caben en una tarjeta de siete por fila. El título completo va en el tooltip. */
const ETIQUETA_CORTA: Record<string, string> = {
  gasto: "Invertido",
  conversaciones: "Conversaciones",
  calificados: "Leads calificados",
  ventas: "Ventas",
  costo_lead: "Costo por lead",
  cobrado: "Cobrado",
  roas: "Retorno (ROAS)",
};

function valorLegible(m: Metrica, monedaNegocio: string): string {
  if (m.certeza === "no_disponible" || m.valor === null) return "—";
  if (m.monto) return formatearMonto(m.monto, { monedaDelNegocio: monedaNegocio });
  if (m.clave === "ctr" || m.clave === "conversion") return formatearPorcentaje(m.valor);
  if (m.clave === "roas") return `${m.valor.toFixed(2)}×`;
  return formatearNumero(m.valor);
}

export default function TarjetaMetrica({
  m,
  monedaNegocio = "CLP",
  serie,
  destacada,
}: {
  m: Metrica;
  monedaNegocio?: string;
  /** Serie diaria para la chispa. Opcional. */
  serie?: (number | null)[];
  destacada?: boolean;
}) {
  const sinDato = m.certeza === "no_disponible" || m.valor === null;
  const v = variacion(m.valor, m.antes);
  const mejora = v ? (m.menosEsMejor ? v.signo < 0 : v.signo > 0) : false;
  const empeora = v ? (m.menosEsMejor ? v.signo > 0 : v.signo < 0) : false;

  return (
    <div className="tarjeta mk-metrica" data-tip={sinDato ? m.motivo : m.ayuda}>
      <div className="mk-metrica-etiqueta">
        <span className="truncate" title={m.etiqueta}>{ETIQUETA_CORTA[m.clave] ?? m.etiqueta}</span>
      </div>
      <div
        className={`mk-metrica-valor cifra ${sinDato ? "sin-dato" : ""}`}
        style={{ color: sinDato ? undefined : destacada ? "var(--indigo)" : "var(--tinta)" }}
        title={valorLegible(m, monedaNegocio)}
      >
        {valorLegible(m, monedaNegocio)}
      </div>
      <div className="mk-metrica-fila">
        {serie && !sinDato && serie.some((v) => v) ? <Chispa datos={serie} color={destacada ? "var(--indigo)" : "var(--indigo-tenue)"} /> : <span />}
      </div>
      <div className="mk-metrica-pie">
        <span className="min-w-0 truncate">
          {sinDato ? (
            m.certeza === "no_disponible" ? "Conecta Meta" : "Sin dato"
          ) : v ? (
            <>
              <span style={{ fontWeight: 600, color: mejora ? "var(--ok)" : empeora ? "var(--peligro)" : "var(--muted-2)" }}>{v.texto}</span> vs ant.
            </>
          ) : m.certeza === "parcial" ? (
            "por enlace de pago"
          ) : (
            "\u00a0"
          )}
        </span>
        {!sinDato && <span className={`mk-certeza ${m.certeza}`}>{ROTULO[m.certeza]}</span>}
      </div>
    </div>
  );
}

/** Una línea diminuta con la forma de la serie. Sin ejes: es un gesto, no un gráfico. */
export function Chispa({ datos, color }: { datos: (number | null)[]; color: string }) {
  const puntos = datos.map((d) => d ?? 0);
  if (puntos.length < 2) return null;
  const max = Math.max(...puntos, 1);
  const w = 120;
  const h = 18;
  const paso = w / (puntos.length - 1);
  const d = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${(i * paso).toFixed(1)},${(h - (p / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg className="mk-metrica-chispa" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
