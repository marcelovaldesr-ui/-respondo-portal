import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuarioPortal } from "@/lib/auth";
import { fichaCliente, type EventoCliente } from "@/lib/clientes";
import { etiquetaMotivoEtapa } from "@/lib/etapasCore";
import { EtapaEstado, Estado } from "@/components/estado/Estados";
import { metaEtiqueta } from "@/lib/etiquetas";
import { fechaLarga } from "@/lib/fechas";
import FichaClienteEditor from "@/components/FichaClienteEditor";

export const dynamic = "force-dynamic";

const ESTILO_EVENTO: Record<EventoCliente["tipo"], { color: string; label: string }> = {
  conversacion: { color: "#64748B", label: "Conversación" },
  resultado: { color: "#166534", label: "Resultado" },
  escalacion: { color: "#9A3412", label: "Atención" },
  seguimiento: { color: "#4F46E5", label: "Seguimiento" },
  etapa: { color: "#7C3AED", label: "Embudo" },
  cita: { color: "#0E7490", label: "Cita" },
};

const ESTILO_CITA: Record<string, { fondo: string; texto: string; label: string }> = {
  completada: { fondo: "var(--ok-suave)", texto: "var(--ok)", label: "Asistió" },
  confirmada: { fondo: "#ecfeff", texto: "#0e7490", label: "Confirmada" },
  agendada: { fondo: "var(--azul-suave)", texto: "var(--azul)", label: "Agendada" },
  reagendada: { fondo: "var(--azul-suave)", texto: "var(--azul)", label: "Reagendada" },
  no_show: { fondo: "#fef3c7", texto: "#92400e", label: "No llegó" },
  cancelada: { fondo: "#f1f5f9", texto: "#64748b", label: "Cancelada" },
};

