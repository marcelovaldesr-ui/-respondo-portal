import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuarioPortal } from "@/lib/auth";
import { fichaCliente, type EventoCliente } from "@/lib/clientes";
import { metaEtapa } from "@/lib/embudo";
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
};

export default async function Ficha({ params }: { params: { chatId: string } }) {
  const usuario = await exigirUsuarioPortal();
  const f = await fichaCliente(usuario.clienteId, params.chatId);
  if (!f) notFound();

  const me = metaEtapa(f.etapa);

  return (
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <Link href="/clientes" className="text-[12.5px] font-semibold" style={{ color: "var(--muted)" }}>
        ← Clientes
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h-pagina">{f.nombre}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              +{f.chatId}
            </span>
            <span className="pildora" style={{ background: me.fondo, color: me.color }}>
              {me.label}
            </span>
            {f.esperandoHumano && <span className="pildora-alerta">Te espera</span>}
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
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
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
            <div className="eyebrow">{t}</div>
            <div className="titular mt-1 text-[19px] font-extrabold leading-none">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Línea de tiempo */}
        <section>
          <h2 className="h-seccion">Historial</h2>
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
