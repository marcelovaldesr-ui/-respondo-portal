import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { variacion, type Metrica } from "@/lib/ads/metricas";

/**
 * LA FRANJA DE CIFRAS — lo primero que se lee al entrar.
 *
 * Una sola superficie dividida en celdas, no siete tarjetas sueltas: la franja
 * se lee como una fila de cifras comparables, que es exactamente lo que es.
 *
 * JERARQUÍA, que era el problema:
 *   · la cifra manda (26 px, tabular, apretada),
 *   · el rótulo acompaña (12 px, gris),
 *   · la variación es una píldora chica con color semántico,
 *   · la CERTEZA es un punto de color y una palabra en 10,5 px — está, se
 *     puede consultar, y no compite con el número.
 *
 * Regla heredada y no negociable: lo que no se puede calcular muestra «—» con
 * el motivo en el tooltip. Nunca un cero que parece un dato.
 */
/**
 * CÓMO SE DICE LA CERTEZA, en el idioma del dueño.
 *
 * La semántica interna no cambia —`medida`, `derivada`, `parcial`,
 * `no_disponible` siguen siendo las mismas cuatro cosas y se calculan igual—;
 * lo que cambia es la palabra. «Medida» y «Piso» son vocabulario nuestro: un
 * dueño de imprenta lee «Piso» y no sabe si es bueno o malo. «Al menos» sí lo
 * dice: el número es real y el de verdad puede ser mayor.
 *
 * Van en 10,5 px con un punto de color y el detalle en el tooltip, para no
 * convertir la franja en una nota al pie.
 */
const ROTULO: Record<Metrica["certeza"], string> = {
  medida: "Dato directo",
  derivada: "Calculado",
  parcial: "Al menos",
  no_disponible: "Sin dato",
};

export type Kpi = {
  m: Metrica;
  /** Serie diaria para la chispa. */
  serie?: (number | null)[];
  destacada?: boolean;
  /** Rótulo corto; si falta se usa el de la métrica. */
  etiqueta?: string;
};

function valorLegible(m: Metrica, monedaNegocio: string): string {
  if (m.certeza === "no_disponible" || m.valor === null) return "—";
  if (m.monto) return formatearMonto(m.monto, { monedaDelNegocio: monedaNegocio });
  if (m.clave === "ctr" || m.clave === "conversion") return formatearPorcentaje(m.valor);
  if (m.clave === "roas") return `${m.valor.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
  return formatearNumero(m.valor);
}

/**
 * Una cifra de ocho dígitos no cabe a 26 px en una celda de seis columnas, y
 * recortarla con puntos suspensivos es peor que achicarla: el dueño vino a
 * leer ESE número. Se baja un escalón la tipografía en vez de esconder dígitos.
 */
function largo(v: string): string {
  if (v.length >= 12) return "xl";
  if (v.length >= 9) return "l";
  return "";
}

export default function FranjaKpis({ kpis, monedaNegocio = "CLP" }: { kpis: Kpi[]; monedaNegocio?: string }) {
  return (
    <section className="mk-kpis" aria-label="Cifras del período">
      {kpis.map(({ m, serie, destacada, etiqueta }) => {
        const sinDato = m.certeza === "no_disponible" || m.valor === null;
        const v = variacion(m.valor, m.antes);
        const mejora = v ? (m.menosEsMejor ? v.signo < 0 : v.signo > 0) : false;
        const empeora = v ? (m.menosEsMejor ? v.signo > 0 : v.signo < 0) : false;
        const hayChispa = Boolean(serie && !sinDato && serie.some((x) => x));
        const texto = valorLegible(m, monedaNegocio);
        return (
          <div key={m.clave} className="mk-kpi">
            <div className="mk-kpi-etiqueta">
              <span className="truncate" title={m.etiqueta}>
                {etiqueta ?? m.etiqueta}
              </span>
            </div>
            <div
              className={`mk-kpi-valor ${sinDato ? "sin-dato" : destacada ? "destacada" : ""} ${largo(texto)}`}
              data-tip={sinDato ? m.motivo || "No se puede calcular con lo que hay conectado." : m.ayuda}
            >
              {texto}
            </div>
            {hayChispa ? <Chispa datos={serie!} destacada={destacada} /> : <span style={{ height: 26, marginTop: 8 }} />}
            <div className="mk-kpi-pie">
              {v && !sinDato && (
                (() => {
                  // «0%» es no moverse: pintarlo rojo por un signo negativo
                  // microscópico haría ver una caída donde no la hay.
                  const plano = /^[+-]?0([.,]0+)?%$/.test(v.texto);
                  const clase = plano ? "igual" : mejora ? "sube" : empeora ? "baja" : "igual";
                  return (
                    <span className={`mk-delta ${clase}`} data-tip="Contra el período anterior del mismo largo">
                      {plano ? "=" : v.signo > 0 ? "▲" : "▼"} {v.texto.replace(/^[+-]/, "")}
                    </span>
                  );
                })()
              )}
              <span
                className={`mk-certeza ${m.certeza}`}
                data-tip={
                  sinDato
                    ? m.motivo || "Falta conectar la fuente de este dato."
                    : m.certeza === "medida"
                      ? "Contado uno por uno, no estimado."
                      : m.certeza === "derivada"
                        ? "Lo calcula Respondo a partir de dos cifras contadas una por una."
                        : "El valor real puede ser mayor: acá solo entra lo que se pagó por enlace de pago."
                }
              >
                {/* AYUDA PROGRESIVA: el caso normal —contado uno por uno— no
                    lleva palabra, solo el punto verde con su explicación al
                    pasar el mouse. La palabra aparece cuando hay algo que
                    advertir: que es un cálculo, que es un mínimo o que falta.
                    Etiquetar lo esperable solo llena la franja de metadatos. */}
                {m.certeza !== "medida" && ROTULO[m.certeza]}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Una línea diminuta con la forma de la serie. Sin ejes: es un gesto, no un gráfico. */
export function Chispa({ datos, destacada }: { datos: (number | null)[]; destacada?: boolean }) {
  const puntos = datos.map((d) => d ?? 0);
  if (puntos.length < 2) return null;
  const max = Math.max(...puntos, 1);
  const w = 120;
  const h = 26;
  const paso = w / (puntos.length - 1);
  const xy = puntos.map((p, i) => [i * paso, h - (p / max) * (h - 4) - 2] as const);
  const d = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const color = destacada ? "var(--indigo)" : "var(--mk-tinta-meta)";
  return (
    <svg className="mk-kpi-chispa" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
