"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { preguntarAccion } from "@/app/(marketing)/marketing/copiloto/acciones";
import { guardarBorradorAccion } from "@/app/(marketing)/marketing/campanas/acciones";
import type { RespuestaCopiloto } from "@/lib/marketing/copilotoCore";
import { Ico } from "@/components/marketing/Iconos";

/**
 * EL COPILOTO — un espacio de trabajo con IA, no un chat pegado al costado.
 *
 * La división del trabajo es la que da la confianza: las cifras las calcula
 * Respondo de forma determinista, con las mismas funciones que alimentan las
 * pantallas; el modelo solo las INTERPRETA. Por eso cada respuesta muestra,
 * separadas, tres cosas: la conclusión, la evidencia exacta en que se apoya
 * (con enlace para ir a comprobarla) y qué haría.
 *
 * Cuando la persona pide una campaña, la respuesta trae un borrador completo
 * que se guarda con un botón y se abre en el asistente para terminarlo. Es la
 * única acción que el copiloto puede ejecutar, y aun así queda en borrador.
 *
 * La columna derecha no explica cómo funciona el producto: dice qué se está
 * analizando. La explicación técnica vive en un desplegable al pie.
 */
/**
 * Los arranques por defecto. Se usan solo cuando la página no manda los suyos:
 * desde la Fase 6 las sugerencias dependen de las SEÑALES del negocio, porque
 * sugerir «¿qué campaña trae mejores clientes?» a quien no trae conversaciones
 * es invitarlo a la única pregunta que no vamos a poder responder.
 */
const PROMPTS: { texto: string; icono: keyof typeof Ico }[] = [
  { texto: "Analiza los últimos 30 días", icono: "grafico" },
  { texto: "¿Dónde estoy perdiendo plata?", icono: "alerta" },
  { texto: "¿Qué campaña me está trayendo mejores clientes?", icono: "campanas" },
  { texto: "¿Qué creatividad debería repetir?", icono: "creatividades" },
  { texto: "Créame una campaña para vender más este mes", icono: "nueva" },
];

/** Un ícono razonable para una sugerencia que viene del servidor. */
function iconoDe(texto: string): keyof typeof Ico {
  const t = texto.toLowerCase();
  if (/plata|presupuesto|perdiendo/.test(t)) return "alerta";
  if (/campa/.test(t)) return "campanas";
  if (/creativ|anuncio/.test(t)) return "creatividades";
  if (/dise|cre[aá]/.test(t)) return "nueva";
  if (/busca|t[eé]rmino|palabra/.test(t)) return "copiloto";
  return "grafico";
}

type Turno = { pregunta: string; respuesta: RespuestaCopiloto | null; error?: string; guardadoId?: string };

