import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import {
  calcularAnalitica,
  formatearCLP,
  formatearDuracion,
  HORARIO,
  SUPUESTOS,
} from "@/lib/analitica";

export const dynamic = "force-dynamic";

/**
 * Color de "lo respondió una persona de tu equipo".
 *
 * Era ámbar #F59E0B. Con el asistente cubriendo el 7% del período, ese ámbar
 * pintaba el 93% de la pantalla: barras, leyendas y el gráfico diario casi
 * enteros en color de advertencia. El panel se leía como si algo estuviera
 * fallando, cuando que tu equipo conteste no es una falla — es lo normal
 * mientras el asistente arranca.
 *
 * Gris: no es ni bueno ni malo, es el otro lado del reparto. El índigo queda
 * para lo que el producto sí aporta, que es lo único que debería destacar.
 */
const COLOR_EQUIPO = "#A3ABBC";

const DIAS_NOMBRE = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const PERIODOS = [
  { d: 1, label: "Hoy" },
  { d: 7, label: "7 días" },
  { d: 30, label: "30 días" },
  { d: 90, label: "90 días" },
];

/** Tarjeta de número grande. */
function Metrica({
  titulo,
  valor,
  pie,
  color,
  destacada,
  extra,
}: {
  titulo: string;
  valor: string;
  pie?: string;
  color?: string;
  destacada?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    /* Sin gradiente: la métrica importante se distingue por una barra de acento
       a la izquierda, no por un fondo de color. Es más sobrio y no compite con
       el dato, que es lo único que hay que leer. */
    <div
      className="tarjeta p-4"
      style={destacada ? { borderLeft: "3px solid var(--indigo)" } : undefined}
    >
      <div style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>{titulo}</div>
      <div
        className="h-cifra cifra mt-1.5"
        style={{ color: color ?? "var(--tinta)" }}
      >
        {valor}
      </div>
      {extra && <div className="mt-2">{extra}</div>}
      {pie && (
        <div className="mt-2 text-[12.5px] leading-snug" style={{ color: "var(--muted)" }}>
          {pie}
        </div>
      )}
    </div>
  );
}

