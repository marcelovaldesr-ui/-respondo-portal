"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Ico } from "@/components/marketing/Iconos";
import { disenarCampanaAccion, guardarPlanAccion } from "@/app/(marketing)/marketing/arquitecto/acciones";
import { ETIQUETA_DESTINO, planEnTexto, type Destino, type PlanCampana } from "@/lib/marketing/arquitectoCore";

/**
 * EL ARQUITECTO DE CAMPAÑAS, en pantalla.
 *
 * Una caja de texto y un presupuesto. Nada más, a propósito: todo lo demás
 * —quién es el negocio, qué vende, con qué palabras lo piden sus clientes, qué
 * campañas tuvo antes— ya lo sabemos y volver a preguntarlo sería hacerle
 * llenar un formulario a alguien que ya nos contó.
 *
 * Lo que devuelve NO es un texto: es un plan estructurado que se puede guardar,
 * editar en el asistente y convertir en creatividades. Por eso cada bloque de
 * abajo muestra exactamente lo que la plataforma va a pedir, en su orden.
 *
 * ⚠️ Sin componentes nuevos de diseño: usa las mismas clases `.mk-*` de la
 * Fase 3. Esta fase no rediseña nada.
 */

const EJEMPLOS = [
  "Quiero conseguir clientes que necesiten abogado laboral en Santiago. Presupuesto $300.000 mensuales.",
  "Quiero captar empresas que necesiten impresión corporativa en Chillán, $600.000 al mes.",
  "Quiero llenar las horas de la tarde con clientes nuevos de corte y color.",
];

