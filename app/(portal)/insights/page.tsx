import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { obtenerInsight, listarSemanas, semanaDe } from "@/lib/insights";
import BotonInforme from "@/components/BotonInforme";

export const dynamic = "force-dynamic";
/**
 * Generar el informe implica que el modelo razone sobre cientos de mensajes:
 * medido en ~25-40 s. Sin esta línea, Vercel corta la función mucho antes y el
 * botón falla sin explicación. Las Server Actions de esta ruta heredan el tope.
 */
export const maxDuration = 60;

/** "27 jul al 2 ago" */
function rango(desde: string, hasta: string): string {
  const f = (s: string, conMes: boolean) =>
    new Intl.DateTimeFormat("es-CL", {
      timeZone: "UTC",
      day: "numeric",
      ...(conMes ? { month: "short" } : {}),
    }).format(new Date(`${s}T12:00:00Z`));
  return `${f(desde, false)} al ${f(hasta, true)}`;
}

function Bloque({
  titulo,
  descripcion,
  items,
  color,
  vinieta,
}: {
  titulo: string;
  descripcion: string;
  items: string[];
  color: string;
  vinieta: string;
}) {
  if (!items.length) return null;
  return (
    <div className="tarjeta p-5">
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-black"
          style={{ background: `${color}1A`, color }}
        >
          {vinieta}
        </span>
        <h2 className="h-seccion">{titulo}</h2>
      </div>
      <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
        {descripcion}
      </p>
      <ul className="mt-3.5 space-y-2.5">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function Insights({
  searchParams,
}: {
  searchParams: { semana?: string };
}) {
  const usuario = await exigirUsuarioPortal();
  const [insight, semanas] = await Promise.all([
    obtenerInsight(usuario.clienteId, searchParams.semana),
    listarSemanas(usuario.clienteId),
  ]);
  const actual = semanaDe(new Date(), 0);
  const hayDeEstaSemana = semanas.some((s) => s.desde === actual.desde);

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Informe</h1>
        <span className="sub-titulo">
          Qué pidieron tus clientes esta semana y dónde se perdieron ventas
        </span>
      </div>

      {/* Semanas disponibles */}
      {semanas.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {semanas.slice(0, 8).map((s) => {
            const activa = insight?.periodoDesde === s.desde;
            return (
              <Link
                key={s.desde}
                href={`/insights?semana=${s.desde}`}
                className="rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
                style={
                  activa
                    ? { background: "var(--indigo)", color: "#fff" }
                    : { background: "#F1F2F7", color: "var(--muted)" }
                }
              >
                {rango(s.desde, s.hasta)}
              </Link>
            );
          })}
        </div>
      )}

      {!insight ? (
        <div className="tarjeta mt-6 p-8 text-center">
          <h2 className="h-seccion">Todavía no hay informe</h2>
          <p
            className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Genera el primero cuando quieras. Necesitamos al menos unas cuantas
            conversaciones en la semana para que el análisis valga la pena.
          </p>
          <div className="mt-5 flex justify-center">
            <BotonInforme />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="h-seccion">
                Semana del {rango(insight.periodoDesde, insight.periodoHasta)}
              </div>
              <div className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                {insight.conversaciones} conversaciones · {insight.mensajes} mensajes
                analizados
              </div>
            </div>
            <BotonInforme
              etiqueta={hayDeEstaSemana ? "Actualizar informe" : "Generar el de esta semana"}
            />
          </div>

          {/* Resumen ejecutivo — lo primero que se lee */}
          <div
            className="tarjeta mt-5 p-6"
            style={{ borderLeft: "3px solid var(--indigo)" }}
          >
            <div style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }}>
              Lo importante
            </div>
            <ul className="mt-3 space-y-3">
              {insight.contenido.resumen.map((x, i) => (
                <li key={i} className="leading-relaxed" style={{ fontSize: "var(--t-cuerpo)" }}>
                  {x}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Bloque
              titulo="Qué te pidieron"
              descripcion="Lo que más consultaron tus clientes"
              items={insight.contenido.piden}
              color="#2563EB"
              vinieta="?"
            />
            <Bloque
              titulo="Dónde se perdieron ventas"
              descripcion="Fallas de atención y del asistente"
              items={insight.contenido.problemas}
              color="#DC2626"
              vinieta="!"
            />
            <Bloque
              titulo="Oportunidades"
              descripcion="Lo que conviene hacer esta semana"
              items={insight.contenido.oportunidades}
              color="#7C3AED"
              vinieta="→"
            />
            <Bloque
              titulo="Lo que está funcionando"
              descripcion="Mantener esto"
              items={insight.contenido.fortalezas}
              color="#047857"
              vinieta="✓"
            />
          </div>

          {/* Categorías */}
          {insight.contenido.categorias.length > 0 && (
            <div className="tarjeta mt-5 p-5">
              <h2 className="h-seccion">De qué se habló</h2>
              <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                Temas detectados en las conversaciones de la semana
              </p>
              <div className="mt-4 space-y-3">
                {insight.contenido.categorias.map((c) => {
                  const total = insight.contenido.categorias.reduce(
                    (s, x) => s + (x.tickets || 0),
                    0,
                  );
                  const pct = total ? Math.round((c.tickets / total) * 100) : 0;
                  return (
                    <div key={c.nombre}>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-[14px] font-bold">{c.nombre}</div>
                        <div className="shrink-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
                          {c.tickets} · {pct}%
                        </div>
                      </div>
                      <div
                        className="mt-1.5 h-2 w-full overflow-hidden rounded-full"
                        style={{ background: "#EEF0F6" }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: "var(--indigo)",
                          }}
                        />
                      </div>
                      {c.descripcion && (
                        <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
                          {c.descripcion}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-4 text-[12px]" style={{ color: "var(--muted-2)" }}>
            Informe generado el{" "}
            {new Intl.DateTimeFormat("es-CL", {
              timeZone: "America/Santiago",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(insight.creadoEn))}{" "}
            a partir de tus conversaciones reales. Si algo no cuadra, avísanos.
          </p>
        </>
      )}
    </main>
  );
}
