"use client";

import { useState, useTransition } from "react";
import { corregirContextoAccion } from "@/app/(marketing)/marketing/creatividades/acciones";
import type { Completitud, ContextoComercial } from "@/lib/marketing/contextoComercialCore";

/**
 * LO QUE RESPONDO ENTIENDE DE TU NEGOCIO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTA CAJA EXISTE
 *
 * Un contexto equivocado produce un anuncio equivocado EN SILENCIO. Cuando el
 * Estudio creyó que «Cupos y qué cuenta como una conversación» era un producto,
 * no había forma de darse cuenta hasta leer el anuncio terminado y no entender
 * de dónde había salido. El error estaba cuatro pasos antes y era invisible.
 *
 * Esto lo hace visible en una línea y corregible en un minuto. No es una
 * pantalla técnica ni un formulario de veinticinco campos: es lo que el sistema
 * cree, dicho en las palabras del dueño, con un botón para arreglarlo.
 *
 * ⭐ Y lo que la persona corrige NO se vuelve a pisar: queda marcado como suyo
 * y la reconstrucción automática lo respeta.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export default function ContextoUsado({
  contexto,
  completitud,
  demo,
}: {
  contexto: ContextoComercial;
  completitud: Completitud;
  demo: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  const [vende, setVende] = useState(contexto.vende.map((v) => v.nombre).join("\n"));
  const [audiencia, setAudiencia] = useState(contexto.audiencia.descripcion);
  const [problema, setProblema] = useState(contexto.propuesta.problema);
  const [oferta, setOferta] = useState(contexto.ofertas[0]?.texto ?? "");

  const guardar = () => {
    setError(null);
    iniciar(async () => {
      const r = await corregirContextoAccion({
        vende: vende
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((nombre) => {
            // Se conserva el precio y el detalle de la entrada original: la
            // persona está corrigiendo NOMBRES, no borrando lo que ya sabíamos.
            const previo = contexto.vende.find((v) => v.nombre.toLowerCase() === nombre.toLowerCase());
            return { nombre, tipo: previo?.tipo ?? "producto", detalle: previo?.detalle ?? "", precio: previo?.precio ?? null, fuente: "declarado" as const };
          }),
        audiencia: { descripcion: audiencia, rubros: contexto.audiencia.rubros },
        propuesta: { problema, resultado: contexto.propuesta.resultado },
        ofertas: oferta.trim() ? [{ texto: oferta.trim(), fuente: "declarado" as const, reserva: null }] : [],
      });
      if (!r.ok) return setError(r.motivo ?? "No se pudo guardar.");
      setEditando(false);
      setGuardado(true);
    });
  };

  const resumen = contexto.vende.length
    ? contexto.vende.slice(0, 3).map((v) => v.nombre).join(", ") + (contexto.vende.length > 3 ? `, +${contexto.vende.length - 3}` : "")
    : "todavía no sé qué vende";

  return (
    <div className="rounded-lg border" style={{ borderColor: "var(--borde)" }}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <span className="min-w-0">
          <span className="mk-hallazgo-tipo">Lo que Respondo entiende de tu negocio</span>
          <span className="mt-0.5 block truncate" style={{ fontSize: "12.5px", color: "var(--muted)" }}>
            Vende {resumen}
          </span>
        </span>
        <span className="mk-enlace shrink-0" style={{ fontSize: "12px" }}>
          {abierto ? "Ocultar" : "Ver"}
        </span>
      </button>

      {abierto && (
        <div className="border-t px-4 py-4" style={{ borderColor: "var(--borde)" }}>
          {!editando ? (
            <>
              <Dato rotulo="Vende" valor={contexto.vende.map((v) => (v.precio ? `${v.nombre} (${v.precio})` : v.nombre)).join(" · ")} />
              <Dato rotulo="Le vende a" valor={contexto.audiencia.descripcion || contexto.audiencia.rubros.join(", ")} />
              <Dato rotulo="Resuelve" valor={contexto.propuesta.problema} />
              <Dato rotulo="Oferta vigente" valor={contexto.ofertas.map((o) => o.texto).join(" · ")} vacio="ninguna, y no se va a inventar una" />
              <Dato
                rotulo="Puede respaldar"
                valor={contexto.pruebas.map((p) => p.texto).join(" · ")}
                vacio="nada todavía, así que no va a afirmar ningún resultado"
              />
              <Dato
                rotulo="Cómo escribe"
                valor={`${contexto.voz.formalidad === "usted" ? "de usted" : "tuteando"}, tono ${contexto.voz.energia}, ${
                  contexto.voz.emojis === "nunca" ? "sin emojis" : "con algún emoji"
                }${contexto.voz.origen === "declarada" ? " (según lo que escribiste tú)" : " (inferido del rubro)"}`}
              />

              {contexto.descartados.length > 0 && (
                <details className="mt-3">
                  <summary className="mk-enlace" style={{ fontSize: "12px" }}>
                    Qué dejó fuera y por qué ({contexto.descartados.length})
                  </summary>
                  <ul className="mt-2" style={{ fontSize: "11.5px", color: "var(--muted-2)", lineHeight: 1.5 }}>
                    {contexto.descartados.slice(0, 12).map((d, i) => (
                      <li key={i}>
                        «{d.titulo}»: {d.motivo}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {completitud.faltan.length > 0 && (
                <p className="mt-3" style={{ fontSize: "11.5px", color: "var(--muted-2)", lineHeight: 1.5 }}>
                  No sé {completitud.faltan.join("; ")}. Eso no impide escribir el anuncio: lo que no sé, no se inventa.
                </p>
              )}

              {!demo && (
                <button type="button" className="btn-suave mt-4" onClick={() => setEditando(true)}>
                  {guardado ? "Editar de nuevo" : "Corregir"}
                </button>
              )}
              {guardado && (
                <span className="ml-2" style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Guardado. Se usa desde el próximo anuncio.
                </span>
              )}
            </>
          ) : (
            <>
              <label className="mb-3 block">
                <span className="mk-campo-rotulo">Qué vende (uno por línea)</span>
                <textarea className="campo" rows={5} value={vende} onChange={(e) => setVende(e.target.value)} />
              </label>
              <label className="mb-3 block">
                <span className="mk-campo-rotulo">A quién le vende</span>
                <input className="campo" value={audiencia} onChange={(e) => setAudiencia(e.target.value)} />
              </label>
              <label className="mb-3 block">
                <span className="mk-campo-rotulo">Qué problema resuelve</span>
                <textarea className="campo" rows={2} value={problema} onChange={(e) => setProblema(e.target.value)} />
              </label>
              <label className="mb-3 block">
                <span className="mk-campo-rotulo">Oferta vigente</span>
                <input className="campo" value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Déjalo vacío si no hay ninguna" />
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn-primario" onClick={guardar}>
                  Guardar
                </button>
                <button type="button" className="btn-suave" onClick={() => setEditando(false)}>
                  Cancelar
                </button>
              </div>
              {error && (
                <p className="mt-2" style={{ fontSize: "12px", color: "var(--peligro)" }}>
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Dato({ rotulo, valor, vacio }: { rotulo: string; valor: string; vacio?: string }) {
  return (
    <div className="mb-2.5">
      <div className="mk-hallazgo-tipo">{rotulo}</div>
      <div className="mt-0.5" style={{ fontSize: "12.5px", color: valor ? "var(--tinta)" : "var(--muted-2)", lineHeight: 1.5 }}>
        {valor || vacio || "—"}
      </div>
    </div>
  );
}
