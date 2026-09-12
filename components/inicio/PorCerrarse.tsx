import Link from "next/link";
import type { FilaOportunidad } from "@/lib/estadoComercial";
import type { TipoOportunidad } from "@/lib/estadoComercialCore";
import { haceCuanto, pesos } from "@/lib/estadoComercialVista";
import { EtapaEstado, Vacio } from "@/components/estado/Estados";
import { hrefConversacion } from "@/components/inicio/NecesitaAtencion";

/**
 * B · POR CERRARSE. Oportunidades con datos que existen: cobros enviados,
 * cotizaciones con conversación viva o sin respuesta (3 a 30 días),
 * seguimientos de Beto en curso e interesados recientes. Monto solo cuando lo
 * hay de verdad (un cobro): la base no guarda el valor de una cotización.
 */

const VISIBLES = 6;

const RESUMEN: { tipo: TipoOportunidad; uno: string; varios: string }[] = [
  { tipo: "cobro_pendiente", uno: "cobro esperando pago", varios: "cobros esperando pago" },
  { tipo: "cotizacion_activa", uno: "cotización en conversación", varios: "cotizaciones en conversación" },
  { tipo: "seguimiento_en_curso", uno: "con seguimiento", varios: "con seguimiento" },
  { tipo: "cotizacion_sin_respuesta", uno: "sin respuesta", varios: "sin respuesta" },
  { tipo: "interesado", uno: "interesado", varios: "interesados" },
];

export default function PorCerrarse({
  filas,
  conteo,
  ahora,
  verMontos,
}: {
  filas: FilaOportunidad[];
  conteo: Partial<Record<TipoOportunidad, number>>;
  ahora: number;
  verMontos: boolean;
}) {
  const partes = RESUMEN.filter((r) => (conteo[r.tipo] ?? 0) > 0).map(
    (r) => `${conteo[r.tipo]} ${(conteo[r.tipo] ?? 0) === 1 ? r.uno : r.varios}`,
  );

  return (
    <section aria-labelledby="t-cerrar">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="t-cerrar" className="font-semibold" style={{ fontSize: "var(--t-titulo)" }}>
          Por cerrarse
        </h2>
        <Link href="/embudo" className="font-semibold hover:underline" style={{ fontSize: "var(--t-menor)", color: "var(--azul)" }}>
          Ver embudo →
        </Link>
      </div>
      {partes.length > 0 && (
        <p className="mb-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          {partes.join(" · ")}
        </p>
      )}

      <div className="tarjeta overflow-hidden">
        {filas.length === 0 ? (
          <Vacio titulo="Sin oportunidades abiertas" texto="Cuando alguien reciba una cotización o un cobro, aparece acá." />
        ) : (
          <ul className="lista-filas">
            {filas.slice(0, VISIBLES).map((f) => (
              <li key={f.chatId}>
                <Link href={hrefConversacion(f)} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--fondo-hundido)]">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                        {f.nombre}
                      </span>
                      <EtapaEstado etapa={f.etapa} />
                    </span>
                    <span className="mt-0.5 block truncate" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                      {f.oportunidad.label}
                      {f.ultimoMensaje && f.oportunidad.tipo !== "cobro_pendiente" && (
                        <span style={{ color: "var(--muted-2)" }}> · «{f.ultimoMensaje}»</span>
                      )}
                    </span>
                  </span>
                  {verMontos && f.oportunidad.monto !== null && (
                    <span className="cifra shrink-0 font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                      {pesos(f.oportunidad.monto)}
                    </span>
                  )}
                  <span
                    className="cifra hidden shrink-0 text-right sm:block"
                    style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)", minWidth: 44 }}
                  >
                    {haceCuanto(f.oportunidad.desde, ahora)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {filas.length > VISIBLES && (
          <Link
            href="/embudo"
            className="block border-t px-4 py-2.5 hover:bg-[var(--fondo-hundido)]"
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)", borderColor: "var(--borde)" }}
          >
            {filas.length - VISIBLES} más en el embudo →
          </Link>
        )}
      </div>
    </section>
  );
}
