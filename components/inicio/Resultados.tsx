import Link from "next/link";
import type { ResultadosInicio } from "@/lib/inicio";
import { pesos } from "@/lib/estadoComercialVista";
import { formatearDuracion } from "@/lib/analitica";

/**
 * D · ¿ESTÁ FUNCIONANDO? Tres o cuatro cifras, en un solo bloque.
 *
 * Quedan las que se pueden defender: conversaciones del mes (conteo exacto),
 * cuánto de lo respondido escribió el asistente (conteo exacto, con las
 * últimas 24 h al lado para no esconder un arranque reciente), tiempo ahorrado
 * (estimado, y lo dice) y lo cobrado con pago confirmado (solo el dueño).
 *
 * Sale el «dinero ahorrado»: multiplica un supuesto (minutos por respuesta)
 * por otro (valor de la hora). Vive en Analítica, donde se ven los supuestos.
 */
export default function Resultados({
  r,
  cobros,
}: {
  r: ResultadosInicio;
  cobros: { montoMes: number; pagadosMes: number; pendientes: number } | null;
}) {
  const celdas: { label: string; valor: string; nota: string | null }[] = [];
  if (r.conversacionesMes !== null) {
    celdas.push({ label: "Conversaciones", valor: r.conversacionesMes.toLocaleString("es-CL"), nota: "este mes" });
  }
  if (r.coberturaIA !== null) {
    celdas.push({
      label: "Respondió el asistente",
      valor: `${r.coberturaIA}%`,
      nota:
        r.coberturaReciente !== null && r.coberturaReciente !== r.coberturaIA
          ? `30 días · últimas 24 h: ${r.coberturaReciente}%`
          : "de las respuestas, 30 días",
    });
  }
  if (r.minutosAhorrados !== null && r.minutosAhorrados > 0) {
    celdas.push({
      label: "Tiempo ahorrado",
      valor: formatearDuracion(r.minutosAhorrados),
      nota: `estimado: ${r.minutosPorMensaje} min por respuesta`,
    });
  }
  if (cobros && (cobros.pagadosMes > 0 || cobros.pendientes > 0)) {
    celdas.push({
      label: "Cobrado y confirmado",
      valor: pesos(cobros.montoMes),
      nota: `${cobros.pagadosMes} ${cobros.pagadosMes === 1 ? "pago" : "pagos"} este mes${cobros.pendientes ? ` · ${cobros.pendientes} esperando` : ""}`,
    });
  }
  if (!celdas.length) return null;

  return (
    <section aria-labelledby="t-resultados">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="t-resultados" className="font-semibold" style={{ fontSize: "var(--t-titulo)" }}>
          ¿Está funcionando?
        </h2>
        <Link href="/analitica" className="font-semibold hover:underline" style={{ fontSize: "var(--t-menor)", color: "var(--azul)" }}>
          Analítica →
        </Link>
      </div>
      <dl className="tarjeta grid grid-cols-2 overflow-hidden">
        {celdas.map((c, i) => (
          <div
            key={c.label}
            className="px-4 py-3.5"
            style={{
              borderTop: i >= 2 ? "1px solid var(--borde)" : undefined,
              borderLeft: i % 2 === 1 ? "1px solid var(--borde)" : undefined,
            }}
          >
            <dt style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>{c.label}</dt>
            <dd className="cifra mt-1 font-semibold" style={{ fontSize: 19, letterSpacing: "-0.02em" }}>
              {c.valor}
            </dd>
            {c.nota && (
              <dd className="mt-0.5" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                {c.nota}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
