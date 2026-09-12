"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DetalleConversacion } from "@/lib/conversaciones";
import type { AccionSugerida, EstadoComercial } from "@/lib/estadoComercialCore";
import { etiquetaMotivoEtapa } from "@/lib/etapasCore";
import { haceCuanto, metaGrupo, textoBeto, TONOS } from "@/lib/estadoComercialVista";
import { metaEmpleado } from "@/lib/empleados";
import { EtapaEstado, Estado, PagoEstado } from "@/components/estado/Estados";
import { marcarAtendida } from "@/app/(portal)/conversaciones/acciones";
import { confirmarPagoRecibido, marcarPago } from "@/app/(portal)/conversaciones/accionesPagos";

/**
 * FICHA LATERAL DE LA CONVERSACIÓN (Fase 1).
 *
 * Responde en segundos: quién es, en qué va comercialmente, si pagó, quién lo
 * atiende, qué pasó y qué hay que hacer. Todo sale de `d.estado`, calculado
 * con el MISMO núcleo que Inicio (lib/estadoComercialCore.ts): la portada y el
 * chat no pueden decir cosas distintas del mismo cliente.
 *
 * Una sola tarjeta con secciones separadas por líneas, no tarjetas anidadas.
 * La acción principal sale de reglas deterministas del producto; no hay
 * «IA que sugiere». Las acciones que tocan el chat (responder, devolver a
 * Tino, cobrar) viajan por eventos de ventana a los componentes que ya las
 * implementan, para no duplicar su lógica ni desincronizar su estado.
 */

/** Fecha y hora numéricas en hora de Chile. Numérico a propósito: el formato
 * textual de es-CL difiere entre Node y Chromium y rompe la hidratación. */
function fechaHora(iso: string, conHora = true): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return conHora ? `${v("day")}/${v("month")} ${v("hour")}:${v("minute")}` : `${v("day")}/${v("month")}/${v("year")}`;
}

function Seccion({ titulo, children, derecha }: { titulo: string; children: ReactNode; derecha?: ReactNode }) {
  return (
    <section className="px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="rotulo">{titulo}</h3>
        {derecha}
      </div>
      {children}
    </section>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2 py-1">
      <dt style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }} className="pt-[3px]">
        {etiqueta}
      </dt>
      <dd className="min-w-0" style={{ fontSize: "var(--t-cuerpo)" }}>
        {children}
      </dd>
    </div>
  );
}

const avisar = () => window.dispatchEvent(new Event("respondo:detalle-cambio"));