export default function Arquitecto({
  destinos,
  monedaNegocio,
  hayCanales,
  demo,
}: {
  destinos: { destino: Destino; posible: boolean; motivo?: string }[];
  monedaNegocio: string;
  hayCanales: boolean;
  demo: boolean;
}) {
  const [objetivo, setObjetivo] = useState("");
  const [presupuesto, setPresupuesto] = useState("");
  const [destino, setDestino] = useState<Destino | "">("");
  const [plan, setPlan] = useState<PlanCampana | null>(null);
  const [problemas, setProblemas] = useState<{ campo: string; problema: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<{ id: string; planGuardado: boolean } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const disenar = () =>
    iniciar(async () => {
      setError(null);
      setGuardado(null);
      const limpio = presupuesto.replace(/[^\d]/g, "");
      const r = await disenarCampanaAccion({
        objetivo,
        presupuestoMensual: limpio ? Number(limpio) : null,
        destino: destino || null,
      });
      if (!r.ok) {
        setError(r.motivo);
        setPlan(null);
        return;
      }
      setPlan(r.plan);
      setProblemas(r.problemas);
    });

  const guardar = () =>
    iniciar(async () => {
      if (!plan) return;
      const r = await guardarPlanAccion(plan);
      if (!r.ok) {
        setError(r.motivo);
        return;
      }
      setGuardado({ id: r.id, planGuardado: r.planGuardado });
    });

  const copiar = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(planEnTexto(plan));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="mt-6">
      {/* ── El pedido ──────────────────────────────────────────────────── */}
      <section className="mk-tarjeta p-4">
        <label className="mk-etiqueta" htmlFor="objetivo">
          ¿Qué quieres conseguir?
        </label>
        <textarea
          id="objetivo"
          className="mk-campo mt-1.5 w-full"
          rows={3}
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          placeholder="Escríbelo como se lo contarías a alguien: a quién quieres llegar, para qué servicio y con cuánto."
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EJEMPLOS.map((e) => (
            <button key={e} type="button" className="mk-chip" onClick={() => setObjetivo(e)}>
              {e.length > 58 ? `${e.slice(0, 56)}…` : e}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mk-etiqueta" htmlFor="presupuesto">
              Presupuesto mensual ({monedaNegocio})
            </label>
            <input
              id="presupuesto"
              inputMode="numeric"
              className="mk-campo mt-1.5 w-full"
              value={presupuesto}
              onChange={(e) => setPresupuesto(e.target.value)}
              placeholder="300000"
            />
          </div>
          <div>
            <label className="mk-etiqueta" htmlFor="destino">
              ¿A dónde llega la persona?
            </label>
            <select
              id="destino"
              className="mk-campo mt-1.5 w-full"
              value={destino}
              onChange={(e) => setDestino(e.target.value as Destino | "")}
            >
              <option value="">Que lo decida el plan</option>
              {destinos
                .filter((d) => d.posible)
                .map((d) => (
                  <option key={d.destino} value={d.destino}>
                    {ETIQUETA_DESTINO[d.destino]}
                  </option>
                ))}
            </select>
            {destinos
              .filter((d) => !d.posible && d.motivo)
              .map((d) => (
                <p key={d.destino} className="mk-meta mt-1">
                  {ETIQUETA_DESTINO[d.destino]}: {d.motivo}
                </p>
              ))}
          </div>
        </div>

        {!hayCanales && (
          <p className="mk-aviso mt-3">
            Todavía no hay ninguna cuenta publicitaria conectada. El plan se arma igual y se puede llevar a la
            plataforma; lo que no vamos a poder mostrarte acá es su gasto ni su rendimiento.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primario mk-btn-lg" disabled={pendiente || objetivo.trim().length < 12} onClick={disenar}>
            {Ico.copiloto({ className: "h-4 w-4" })} {pendiente ? "Pensando la campaña…" : "Diseñar campaña"}
          </button>
          {plan && (
            <span className="mk-meta">
              Se puede editar todo antes de llevarlo a la plataforma.
            </span>
          )}
        </div>

        {error && <p className="mk-error mt-3">{error}</p>}
      </section>

      {plan && (
        <>
          {/* ── Estrategia de canal ──────────────────────────────────────── */}
          <section className="mt-6">
            <h2 className="mk-h2">Por dónde conviene empezar</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {plan.estrategiaCanal.map((e) => (
                <div key={e.canal} className="mk-tarjeta p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{e.canal === "google" ? "Google Ads" : "Meta"}</span>
                    <span className="mk-meta">{Math.round(e.parte * 100)}% del presupuesto</span>
                  </div>
                  <p className="mt-1.5" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
                    {e.porQue}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Las campañas ─────────────────────────────────────────────── */}
          <section className="mt-6">
            <h2 className="mk-h2">La campaña, como la va a pedir la plataforma</h2>
            {plan.campanas.map((c, i) => (
              <div key={i} className="mk-tarjeta mt-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{c.nombre}</span>
                  <span className="mk-pildora">{c.canal === "google" ? "Google Ads" : "Meta"}</span>
                </div>
                <p className="mk-meta mt-1">
                  Objetivo: {c.objetivo} · Presupuesto diario:{" "}
                  {c.presupuestoDiario ? `${c.presupuestoDiario.toLocaleString("es-CL")} ${plan.moneda}` : "a definir"} ·
                  Destino: {ETIQUETA_DESTINO[c.destino]}
                  {c.destinoDetalle ? ` (${c.destinoDetalle})` : ""}
                </p>

                {c.conjuntos.map((cj, j) => (
                  <div key={j} className="mt-3 rounded-md p-3" style={{ background: "var(--fondo-2)" }}>
                    <div className="font-medium" style={{ fontSize: "13px" }}>
                      Conjunto: {cj.nombre}
                    </div>
                    <div className="mk-meta mt-1">
                      {cj.ubicacion || "Ubicación a definir"} · {cj.edadDesde ?? 18}-{cj.edadHasta ?? 65} años
                      {cj.intereses.length ? ` · ${cj.intereses.join(", ")}` : ""}
                    </div>
                    {cj.nota && <p className="mk-meta mt-1">{cj.nota}</p>}
                  </div>
                ))}

                {c.grupos.map((g, j) => (
                  <div key={j} className="mt-3 rounded-md p-3" style={{ background: "var(--fondo-2)" }}>
                    <div className="font-medium" style={{ fontSize: "13px" }}>
                      Grupo: {g.nombre}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {g.palabras.map((p) => (
                        <span key={p.texto} className="mk-chip" title={`Concordancia ${p.concordancia}`}>
                          {p.texto} <span style={{ opacity: 0.6 }}>[{p.concordancia}]</span>
                        </span>
                      ))}
                    </div>
                    {g.negativasSugeridas.length > 0 && (
                      <p className="mk-meta mt-2">
                        Negativas candidatas: {g.negativasSugeridas.join(" · ")} — ninguna choca con las palabras de
                        arriba (verificado).
                      </p>
                    )}
                    <p className="mk-meta mt-2">Titulares: {g.titulares.join(" | ")}</p>
                    <p className="mk-meta">Descripciones: {g.descripciones.join(" | ")}</p>
                  </div>
                ))}
              </div>
            ))}
          </section>

          {/* ── Ángulos ─────────────────────────────────────────────────── */}
          <section className="mt-6">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="mk-h2">Tres formas distintas de decirlo</h2>
              <span className="mk-meta">No tres versiones del mismo anuncio</span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {plan.angulos.map((a, i) => (
                <div key={i} className="mk-tarjeta p-3.5">
                  <span className="mk-pildora">{a.tipo}</span>
                  <div className="mt-2 font-semibold" style={{ fontSize: "14px" }}>
                    {a.titular}
                  </div>
                  <p className="mt-1.5" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
                    {a.texto}
                  </p>
                  <p className="mk-meta mt-2">Botón: {a.cta}</p>
                  <p className="mk-meta mt-1">Imagen: {a.direccionVisual}</p>
                  {guardado && (
                    <Link
                      href={`/marketing/creatividades/nueva?campana=${encodeURIComponent(guardado.id)}&angulo=${i}`}
                      className="mk-enlace mt-2 inline-block"
                    >
                      Generar esta creatividad →
                    </Link>
                  )}
                </div>
              ))}
            </div>
            {!guardado && (
              <p className="mk-meta mt-2">
                Guarda el plan para llevar estos ángulos al estudio creativo con su brief ya cargado.
              </p>
            )}
          </section>

          {/* ── Medición e hipótesis ────────────────────────────────────── */}
          <section className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="mk-tarjeta p-4">
              <h3 className="font-semibold">Qué vamos a poder medir</h3>
              <ul className="mt-2 space-y-1" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
                {plan.tracking.loQueSeMide.map((t) => (
                  <li key={t}>· {t}</li>
                ))}
              </ul>
              {plan.tracking.loQueNoSeMide.length > 0 && (
                <>
                  <h3 className="mt-3 font-semibold">Y qué no</h3>
                  <ul className="mt-1 space-y-1" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
                    {plan.tracking.loQueNoSeMide.map((t) => (
                      <li key={t}>· {t}</li>
                    ))}
                  </ul>
                </>
              )}
              {plan.tracking.utm && (
                <p className="mk-meta mt-3" style={{ wordBreak: "break-all" }}>
                  UTM para el enlace: utm_source={plan.tracking.utm.source}&amp;utm_medium={plan.tracking.utm.medium}
                  &amp;utm_campaign={plan.tracking.utm.campaign}&amp;utm_content={plan.tracking.utm.content}
                </p>
              )}
            </div>

            <div className="mk-tarjeta p-4">
              <h3 className="font-semibold">Qué estamos probando</h3>
              <p className="mt-2" style={{ fontSize: "13px" }}>
                {plan.hipotesis.enunciado}
              </p>
              <p className="mk-meta mt-2">Señal principal: {plan.hipotesis.senalPrincipal}</p>
              {plan.hipotesis.senalesSecundarias.length > 0 && (
                <p className="mk-meta">Secundarias: {plan.hipotesis.senalesSecundarias.join(" · ")}</p>
              )}
              {plan.hipotesis.senalRespondo && (
                <p className="mk-meta">Y con lo que solo ve Respondo: {plan.hipotesis.senalRespondo}</p>
              )}
            </div>
          </section>

          {(plan.advertencias.length > 0 || problemas.length > 0) && (
            <section className="mt-6 mk-tarjeta p-4">
              <h3 className="font-semibold">Antes de lanzarla</h3>
              <ul className="mt-2 space-y-1" style={{ fontSize: "13px", color: "var(--muted-2)" }}>
                {plan.advertencias.map((a) => (
                  <li key={a}>· {a}</li>
                ))}
                {problemas.map((p) => (
                  <li key={`${p.campo}${p.problema}`}>
                    · <strong>{p.campo}:</strong> {p.problema}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Acciones ────────────────────────────────────────────────── */}
          <section className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primario mk-btn-lg" disabled={pendiente || demo} onClick={guardar}>
              {Ico.nueva({ className: "h-4 w-4" })} Guardar como borrador
            </button>
            <button type="button" className="btn-secundario" onClick={copiar}>
              {copiado ? "Copiado" : "Copiar el plan completo"}
            </button>
            {guardado && (
              <Link href={`/marketing/campanas/nueva?id=${encodeURIComponent(guardado.id)}`} className="mk-enlace">
                Abrirlo en el asistente →
              </Link>
            )}
            {demo && <span className="mk-meta">En demostración no se guarda.</span>}
          </section>

          {guardado && !guardado.planGuardado && (
            <p className="mk-aviso mt-3">
              El borrador quedó guardado, pero el detalle del plan no: esta instalación todavía no tiene la última
              migración aplicada. El texto completo está en las notas del borrador.
            </p>
          )}
        </>
      )}
    </div>
  );
}
