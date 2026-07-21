import { exigirUsuarioPortal } from "@/lib/auth";
import { metaEmpleado } from "@/lib/empleados";
import {
  resumenEmpleados,
  metricasCliente,
  formatearDuracion,
  formatearCLP,
  nombreMes,
  type ResumenEmpleado,
} from "@/lib/resumen";

export const dynamic = "force-dynamic";

/**
 * Qué números mostrar según el rol. Solo se muestra lo que el motor registra
 * de verdad en ed_resultados: si algo no ocurrió, va en 0, nunca estimado.
 */
function statsDeEmpleado(r: ResumenEmpleado): { label: string; valor: string }[] {
  const n = (t: keyof ResumenEmpleado["resultados"]) => String(r.resultados[t] ?? 0);

  if (r.rol === "rita") {
    return [
      { label: "Cotizaciones retomadas", valor: n("cotizacion_retomada") },
      { label: "Clientes reactivados", valor: n("cliente_reactivado") },
      {
        label: "Ventas recuperadas",
        valor: r.montoRecuperado > 0 ? formatearCLP(r.montoRecuperado) : "—",
      },
    ];
  }
  if (r.rol === "vera") {
    return [
      { label: "Encuestas respondidas", valor: n("encuesta_respondida") },
      { label: "Reseñas conseguidas", valor: n("resena_conseguida") },
      { label: "Clientes molestos", valor: n("cliente_molesto") },
    ];
  }
  return [
    { label: "Conversaciones", valor: String(r.conversaciones) },
    { label: "Cotizaciones enviadas", valor: n("cotizacion_enviada") },
    { label: "Agendamientos", valor: n("agendamiento") },
  ];
}

/** Variación vs el período de comparación, con el signo que corresponde. */
function Variacion({
  actual,
  previo,
  mejorSiBaja = false,
  etiqueta,
}: {
  actual: number | null;
  previo: number | null;
  mejorSiBaja?: boolean;
  etiqueta: string;
}) {
  if (actual == null || previo == null || previo === 0) return null;
  const cambio = ((actual - previo) / previo) * 100;
  const mejora = mejorSiBaja ? cambio < 0 : cambio > 0;
  const signo = cambio > 0 ? "+" : "";
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[12px]">
      <span
        className="font-bold"
        style={{ color: mejora ? "var(--ok)" : "var(--muted)" }}
      >
        {signo}
        {Math.round(cambio)}%
      </span>
      <span style={{ color: "var(--muted-2)" }}>{etiqueta}</span>
    </div>
  );
}

function Metrica({
  label,
  valor,
  children,
  destacada = false,
}: {
  label: string;
  valor: string;
  children?: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className="tarjeta p-5">
      <div className="eyebrow">{label}</div>
      <div
        className="titular mt-2 font-extrabold leading-none"
        style={{
          fontSize: destacada ? 34 : 30,
          color: destacada ? "var(--indigo)" : "var(--tinta)",
        }}
      >
        {valor}
      </div>
      {children}
    </div>
  );
}