export default async function Ficha({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  const usuario = await exigirUsuarioPortal();
  const f = await fichaCliente(usuario.clienteId, chatId);
  if (!f) notFound();


  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <Link href="/clientes" className="text-[12.5px] font-semibold" style={{ color: "var(--muted)" }}>
        ← Clientes
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h-cifra">{f.nombre}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              +{f.chatId}
            </span>
            <EtapaEstado etapa={f.etapa} motivo={etiquetaMotivoEtapa(f.etapa, f.etapaMotivo)} />
            {f.esperandoHumano && (
              <Estado tono="peligro" punto>
                Te espera
              </Estado>
            )}
            {f.etiquetas.map((v) => {
              const m = metaEtiqueta(v);
              return (
                <span key={v} className="pildora" style={{ background: m.fondo, color: m.color }}>
                  {m.label}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {f.empleadoId && (
            <Link
              href={`/conversaciones?emp=${f.empleadoId}&chat=${f.chatId}`}
              className="btn-primario"
            >
              Abrir conversación
            </Link>
          )}
          <a
            href={`https://wa.me/${f.chatId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-suave"
          >
            WhatsApp
          </a>
        </div>
      </div>

      {/* Resumen en números */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Atenciones", `${f.visitasCompletadas}${f.inasistencias > 0 ? ` (${f.inasistencias} falta${f.inasistencias === 1 ? "" : "s"})` : ""}`],
          ["Mensajes", String(f.mensajes)],
          ["Cotizaciones", String(f.cotizaciones)],
          [
            "Cliente desde",
            f.primeraVez
              ? new Intl.DateTimeFormat("es-CL", {
                  timeZone: "America/Santiago",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(new Date(f.primeraVez))
              : "—",
          ],
          [
            "Sin hablar",
            f.diasSinHablar === null
              ? "—"
              : f.diasSinHablar === 0
                ? "hoy hablaron"
                : `${f.diasSinHablar} día${f.diasSinHablar === 1 ? "" : "s"}`,
          ],
        ].map(([t, v]) => (
          <div key={t} className="tarjeta p-3.5">
            <div style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>{t}</div>
            <div className="h-cifra cifra mt-1">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Historial de citas + Línea de tiempo */}
        <section className="space-y-6">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="h-seccion">Historial de citas</h2>
                <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                  Servicios agendados, con quién se atendió y observaciones de cada visita
                </p>
              </div>
              <Link href="/agenda" className="text-[12.5px] font-semibold" style={{ color: "var(--azul)" }}>
                Ir a la agenda →
              </Link>
            </div>

            {f.citas.length === 0 ? (
              <div
                className="tarjeta mt-3 p-6 text-center text-[13px]"
                style={{ color: "var(--muted)" }}
              >
                Todavía no tiene citas registradas en la agenda.
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                {f.citas.map((c) => {
                  const est = ESTILO_CITA[c.estado] ?? {
                    fondo: "#f1f5f9",
                    texto: "#475569",
                    label: c.estado,
                  };
                  const extras = c.datosExtra ? Object.entries(c.datosExtra) : [];
                  return (
                    <div
                      key={c.id}
                      className="tarjeta flex flex-wrap items-start justify-between gap-3 p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold">
                            {c.servicio ?? "Cita"}
                          </span>
                          <span
                            className="pildora"
                            style={{ background: est.fondo, color: est.texto }}
                          >
                            {est.label}
                          </span>
                          {c.precioClp !== null && c.precioClp > 0 && (
                            <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
                              ${c.precioClp.toLocaleString("es-CL")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                          {fechaLarga(c.inicio)}
                          {c.profesional ? ` · Con ${c.profesional}` : ""}
                          {` · Reservó por ${c.origen}`}
                        </p>
                        {c.notas && (
                          <p className="mt-1 text-[12.5px]" style={{ color: "var(--tinta)" }}>
                            Nota: {c.notas}
                          </p>
                        )}
                        {extras.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {extras.map(([k, v]) => (
                              <span
                                key={k}
                                className="rounded border px-2 py-0.5 text-[11.5px]"
                                style={{ borderColor: "var(--borde)", color: "var(--muted)" }}
                              >
                                <b>{k}:</b> {String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Link
                        href={`/agenda?cita=${encodeURIComponent(c.id)}`}
                        className="btn-suave shrink-0 px-2.5 py-1 text-[12px]"
                      >
                        Ver en agenda
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h2 className="h-seccion">Línea de tiempo</h2>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              Todo lo que ha pasado con esta persona, de lo más reciente a lo más antiguo
            </p>

            {f.eventos.length === 0 ? (
              <div
                className="tarjeta mt-3 p-8 text-center text-[13px]"
                style={{ color: "var(--muted)" }}
              >
                Todavía no hay actividad registrada.
              </div>
            ) : (
              <ol className="mt-3">
                {f.eventos.map((e, i) => {
                  const est = ESTILO_EVENTO[e.tipo];
                  const ultimo = i === f.eventos.length - 1;
                  return (
                    <li key={i} className="flex gap-3">
                      {/* Riel de la línea de tiempo */}
                      <div className="flex flex-col items-center">
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: est.color }}
                        />
                        {!ultimo && (
                          <span className="w-px flex-1" style={{ background: "var(--borde)" }} />
                        )}
                      </div>
                      <div className={"min-w-0 flex-1 " + (ultimo ? "pb-1" : "pb-5")}>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[13.5px] font-semibold">{e.titulo}</span>
                          <span className="text-[11.5px]" style={{ color: "var(--muted-2)" }}>
                            {fechaLarga(e.fecha)}
                          </span>
                        </div>
                        {e.detalle && (
                          <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--muted)" }}>
                            {e.detalle}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* Datos + reactivación */}
        <aside>
          <FichaClienteEditor
            chatId={f.chatId}
            nombre={f.nombre}
            telefono={f.telefono}
            email={f.email}
            notas={f.notas}
            diasSinHablar={f.diasSinHablar}
          />
        </aside>
      </div>
    </main>
  );
}
