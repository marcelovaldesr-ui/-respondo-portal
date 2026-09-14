import { ETIQUETA_ACCION, plata, type Analisis, type Recomendacion } from "@/lib/ads/analisis";

/**
 * LOS CAMBIOS PROPUESTOS — un hecho, un consejo, y la evidencia de los dos.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA TARJETA EXISTE SEPARADA DE «HALLAZGOS»
 *
 * Un hallazgo es un HECHO («el costo por conversión subió 34%») y se sostiene
 * solo. Una recomendación es un CONSEJO («antes de escalar, probaría otra
 * creatividad») y puede estar equivocada. Mezclarlos hace que, cuando el
 * consejo falla, el dueño deje de creerle también a los hechos —que es la
 * forma más rápida de que un panel de publicidad deje de usarse—.
 *
 * Por eso cada propuesta muestra las cinco cosas que permiten DISCUTIRLA:
 * qué, dónde, por qué, con qué evidencia y qué se pierde si está mal. Es la
 * misma tabla que la skill de Google Ads viene usando con una cuenta real; sin
 * esas columnas, una recomendación es una opinión.
 *
 * ⚠️ Y ninguna está ejecutada. Respondo no escribe en Meta ni en Google: lo
 * dice el pie, para que nadie crea que ya se aplicó.
 * ───────────────────────────────────────────────────────────────────────────
 */

const COLOR_ACCION: Record<string, string> = {
  pausar: "var(--alerta)",
  reducir: "var(--alerta)",
  escalar: "var(--ok)",
  mantener: "var(--ok)",
  probar: "var(--indigo)",
  observar: "var(--muted)",
  revisar: "var(--indigo)",
};

function Tarjeta({ r }: { r: Recomendacion }) {
  return (
    <li className="mk-tarjeta p-3.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className="mk-pildora"
          style={{ background: "transparent", border: `1px solid ${COLOR_ACCION[r.accion] ?? "var(--borde)"}`, color: COLOR_ACCION[r.accion] ?? "var(--muted)" }}
        >
          {ETIQUETA_ACCION[r.accion]}
        </span>
        <span className="font-semibold" style={{ fontSize: "14px" }}>
          {r.que}
        </span>
      </div>
      <p className="mk-meta mt-1">{r.donde}</p>
      <p className="mt-2" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
        {r.porQue}
      </p>
      <p className="mt-2" style={{ fontSize: "12.5px" }}>
        <strong>Evidencia:</strong> {r.evidencia}
      </p>
      <p className="mk-meta mt-1">
        Riesgo si me equivoco: {r.riesgo}
      </p>
      <p className="mk-meta mt-1">
        Confianza {r.confianza} · calculado con: {r.datosUsados.join(", ")}
        {r.plataEnJuego !== null ? ` · toca ${plata(r.plataEnJuego, r.moneda)} de inversión` : ""}
      </p>
    </li>
  );
}

export default function Recomendaciones({ analisis, max = 4 }: { analisis: Analisis; max?: number }) {
  const { recomendaciones, insuficientes, nadaQueCambiar } = analisis;
  const visibles = recomendaciones.slice(0, max);

  return (
    <section className="mk-panel mt-7">
      <div className="mk-panel-cabecera">
        <div>
          <h2 className="mk-h2">Cambios que propondría</h2>
          <p className="mk-meta mt-0.5">
            Ordenados por la plata que tocan, no por lo fácil que son de hacer.
          </p>
        </div>
        {recomendaciones.length > visibles.length && (
          <span className="mk-meta">
            Las {visibles.length} de mayor impacto, de {recomendaciones.length}
          </span>
        )}
      </div>

      <div className="mk-panel-cuerpo">
        {visibles.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {visibles.map((r) => (
              <Tarjeta key={r.clave} r={r} />
            ))}
          </ul>
        ) : (
          /**
           * ⭐ «Nada que cambiar» ES una respuesta, no un vacío.
           *
           * Un analista que inventa recomendaciones para llenar el informe hace
           * perder plata. Que la pantalla pueda decir esto con todas sus letras
           * es lo que hace creíbles las semanas en que sí propone algo.
           */
          <p style={{ fontSize: "13.5px", color: "var(--muted-2)" }}>
            {nadaQueCambiar
              ? "Con lo que hay en este período no hay nada que cambiar. No es que no haya datos: es que ninguno alcanza el umbral para justificar tocar una campaña."
              : "Sin datos suficientes para proponer cambios todavía."}
          </p>
        )}

        {insuficientes.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold" style={{ fontSize: "13px" }}>
              Lo que todavía no se puede concluir
            </h3>
            <ul className="mt-1.5 space-y-1">
              {insuficientes.slice(0, 4).map((i) => (
                <li key={i.clave} style={{ fontSize: "12.5px", color: "var(--muted-2)" }}>
                  · <strong>{i.que}:</strong> {i.queFalta}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mk-meta mt-4">
          Ninguno de estos cambios está aplicado. Respondo lee tus cuentas publicitarias, no las modifica: los cambios
          se hacen en el Administrador de Anuncios.
        </p>
      </div>
    </section>
  );
}