export default async function Inicio() {
  const usuario = await exigirUsuarioPortal();
  const [empleados, metricas] = await Promise.all([
    resumenEmpleados(usuario.clienteId),
    metricasCliente(usuario.clienteId),
  ]);

  const { actual, comparacion } = metricas;
  const pendientes = empleados.reduce((a, e) => a + e.escalacionesPendientes, 0);
  const antes = comparacion?.esBasal ? "vs antes de Respondo" : "vs mes anterior";

  // UNA SOLA FUENTE para el total del mes. ed_metricas es el consolidado
  // oficial que escribe el motor; si todavía no existe, se cae al conteo
  // derivado de los mensajes. Nunca mezclar las dos en la misma pantalla.
  const derivadas = empleados.reduce((a, e) => a + e.conversaciones, 0);
  const conversacionesMes = actual?.conversaciones ?? derivadas;

  return (
    <main className="mx-auto max-w-5xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Resumen</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">
        Bienvenido, {usuario.clienteNombre}
      </h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
        {conversacionesMes > 0 ? (
          <>
            Este mes tu equipo digital atendió{" "}
            <strong style={{ color: "var(--tinta)" }}>
              {conversacionesMes} conversaciones
            </strong>
            {actual?.leadsCapturados != null && (
              <>
                {" "}
                y capturó{" "}
                <strong style={{ color: "var(--tinta)" }}>
                  {actual.leadsCapturados} clientes potenciales
                </strong>
              </>
            )}
            , sin que tuvieras que estar pendiente del teléfono.
          </>
        ) : (
          <>Todavía no hay actividad registrada este mes.</>
        )}
      </p>

      {pendientes > 0 && (
        <div
          className="mt-6 flex items-start gap-3 rounded-2xl border p-4"
          style={{ borderColor: "var(--alerta-borde)", background: "var(--alerta-suave)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--alerta)" strokeWidth="1.8" strokeLinecap="round" className="mt-0.5 shrink-0">
            <path d="M12 8v5m0 3.5v.01M10.3 3.9 2.5 17.5A1.7 1.7 0 0 0 4 20h16a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a1.7 1.7 0 0 0-3 0z" />
          </svg>
          <div>
            <strong>
              {pendientes} conversación{pendientes > 1 ? "es" : ""} te está esperando
            </strong>
            <div className="text-[14px]" style={{ color: "var(--muted)" }}>
              Tu asistente las derivó porque necesitan a una persona.
            </div>
          </div>
        </div>
      )}

      {actual && (
        <>
          <div className="mt-9 flex items-baseline justify-between">
            <h2 className="titular text-[17px] font-bold capitalize">
              {nombreMes(actual.periodo)}
            </h2>
            <span className="text-[12px]" style={{ color: "var(--muted-2)" }}>
              {comparacion ? antes.replace("vs ", "Comparado con ") : ""}
            </span>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica label="Conversaciones" valor={String(actual.conversaciones ?? "—")}>
              <Variacion
                actual={actual.conversaciones}
                previo={comparacion?.conversaciones ?? null}
                etiqueta={antes}
              />
            </Metrica>

            <Metrica
              label="Clientes potenciales"
              valor={String(actual.leadsCapturados ?? "—")}
            >
              <Variacion
                actual={actual.leadsCapturados}
                previo={comparacion?.leadsCapturados ?? null}
                etiqueta={antes}
              />
            </Metrica>

            <Metrica
              label="Tiempo de respuesta"
              valor={formatearDuracion(actual.tiempoRespuestaSeg)}
              destacada
            >
              {comparacion?.tiempoRespuestaSeg != null && (
                <div className="mt-2 text-[12px]" style={{ color: "var(--muted-2)" }}>
                  antes{" "}
                  <strong style={{ color: "var(--muted)" }}>
                    {formatearDuracion(comparacion.tiempoRespuestaSeg)}
                  </strong>
                </div>
              )}
            </Metrica>

            <Metrica
              label="Resuelto sin ti"
              valor={
                actual.resueltasSinHumanoPct != null
                  ? `${Number(actual.resueltasSinHumanoPct)}%`
                  : "—"
              }
            >
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--borde)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Number(actual.resueltasSinHumanoPct ?? 0))}%`,
                    background: "var(--indigo)",
                  }}
                />
              </div>
            </Metrica>
          </div>
        </>
      )}

      {/* Empleados */}
      <h2 className="titular mt-11 text-[17px] font-bold">Tu equipo digital</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {empleados.map((r) => {
          const meta = metaEmpleado(r.rol);
          return (
            <div key={r.empleadoId} className="tarjeta overflow-hidden">
              <div className="flex items-center gap-3 p-5 pb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={meta.avatar}
                  alt={r.nombrePublico}
                  width={48}
                  height={48}
                  className="avatar h-12 w-12"
                  style={{ ["--anillo" as string]: meta.color }}
                />
                <div className="min-w-0">
                  <div className="titular truncate text-[17px] font-bold">
                    {r.nombrePublico || meta.nombrePorDefecto}
                  </div>
                  <div
                    className="truncate text-[12px] font-semibold"
                    style={{ color: meta.color }}
                  >
                    {meta.funcion}
                  </div>
                </div>
              </div>

              <dl className="space-y-2.5 px-5 pb-5">
                {statsDeEmpleado(r).map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[13px]" style={{ color: "var(--muted)" }}>
                      {s.label}
                    </dt>
                    <dd className="titular text-[17px] font-bold">{s.valor}</dd>
                  </div>
                ))}
              </dl>

              {r.escalacionesPendientes > 0 && (
                <div
                  className="px-5 py-3 text-[12px] font-bold"
                  style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
                >
                  {r.escalacionesPendientes} esperando por ti
                </div>
              )}
            </div>
          );
        })}
      </div>

      {empleados.length === 0 && (
        <div
          className="mt-4 rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted)" }}
        >
          Todavía no tienes empleados activos.
        </div>
      )}

      <p className="mt-8 text-[12px]" style={{ color: "var(--muted-2)" }}>
        Los números vienen de la actividad real de tus empleados y se actualizan solos.
      </p>
    </main>
  );
}