/** Barra de proporción de un solo trazo con varios tramos. */
function Barra({ tramos }: { tramos: { n: number; color: string; label: string }[] }) {
  const total = tramos.reduce((s, t) => s + t.n, 0) || 1;
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "#EEF0F6" }}>
        {tramos.map((t) => (
          <div
            key={t.label}
            style={{ width: `${(t.n / total) * 100}%`, background: t.color }}
            title={`${t.label}: ${t.n}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {tramos.map((t) => (
          <div key={t.label} className="flex items-center gap-1.5 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
            <span style={{ color: "var(--muted)" }}>{t.label}</span>
            <strong>{t.n}</strong>
            <span style={{ color: "var(--muted-2)" }}>
              ({Math.round((t.n / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default async function Analitica({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const usuario = await exigirUsuarioPortal();
  const dias = [1, 7, 30, 90].includes(Number(params.dias))
    ? Number(params.dias)
    : 30;
  const a = await calcularAnalitica(usuario.clienteId, dias);

  if (!a || a.recibidos + a.enviadosIA + a.enviadosHumano === 0) {
    return (
      <main className="px-5 py-6 sm:px-7 lg:px-8">
        <h1 className="h-pagina">
          Analítica
        </h1>
        <div className="tarjeta mt-6 p-10 text-center" style={{ color: "var(--muted)" }}>
          Todavía no hay actividad que medir. En cuanto tu equipo digital empiece a
          conversar, acá vas a ver cuánto tiempo y dinero te está ahorrando.
        </div>
      </main>
    );
  }

  const horas = `${HORARIO.desde}:00 a ${HORARIO.hasta}:00, lunes a viernes`;
  const maxSerie = Math.max(1, ...a.serie.map((s) => s.ia + s.humano));

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Analítica</h1>
        <span className="sub-titulo">Lo que hizo tu equipo digital, en números</span>
      </div>

      {/* Selector de período */}
      <div className="mt-5 flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Link
            key={p.d}
            href={`/analitica?dias=${p.d}`}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
            style={
              p.d === dias
                ? { background: "var(--indigo)", color: "#fff" }
                : { background: "#F1F2F7", color: "var(--muted)" }
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* Fila principal: lo que justifica la mensualidad */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metrica
          destacada
          titulo="Dinero ahorrado"
          valor={formatearCLP(a.dineroAhorradoCLP)}
          color="var(--indigo)"
          pie={`Estimado sobre ${a.enviadosIA} mensajes que respondió tu asistente`}
        />
        <Metrica
          destacada
          titulo="Tiempo ahorrado"
          valor={formatearDuracion(a.minutosAhorrados)}
          color="var(--indigo)"
          pie="Tiempo que tu equipo no gastó respondiendo"
        />
        <Metrica
          titulo="Atendido por IA"
          valor={`${a.coberturaIA}%`}
          pie={`${a.enviadosIA} de ${a.enviadosIA + a.enviadosHumano} respuestas las escribió tu asistente`}
          // El promedio del período puede enterrar el desempeño actual (por
          // ejemplo si el asistente lleva pocos días). Se muestran los dos.
          extra={
            dias > 1 && a.recientesIA + a.recientesHumano > 0 ? (
              <span
                className="pildora"
                style={{
                  background: "var(--indigo-suave)",
                  color: "var(--indigo)",
                }}
              >
                Últimas 24 h: {a.coberturaReciente}%
              </span>
            ) : undefined
          }
        />
        <Metrica
          titulo="Fuera de horario"
          valor={`${a.porcentajeFueraHorario}%`}
          color={a.porcentajeFueraHorario >= 30 ? "var(--coral)" : undefined}
          pie={`${a.recibidosFueraHorario} de ${a.recibidos} mensajes llegaron con el local cerrado`}
        />
      </div>

      {/* Supuestos a la vista: la cuenta se puede rehacer en una servilleta */}
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: "var(--muted-2)" }}>
        El ahorro es una estimación conservadora:{" "}
        <strong>{SUPUESTOS.minutosPorMensaje} minutos por mensaje</strong> atendido ×{" "}
        <strong>{formatearCLP(SUPUESTOS.valorHoraCLP)} la hora</strong>, que es el costo
        hora de quien contesta: un sueldo de referencia de{" "}
        {formatearCLP(SUPUESTOS.sueldoReferenciaCLP)} al mes más las cotizaciones de cargo
        del empleador, sobre una jornada de 42 horas. No incluimos la venta que se pierde
        cuando nadie responde: tu ahorro real es mayor. Horario de referencia: {horas}.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Cobertura */}
        <div className="tarjeta p-5">
          <h2 className="h-seccion">Quién atendió</h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            Respuestas enviadas en el período
          </p>
          <div className="mt-4">
            <Barra
              tramos={[
                { n: a.enviadosIA, color: "var(--indigo)", label: "Tu asistente" },
                { n: a.enviadosHumano, color: COLOR_EQUIPO, label: "Tu equipo" },
              ]}
            />
          </div>
          <div className="mt-6">
            <div className="text-[13px] font-bold" style={{ color: "var(--muted)" }}>
              Conversaciones ({a.conversaciones})
            </div>
            <div className="mt-2.5">
              <Barra
                tramos={[
                  { n: a.convSoloIA, color: "var(--indigo)", label: "Solo IA" },
                  { n: a.convMixtas, color: "#10B981", label: "Mixtas" },
                  { n: a.convSoloHumano, color: COLOR_EQUIPO, label: "Solo tu equipo" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Volumen */}
        <div className="tarjeta p-5">
          <h2 className="h-seccion">Volumen</h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            Movimiento del período
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {[
              ["Mensajes recibidos", a.recibidos],
              ["Respuestas enviadas", a.enviadosIA + a.enviadosHumano],
              ["Personas que escribieron", a.contactosActivos],
              ["Conversaciones", a.conversaciones],
            ].map(([t, v]) => (
              <div key={String(t)}>
                <div className="h-cifra cifra">{String(v)}</div>
                <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {String(t)}
                </div>
              </div>
            ))}
          </div>

          {/* Serie diaria */}
          {a.serie.length > 1 && (
            <div className="mt-6">
              <div className="text-[13px] font-bold" style={{ color: "var(--muted)" }}>
                Respuestas por día
              </div>
              <div className="mt-3 flex h-[90px] items-end gap-1">
                {a.serie.slice(-30).map((s) => (
                  <div
                    key={s.dia}
                    className="flex flex-1 flex-col justify-end"
                    title={`${s.dia} · IA ${s.ia} / equipo ${s.humano}`}
                  >
                    <div
                      style={{
                        height: `${(s.humano / maxSerie) * 78}px`,
                        background: COLOR_EQUIPO,
                        borderRadius: "3px 3px 0 0",
                      }}
                    />
                    <div
                      style={{
                        height: `${(s.ia / maxSerie) * 78}px`,
                        background: "var(--indigo)",
                        borderRadius: s.humano ? 0 : "3px 3px 0 0",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mapa de calor */}
      <div className="tarjeta mt-5 overflow-x-auto p-5">
        <h2 className="h-seccion">Cuándo te escriben</h2>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          Mensajes recibidos por día y hora (hora de Chile). Las zonas oscuras fuera del
          recuadro son las que tu asistente cubre cuando no hay nadie.
        </p>
        <div className="mt-4 min-w-[560px]">
          <div className="flex">
            <div className="w-9 shrink-0" />
            <div className="flex flex-1 gap-[2px]">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[9px]"
                  style={{ color: "var(--muted-2)" }}
                >
                  {h % 3 === 0 ? h : ""}
                </div>
              ))}
            </div>
          </div>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <div key={d} className="mt-[2px] flex items-center">
              <div
                className="w-9 shrink-0 text-[11px] font-semibold"
                style={{ color: "var(--muted)" }}
              >
                {DIAS_NOMBRE[d]}
              </div>
              <div className="flex flex-1 gap-[2px]">
                {a.heatmap[d].map((n, h) => {
                  const intensidad = n / a.heatmapMax;
                  const habil =
                    (HORARIO.diasHabiles as readonly number[]).includes(d) &&
                    h >= HORARIO.desde &&
                    h < HORARIO.hasta;
                  return (
                    <div
                      key={h}
                      className="h-5 flex-1 rounded-[3px]"
                      title={`${DIAS_NOMBRE[d]} ${h}:00 — ${n} mensaje${n === 1 ? "" : "s"}`}
                      style={{
                        background: n
                          ? `rgba(79,70,229,${0.14 + intensidad * 0.86})`
                          : "#F4F5F9",
                        outline: habil ? "1px solid rgba(15,23,42,0.07)" : "none",
                        outlineOffset: "-1px",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
          <span>menos</span>
          {[0.14, 0.35, 0.6, 0.8, 1].map((o) => (
            <span
              key={o}
              className="h-3 w-6 rounded-[3px]"
              style={{ background: `rgba(79,70,229,${o})` }}
            />
          ))}
          <span>más</span>
          <span className="ml-3">· el recuadro marca tu horario de atención</span>
        </div>
      </div>
    </main>
  );
}
