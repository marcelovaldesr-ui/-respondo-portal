"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { preguntarAccion } from "@/app/(marketing)/marketing/copiloto/acciones";
import { guardarBorradorAccion } from "@/app/(marketing)/marketing/campanas/acciones";
import { PREGUNTAS_SUGERIDAS, type RespuestaCopiloto } from "@/lib/marketing/copilotoCore";
import { Ico } from "@/components/marketing/Iconos";

/**
 * EL COPILOTO — una conversación con evidencia.
 *
 * Cada respuesta muestra tres cosas separadas: lo que el copiloto concluye,
 * las cifras exactas en que se apoya (con enlace a la pantalla donde
 * verificarlas) y qué haría. Cuando la persona pide una campaña, la
 * respuesta trae un borrador que se guarda con un botón y se abre en el
 * asistente para terminarlo.
 *
 * `preguntaInicial` viene de la URL (?q=) cuando alguien llega desde el
 * inicio o desde una campaña.
 */
type Turno = { pregunta: string; respuesta: RespuestaCopiloto | null; error?: string; guardadoId?: string };

export default function ChatCopiloto({ periodo, preguntaInicial, demo, herramientas }: { periodo: string; preguntaInicial?: string; demo: boolean; herramientas: { nombre: string; descripcion: string }[] }) {
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
    setTurnos((t) => [...t, { pregunta, respuesta: null }]);
    const hilo = turnos.filter((t) => t.respuesta).map((t) => ({ pregunta: t.pregunta, respuesta: t.respuesta!.respuesta }));
    iniciar(async () => {
      const r = await preguntarAccion({ pregunta, periodo, hilo });
      setPendiente(false);
      setTurnos((t) => {
        const copia = [...t];
        const ultimo = copia[copia.length - 1];
        copia[copia.length - 1] = r.ok ? { ...ultimo, respuesta: r.datos } : { ...ultimo, error: r.motivo };
        return copia;
      });
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
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div className="tarjeta flex flex-col" style={{ minHeight: 520 }}>
          <div className="flex-1 space-y-4 p-4">
            {turnos.length === 0 && (
              <div className="py-6 text-center">
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-md" style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}>
                  {Ico.copiloto()}
                </span>
                <div className="mt-3 font-semibold" style={{ fontSize: "var(--t-fila)" }}>Pregúntame por tus campañas</div>
                <p className="mx-auto mt-1 max-w-md" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                  Respondo con las cifras del período que estás mirando y te digo en qué me baso. Si el dato no alcanza, lo digo.
                </p>
                <div className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-1.5">
                  {PREGUNTAS_SUGERIDAS.map((q) => (
                    <button key={q} type="button" className="btn-chico" onClick={() => preguntar(q)}>{q}</button>
                  ))}
                </div>
              </div>
            )}
            {turnos.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-end">
                  <div className="mk-burbuja persona">{t.pregunta}</div>
                </div>
                {t.respuesta ? (
                  <Respuesta r={t.respuesta} guardar={() => guardarBorrador(i)} guardando={guardando === i} guardadoId={t.guardadoId} demo={demo} error={t.error} />
                ) : t.error ? (
                  <div className="mk-burbuja copiloto" style={{ borderLeft: "3px solid var(--peligro)" }}>{t.error}</div>
                ) : (
                  <div className="mk-burbuja copiloto" style={{ color: "var(--muted)" }}>
                    Leyendo el período, corriendo las herramientas y pensando la respuesta…
                  </div>
                )}
              </div>
            ))}
            <div ref={fin} />
          </div>
          <form
            className="flex items-end gap-2 border-t p-3"
            style={{ borderColor: "var(--borde)" }}
            onSubmit={(e) => {
              e.preventDefault();
              preguntar(texto);
            }}
          >
            <textarea
              className="campo flex-1"
              rows={2}
              placeholder="Ej: ¿qué campaña me conviene apagar?"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  preguntar(texto);
                }
              }}
            />
            <button type="submit" className="btn-primario" disabled={pendiente || !texto.trim()}>
              {pendiente ? "Pensando…" : "Preguntar"}
            </button>
          </form>
        </div>
      </div>

      <aside className="lg:col-span-4">
        <div className="tarjeta p-4">
          <div className="eyebrow">Cómo trabaja</div>
          <p className="mt-1 leading-relaxed" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
            Las cifras las calcula Respondo, de forma determinista, con las mismas funciones que alimentan las pantallas. El copiloto solo las interpreta: no inventa ni estima números.
          </p>
          <div className="eyebrow mt-4">Herramientas</div>
          <ul className="mt-1.5 space-y-1.5">
            {herramientas.map((h) => (
              <li key={h.nombre} style={{ fontSize: "var(--t-micro)" }}>
                <code className="rounded px-1" style={{ background: "var(--fondo-hundido)", fontSize: 11 }}>{h.nombre}</code>
                <span style={{ color: "var(--muted-2)" }}> · {h.descripcion}</span>
              </li>
            ))}
          </ul>
        </div>
        {turnos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PREGUNTAS_SUGERIDAS.slice(0, 4).map((q) => (
              <button key={q} type="button" className="btn-chico" onClick={() => preguntar(q)} disabled={pendiente}>{q}</button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function Respuesta({ r, guardar, guardando, guardadoId, demo, error }: { r: RespuestaCopiloto; guardar: () => void; guardando: boolean; guardadoId?: string; demo: boolean; error?: string }) {
  return (
    <div className="mk-burbuja copiloto" style={{ maxWidth: "100%", whiteSpace: "normal" }}>
      <div style={{ whiteSpace: "pre-wrap" }}>{r.respuesta}</div>
      {r.sinDatos && <span className="pildora-alerta mt-2">Con este volumen no se puede concluir</span>}
      {r.evidencia.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--borde)" }}>
          <div className="eyebrow">En qué me baso</div>
          <ul className="mt-1 space-y-1">
            {r.evidencia.map((e, i) => (
              <li key={i} className="flex gap-2" style={{ fontSize: "var(--t-menor)" }}>
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--indigo)" }} />
                <span>
                  {e.texto}
                  {e.href && (
                    <>
                      {" "}
                      <Link href={e.href} className="font-semibold" style={{ color: "var(--indigo)" }}>Ver →</Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.borrador && (
        <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--indigo-borde)", background: "var(--indigo-suave)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>Borrador: {r.borrador.nombre}</div>
            <span className="pildora-indigo">Propuesta</span>
          </div>
          <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>
            <div><strong>Oferta:</strong> {r.borrador.oferta}</div>
            <div><strong>Presupuesto:</strong> {r.borrador.presupuestoDiario ? `$${r.borrador.presupuestoDiario.toLocaleString("es-CL")} diarios` : "a definir"}</div>
            <div><strong>Audiencia:</strong> {r.borrador.audiencia.ubicacion}{r.borrador.audiencia.edadDesde ? `, ${r.borrador.audiencia.edadDesde}–${r.borrador.audiencia.edadHasta ?? 65}` : ""}</div>
            <div><strong>Copies:</strong> {r.borrador.copies.length}</div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {guardadoId ? (
              <Link href={`/marketing/campanas/nueva?id=${encodeURIComponent(guardadoId)}`} className="btn-primario">Abrir en el asistente</Link>
            ) : (
              <button type="button" className="btn-primario" disabled={guardando} onClick={guardar} title={demo ? "En demostración no se guarda" : undefined}>
                {guardando ? "Guardando…" : "Guardar como borrador"}
              </button>
            )}
            {error && <span style={{ fontSize: "var(--t-micro)", color: "var(--peligro)" }}>{error}</span>}
          </div>
        </div>
      )}
      {r.acciones.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.acciones.map((a, i) => (
            <Link key={i} href={a.href} className="btn-chico">{a.texto} →</Link>
          ))}
        </div>
      )}
      {r.herramientasUsadas.length > 0 && (
        <div className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>
          Herramientas: {r.herramientasUsadas.join(", ")}
        </div>
      )}
    </div>
  );
}