export default function ChatCopiloto({
  periodo,
  preguntaInicial,
  demo,
  herramientas,
  contexto,
  sugerencias,
}: {
  periodo: string;
  preguntaInicial?: string;
  demo: boolean;
  herramientas: { nombre: string; etiqueta: string; descripcion: string }[];
  /** Qué se está analizando: se muestra en vez de la documentación interna. */
  contexto: { etiqueta: string; valor: string }[];
  /** Arranques según las señales del negocio. Sin esto, los de siempre. */
  sugerencias?: string[];
}) {
  const prompts = sugerencias?.length
    ? sugerencias.map((texto) => ({ texto, icono: iconoDe(texto) }))
    : PROMPTS;
  const router = useRouter();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [pendiente, setPendiente] = useState(false);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [, iniciar] = useTransition();
  const fin = useRef<HTMLDivElement>(null);
  const lanzada = useRef(false);

  const preguntar = (q: string) => {
    const pregunta = q.trim();
    if (!pregunta || pendiente) return;
    setTexto("");
    setPendiente(true);
    /**
     * ⚠️ La respuesta se escribe en SU turno por índice, no en «el último».
     * Con dos preguntas encadenadas, escribir en el último dejaba la primera
     * girando para siempre y pisaba la segunda con la respuesta equivocada.
     */
    const indice = turnos.length;
    setTurnos((t) => [...t, { pregunta, respuesta: null }]);
    const hilo = turnos.filter((t) => t.respuesta).map((t) => ({ pregunta: t.pregunta, respuesta: t.respuesta!.respuesta }));
    iniciar(async () => {
      const r = await preguntarAccion({ pregunta, periodo, hilo });
      setPendiente(false);
      setTurnos((t) => t.map((x, i) => (i === indice ? (r.ok ? { ...x, respuesta: r.datos } : { ...x, error: r.motivo }) : x)));
    });
  };

  useEffect(() => {
    if (preguntaInicial && !lanzada.current) {
      lanzada.current = true;
      preguntar(preguntaInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preguntaInicial]);

  useEffect(() => {
    if (turnos.length) fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, pendiente]);

  const guardarBorrador = (i: number) => {
    const b = turnos[i]?.respuesta?.borrador;
    if (!b) return;
    setGuardando(i);
    iniciar(async () => {
      const r = await guardarBorradorAccion({
        nombre: b.nombre,
        objetivo: b.objetivo,
        oferta: b.oferta,
        audiencia: b.audiencia,
        presupuestoDiario: b.presupuestoDiario,
        presupuestoTotal: null,
        moneda: "CLP",
        destino: "whatsapp",
        creatividadIds: [],
        copies: b.copies,
        notas: `Propuesta del copiloto. Imagen sugerida: ${b.creatividad.imagenPrompt}`,
      });
      setGuardando(null);
      if (!r.ok) {
        setTurnos((t) => t.map((x, j) => (j === i ? { ...x, error: r.motivo } : x)));
        return;
      }
      setTurnos((t) => t.map((x, j) => (j === i ? { ...x, guardadoId: r.id } : x)));
      router.push(`/marketing/campanas/nueva?id=${encodeURIComponent(r.id)}`);
    });
  };

  const vacio = turnos.length === 0;

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <div className={vacio ? "xl:col-span-12" : "xl:col-span-8"}>
        {vacio ? (
          <div className="mk-panel">
            <div className="mk-copiloto-hero" style={{ paddingTop: 56 }}>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl" style={{ background: "var(--indigo)", color: "#fff" }}>
                {Ico.copiloto({ className: "h-6 w-6" })}
              </span>
              <h2 className="mt-4">¿Qué quieres mejorar hoy?</h2>
              <p className="mx-auto mt-2 max-w-lg" style={{ fontSize: "14px", color: "var(--muted)", lineHeight: 1.55 }}>
                Leo las cifras del período que estás mirando y te digo en qué me baso. Si el dato no alcanza para concluir, lo digo.
              </p>
            </div>
            <div className="px-6 pb-6">
              <Entrada texto={texto} setTexto={setTexto} preguntar={preguntar} pendiente={pendiente} grande />
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {prompts.map((p) => (
                  <button key={p.texto} type="button" className="mk-prompt" onClick={() => preguntar(p.texto)}>
                    {Ico[p.icono]({ className: "h-4 w-4" })}
                    {p.texto}
                  </button>
                ))}
              </div>
            </div>
            {/* El contexto va TAMBIÉN en el vacío: antes de la primera pregunta,
                lo que da confianza es ver que el copiloto ya leyó el período. */}
            <div className="border-t px-6 py-5" style={{ borderColor: "var(--borde)", background: "var(--mk-superficie-2)" }}>
              <div className="mk-hallazgo-tipo mb-3">Ya leí esto</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
                {contexto.map((c) => {
                  // «Últimos 30 días» no es una cifra: en la tipografía tabular
                  // y a 17 px se corta. Las palabras van en su propio tamaño.
                  const esCifra = /^[—$\d]/.test(c.valor);
                  return (
                  <div key={c.etiqueta} className="min-w-0">
                    <dd
                      className={esCifra ? "cifra truncate" : "truncate"}
                      style={{ fontSize: esCifra ? "17px" : "13.5px", fontWeight: 600, letterSpacing: esCifra ? "-0.02em" : undefined, lineHeight: esCifra ? undefined : "22px" }}
                      title={c.valor}
                    >
                      {c.valor}
                    </dd>
                    <dt className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
                      {c.etiqueta}
                    </dt>
                  </div>
                  );
                })}
              </dl>
            </div>
            <div className="mk-panel-pie">
              Las cifras las calcula Respondo, las mismas que ves en el resto de Marketing. El copiloto solo las interpreta: no inventa
              ni estima números.
            </div>
          </div>
        ) : (
          <div className="mk-panel">
            <div className="flex flex-col gap-7 p-6">
              {turnos.map((t, i) => (
                <div key={i} className="flex flex-col gap-5">
                  <div className="mk-turno persona">
                    <span className="mk-turno-avatar" aria-hidden="true">
                      Tú
                    </span>
                    <div className="mk-turno-cuerpo">{t.pregunta}</div>
                  </div>
                  <div className="mk-turno copiloto">
                    <span className="mk-turno-avatar" aria-hidden="true">
                      {Ico.copiloto({ className: "h-4 w-4" })}
                    </span>
                    <div className="mk-turno-cuerpo">
                      {t.respuesta ? (
                        <Respuesta
                          r={t.respuesta}
                          guardar={() => guardarBorrador(i)}
                          guardando={guardando === i}
                          guardadoId={t.guardadoId}
                          demo={demo}
                          error={t.error}
                          herramientas={herramientas}
                        />
                      ) : t.error ? (
                        <span style={{ color: "var(--peligro)" }}>{t.error}</span>
                      ) : (
                        <span className="mk-pensando">
                          <i />
                          <i />
                          <i />
                          Leyendo tus cifras del período…
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={fin} />
            </div>
            <div className="sticky bottom-0 border-t p-4" style={{ borderColor: "var(--borde)", background: "var(--superficie)", borderRadius: "0 0 var(--mk-r) var(--mk-r)" }}>
              <Entrada texto={texto} setTexto={setTexto} preguntar={preguntar} pendiente={pendiente} />
            </div>
          </div>
        )}
      </div>

      {!vacio && (
        <aside className="xl:col-span-4">
          <div className="xl:sticky xl:top-6">
            <div className="mk-panel">
              <div className="mk-panel-cabecera">
                <h2 className="mk-h2">Contexto analizado</h2>
              </div>
              <div className="mk-panel-cuerpo">
                <dl className="grid gap-3.5">
                  {contexto.map((c) => (
                    <div key={c.etiqueta} className="flex items-baseline justify-between gap-4">
                      <dt style={{ fontSize: "12.5px", color: "var(--muted)" }}>{c.etiqueta}</dt>
                      <dd className="cifra" style={{ fontSize: "14px", fontWeight: 600 }}>
                        {c.valor}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <details className="border-t" style={{ borderColor: "var(--borde)" }}>
                <summary className="cursor-pointer px-5 py-3" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}>
                  Cómo obtiene las cifras
                </summary>
                <ul className="space-y-2 px-5 pb-5">
                  {herramientas.map((h) => (
                    <li key={h.nombre} style={{ fontSize: "11.5px" }}>
                      <span style={{ fontWeight: 600 }}>{h.etiqueta}</span>
                      <span style={{ color: "var(--muted-2)" }}> · {h.descripcion}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            {/* Las sugerencias que quedan por preguntar. Sin las ya usadas: un
                atajo que repite lo que acabas de leer no es un atajo. */}
            {(() => {
              const hechas = new Set(turnos.map((t) => t.pregunta));
              const quedan = prompts.filter((p) => !hechas.has(p.texto)).slice(0, 3);
              if (!quedan.length) return null;
              return (
                <div className="mt-4">
                  <div className="mk-hallazgo-tipo mb-2.5">Seguir preguntando</div>
                  <div className="flex flex-col items-start gap-2">
                    {quedan.map((p) => (
                      <button key={p.texto} type="button" className="btn-chico text-left" onClick={() => preguntar(p.texto)} disabled={pendiente}>
                        {p.texto}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </aside>
      )}
    </div>
  );
}

function Entrada({
  texto,
  setTexto,
  preguntar,
  pendiente,
  grande,
}: {
  texto: string;
  setTexto: (v: string) => void;
  preguntar: (q: string) => void;
  pendiente: boolean;
  grande?: boolean;
}) {
  return (
    <form
      className={`mk-copiloto-entrada ${grande ? "mx-auto max-w-2xl" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        preguntar(texto);
      }}
    >
      <textarea
        rows={grande ? 2 : 1}
        placeholder="Pregunta por tus campañas, tus anuncios o tus leads…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            preguntar(texto);
          }
        }}
      />
      <button type="submit" className="btn-primario" disabled={pendiente || !texto.trim()} style={{ borderRadius: 10, padding: "9px 14px" }}>
        {pendiente ? "Pensando…" : Ico.enviar({ className: "h-4 w-4" })}
        <span className="sr-only">Preguntar</span>
      </button>
    </form>
  );
}

function Respuesta({
  r,
  guardar,
  guardando,
  guardadoId,
  demo,
  error,
  herramientas,
}: {
  r: RespuestaCopiloto;
  guardar: () => void;
  guardando: boolean;
  guardadoId?: string;
  demo: boolean;
  error?: string;
  herramientas: { nombre: string; etiqueta: string }[];
}) {
  return (
    <div>
      <div style={{ whiteSpace: "pre-wrap" }}>{r.respuesta}</div>
      {r.sinDatos && (
        <span className="mk-estado alerta mt-3">Con este volumen no se puede concluir</span>
      )}

      {r.evidencia.length > 0 && (
        <div className="mk-evidencia">
          <div className="mk-hallazgo-tipo">En qué me baso</div>
          {r.evidencia.map((e, i) => (
            <div key={i} className="mk-evidencia-item">
              <span className="min-w-0">
                {e.texto}
                {e.href && (
                  <>
                    {" "}
                    <Link href={e.href} className="mk-enlace" style={{ fontSize: "12.5px" }}>
                      Ver
                    </Link>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {r.borrador && (
        <div className="mk-tarjeta-campana mt-4">
          <div className="min-w-0">
            <div className="mk-hallazgo-tipo" style={{ color: "var(--indigo)" }}>
              Borrador propuesto
            </div>
            <div className="mt-1 font-semibold" style={{ fontSize: "15px", letterSpacing: "-0.015em" }}>
              {r.borrador.nombre}
            </div>
            <div className="mk-tarjeta-campana-datos">
              <DatoB etiqueta="Oferta" valor={r.borrador.oferta} />
              <DatoB
                etiqueta="Presupuesto"
                valor={r.borrador.presupuestoDiario ? `$${r.borrador.presupuestoDiario.toLocaleString("es-CL")} diarios` : "a definir"}
              />
              <DatoB
                etiqueta="Audiencia"
                valor={`${r.borrador.audiencia.ubicacion}${r.borrador.audiencia.edadDesde ? `, ${r.borrador.audiencia.edadDesde}–${r.borrador.audiencia.edadHasta ?? 65}` : ""}`}
              />
              <DatoB etiqueta="Copies" valor={`${r.borrador.copies.length} escritos`} />
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {guardadoId ? (
                <Link href={`/marketing/campanas/nueva?id=${encodeURIComponent(guardadoId)}`} className="btn-primario">
                  Abrir en el asistente
                </Link>
              ) : (
                <button type="button" className="btn-primario" disabled={guardando} onClick={guardar} data-tip={demo ? "En demostración no se guarda" : undefined}>
                  {guardando ? "Guardando…" : "Guardar como borrador"}
                </button>
              )}
              {error && <span style={{ fontSize: "11.5px", color: "var(--peligro)" }}>{error}</span>}
            </div>
          </div>
        </div>
      )}

      {r.acciones.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {r.acciones.map((a, i) => (
            <Link key={i} href={a.href} className="btn-chico">
              {a.texto} {Ico.flecha({ className: "h-3 w-3" })}
            </Link>
          ))}
        </div>
      )}

      {/* Qué miró, en palabras. El nombre interno de la herramienta se queda
          del lado del servidor: al dueño no le dice nada y publica el interior
          del producto. */}
      {r.herramientasUsadas.length > 0 && (
        <div className="mt-3" style={{ fontSize: "11px", color: "var(--muted-3)" }}>
          Miró: {r.herramientasUsadas.map((n) => etiquetaDe(n, herramientas)).join(" · ")}
        </div>
      )}
    </div>
  );
}

function DatoB({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <div className="mk-dato-mini-etiqueta">{etiqueta}</div>
      <div style={{ fontSize: "12.5px", color: "var(--tinta)", lineHeight: 1.4 }}>{valor}</div>
    </div>
  );
}

/** El nombre legible de una herramienta. Si no la reconoce, no muestra nada. */
function etiquetaDe(nombre: string, herramientas: { nombre: string; etiqueta: string }[]): string {
  return herramientas.find((h) => h.nombre === nombre)?.etiqueta ?? "tus cifras";
}