function AccionPrincipal({
  accion,
  d,
  empleadoId,
  estado,
}: {
  accion: AccionSugerida;
  d: DetalleConversacion;
  empleadoId: string;
  estado: EstadoComercial;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formPago, setFormPago] = useState(false);
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");

  const tras = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) {
      setError(r.error ?? "No se pudo completar.");
      return;
    }
    setError(null);
    setFormPago(false);
    avisar();
    router.refresh();
  };

  const principal = "btn-azul w-full justify-center";

  let boton: ReactNode = null;
  switch (accion.tipo) {
    case "responder":
    case "retomar":
      boton = (
        <button
          type="button"
          className={principal}
          onClick={() => window.dispatchEvent(new Event("respondo:enfocar-compositor"))}
        >
          {accion.tipo === "retomar" ? "Escribirle ahora" : accion.label}
        </button>
      );
      break;
    case "devolver_a_tino":
      boton = (
        <button
          type="button"
          className={principal}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("respondo:cambiar-modo", { detail: { chatId: d.chatId, modo: "bot" } }))
          }
        >
          {/* El modo es por empleado: se devuelve al que atiende ESTE chat. */}
          {`Devolver a ${d.empleadoNombre || d.nombreTino}`}
        </button>
      );
      break;
    case "pedir_pago":
      boton = (
        <button type="button" className={principal} onClick={() => window.dispatchEvent(new Event("respondo:abrir-cobro"))}>
          {accion.label}
        </button>
      );
      break;
    case "revisar_propuesta":
      boton = (
        <Link href="/seguimientos" className={principal}>
          {accion.label}
        </Link>
      );
      break;
    case "ver_cita":
      boton = (
        <Link href="/agenda" className={principal}>
          {accion.label}
        </Link>
      );
      break;
    case "confirmar_pago":
      boton = accion.pagoId ? (
        <button
          type="button"
          className={principal}
          disabled={pendiente}
          onClick={() =>
            startTransition(async () => {
              const fd = new FormData();
              fd.set("pagoId", accion.pagoId as string);
              fd.set("desde", "pendiente");
              fd.set("hacia", "pagado");
              tras(await marcarPago(fd));
            })
          }
        >
          {pendiente ? "Confirmando…" : `Confirmar pago${estado.pago.tipo === "informado" && estado.pago.monto ? ` de $${estado.pago.monto.toLocaleString("es-CL")}` : ""}`}
        </button>
      ) : !formPago ? (
        <button type="button" className={principal} onClick={() => setFormPago(true)}>
          Confirmar pago recibido
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const fd = new FormData();
              fd.set("empleadoId", empleadoId);
              fd.set("chatId", d.chatId);
              fd.set("monto", monto);
              fd.set("concepto", concepto);
              tras(await confirmarPagoRecibido(fd));
            });
          }}
        >
          <p style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>
            Registra lo que llegó a la cuenta. No se le envía nada al cliente.
          </p>
          <label className="block">
            <span className="rotulo">Monto recibido (CLP)</span>
            <input
              className="campo mt-1"
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="45.000"
              required
            />
          </label>
          <label className="block">
            <span className="rotulo">Detalle (opcional)</span>
            <input
              className="campo mt-1"
              value={concepto}
              maxLength={120}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Abono 50% tarjetas"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-azul flex-1 justify-center" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Confirmar"}
            </button>
            <button type="button" className="btn-suave" onClick={() => setFormPago(false)}>
              Cancelar
            </button>
          </div>
        </form>
      );
      break;
  }

  const hayDerivacion = estado.atencion.items.some((i) =>
    ["cliente_molesto", "pidio_persona", "tema_delicado", "problema_tecnico", "asistente_no_pudo"].includes(i.motivo),
  );
  const puedeDevolver = d.modo !== "bot" && accion.tipo !== "devolver_a_tino";

  return (
    <div className="space-y-2">
      {boton}
      {(hayDerivacion || puedeDevolver) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {hayDerivacion && (
            <button
              type="button"
              className="btn-texto px-0"
              style={{ fontSize: "var(--t-menor)" }}
              disabled={pendiente}
              title="Cierra la derivación sin escribirle al cliente"
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("chatId", d.chatId);
                  tras(await marcarAtendida(fd));
                })
              }
            >
              Ya lo atendí
            </button>
          )}
          {puedeDevolver && (
            <button
              type="button"
              className="btn-texto px-0"
              style={{ fontSize: "var(--t-menor)" }}
              onClick={() =>
                window.dispatchEvent(new CustomEvent("respondo:cambiar-modo", { detail: { chatId: d.chatId, modo: "bot" } }))
              }
            >
              Devolver a {d.empleadoNombre || d.nombreTino}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export default function FichaLateral({
  d,
  empleadoId,
  extras,
}: {
  d: DetalleConversacion;
  empleadoId: string;
  /** Bloques existentes que siguen abajo (cobros, pedido, etiquetas, nota). */
  extras: ReactNode;
}) {
  const e = d.estado;
  const meta = metaEmpleado(d.empleadoRol);

  // Un detalle guardado en caché antes del deploy no trae estado: se muestra
  // lo de siempre y el refresco en segundo plano lo completa.
  if (!e) {
    return (
      <div className="tarjeta overflow-hidden">
        <Seccion titulo="Estado comercial">
          <dl>
            <Fila etiqueta="Etapa">
              <EtapaEstado etapa={d.etapa} />
            </Fila>
          </dl>
        </Seccion>
        {extras}
      </div>
    );
  }

  const quien =
    d.modo === "humano"
      ? "Tu equipo tiene el control"
      : d.modo === "pausado"
        ? "Pausado: nadie responde"
        : `Atiende ${d.empleadoNombre || meta.nombrePorDefecto}`;
  const beto = e.beto ? textoBeto(e.beto, d.nombreBeto) : null;
  const perdidaAntes = e.perdidaAnterior ? etiquetaMotivoEtapa("perdido", e.perdidaAnterior.motivo) : null;

  return (
    <div className="tarjeta lista-filas overflow-hidden">
      {/* ── Siguiente acción: arriba, porque es para lo que se abre la ficha ── */}
      <Seccion
        titulo="Siguiente acción"
        derecha={
          e.atencion.grupo ? (
            <Estado tono={metaGrupo(e.atencion.grupo).tono} punto>
              {metaGrupo(e.atencion.grupo).label}
            </Estado>
          ) : null
        }
      >
        {e.atencion.principal && (
          <p className="mb-2" style={{ fontSize: "var(--t-cuerpo)" }}>
            {e.atencion.principal.label}
            {e.atencion.principal.desde && (
              <span className="cifra" style={{ color: "var(--muted-2)", fontSize: "var(--t-meta)" }} suppressHydrationWarning>
                {" · hace "}
                {haceCuanto(e.atencion.principal.desde)}
              </span>
            )}
          </p>
        )}
        {e.accion ? (
          <AccionPrincipal accion={e.accion} d={d} empleadoId={empleadoId} estado={e} />
        ) : (
          <p style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>Nada pendiente con este cliente.</p>
        )}
        {e.atencion.items.length > 1 && (
          <ul className="mt-3 space-y-1">
            {e.atencion.items.slice(1).map((i) => (
              <li key={i.motivo} className="flex items-center gap-2" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONOS[metaGrupo(i.antiguo ? "antiguo" : i.prioridad).tono].texto }} />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* ── Estado comercial ── */}
      <Seccion titulo="Estado comercial">
        <dl>
          <Fila etiqueta="Etapa">
            <span className="flex flex-wrap items-center gap-1.5">
              <EtapaEstado etapa={e.etapa} motivo={e.motivoEtapa} />
              {e.etapaManual && (
                <span style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>fijada a mano</span>
              )}
            </span>
            {perdidaAntes && e.perdidaAnterior && (
              <span className="mt-1 block" style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>
                Antes estaba perdido: {perdidaAntes.toLowerCase()}
              </span>
            )}
          </Fila>
          <Fila etiqueta="Pago">
            <PagoEstado pago={e.pago} conDetalle />
          </Fila>
          {beto && (
            <Fila etiqueta="Seguimiento">
              <Estado tono={beto.tono}>{beto.label}</Estado>
              {beto.detalle && (
                <span className="mt-1 block" style={{ fontSize: "var(--t-meta)", color: "var(--muted)" }}>
                  {beto.detalle}
                </span>
              )}
            </Fila>
          )}
          {e.proximaCita && (
            <Fila etiqueta="Próxima cita">
              <span className="cifra" suppressHydrationWarning>
                {fechaHora(e.proximaCita.inicio)}
              </span>
            </Fila>
          )}
        </dl>
      </Seccion>

      {/* ── Atención ── */}
      <Seccion titulo="Atención">
        <p style={{ fontSize: "var(--t-cuerpo)" }}>{quien}</p>
        {d.escalacion && !d.escalacion.atendida && d.escalacion.resumen && (
          <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            {d.escalacion.resumen}
          </p>
        )}
      </Seccion>

      {/* ── Cliente ── */}
      <Seccion titulo="Cliente">
        <dl>
          <Fila etiqueta={e.canal === "instagram" ? "Instagram" : "WhatsApp"}>
            <span className="cifra">{e.canal === "instagram" ? "Mensaje directo" : d.telefono ?? `+${d.chatId}`}</span>
          </Fila>
          {e.origen && (
            <Fila etiqueta="Llegó por">
              Anuncio{e.origen.titulo ? `: «${e.origen.titulo}»` : ""}
            </Fila>
          )}
          {d.clienteDesde && (
            <Fila etiqueta="Desde">
              <span className="cifra" suppressHydrationWarning>
                {fechaHora(d.clienteDesde, false)}
              </span>
              <span style={{ color: "var(--muted)" }}> · {d.mensajesTotal} mensajes</span>
            </Fila>
          )}
          {(d.ventana === "abierta" || d.ventana === "cerrada") && (
            <Fila etiqueta="Ventana 24 h">
              <Estado tono={d.ventana === "abierta" ? "ok" : "neutro"}>{d.ventana === "abierta" ? "Abierta" : "Cerrada"}</Estado>
            </Fila>
          )}
        </dl>
      </Seccion>

      {/* ── Actividad ── */}
      {e.actividad.length > 0 && (
        <Seccion titulo="Qué pasó">
          <ol className="space-y-1.5">
            {e.actividad.map((a) => (
              <li key={a.clave} className="flex items-baseline gap-2" style={{ fontSize: "var(--t-menor)" }}>
                <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: TONOS[a.tono].texto }} aria-hidden />
                <span className="min-w-0 flex-1">{a.label}</span>
                <span className="cifra shrink-0" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }} suppressHydrationWarning>
                  {fechaHora(a.en)}
                </span>
              </li>
            ))}
          </ol>
        </Seccion>
      )}

      {extras}
    </div>
  );
}
