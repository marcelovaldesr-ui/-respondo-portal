"use client";

import { useRef, useState, useTransition } from "react";
import { preguntar } from "@/app/(portal)/isabel/acciones";
import { MAX_PREGUNTA, SUGERENCIAS, type RespuestaIsabel } from "@/lib/isabelCore";

type Turno = { pregunta: string; respuesta: RespuestaIsabel };

/**
 * La conversación con Isabel.
 *
 * Decisión de diseño: la respuesta nueva aparece ARRIBA y no al final de una
 * cadena de chat. Esto no es un chat — es una consulta puntual sobre el
 * negocio, y quien pregunta quiere leer la respuesta sin desplazarse. El
 * historial de abajo es memoria, no hilo.
 *
 * La espera se avisa con todas sus letras: Isabel lee cientos de mensajes antes
 * de contestar y demora entre veinte y cuarenta segundos. Sin ese aviso, la
 * persona cree que se colgó y aprieta de nuevo — que es exactamente lo que el
 * tope de uso va a frenar, dejándola sin respuesta y molesta.
 */
export default function IsabelConsulta({ previos = [] }: { previos?: Turno[] }) {
  const [pendiente, iniciar] = useTransition();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);

  function enviar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || pendiente) return;
    setError(null);
    iniciar(async () => {
      const fd = new FormData();
      fd.set("pregunta", limpia);
      const r = await preguntar(fd);
      if (!r.ok || !r.consulta) {
        setError(r.motivo ?? "Isabel no pudo responder.");
        return;
      }
      setTurnos((prev) => [
        { pregunta: r.consulta!.pregunta, respuesta: r.consulta!.respuesta },
        ...prev,
      ]);
      setTexto("");
    });
  }

  const todos = [...turnos, ...previos];

  return (
    <div>
      <div className="tarjeta p-5">
        <label htmlFor="pregunta" className="h-seccion">
          ¿Qué quieres saber de tu negocio?
        </label>
        <textarea
          id="pregunta"
          ref={campo}
          rows={3}
          value={texto}
          maxLength={MAX_PREGUNTA}
          disabled={pendiente}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter hace salto de línea. Es una pregunta
            // corta, no un correo.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar(texto);
            }
          }}
          placeholder="Por ejemplo: ¿alguien reclamó esta semana?"
          className="mt-3 w-full resize-y px-3 py-2.5"
          style={{
            borderRadius: "var(--r-input)",
            border: "1px solid var(--nav-borde)",
            fontSize: "var(--t-cuerpo)",
            background: "#fff",
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primario"
            disabled={pendiente || texto.trim().length < 3}
            onClick={() => enviar(texto)}
          >
            {pendiente ? "Isabel está revisando…" : "Preguntar"}
          </button>
          <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            {pendiente
              ? "Está leyendo las conversaciones. Tarda entre 20 y 40 segundos."
              : "Lee tus fichas y el historial real de mensajes."}
          </span>
        </div>

        {error && (
          <p className="mt-3 text-[13px] font-semibold" style={{ color: "var(--alerta)" }}>
            {error}
          </p>
        )}

        {/* Sugerencias: la pantalla en blanco es lo que hace que nadie vuelva */}
        {!todos.length && !pendiente && (
          <div className="mt-4">
            <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              Para partir:
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="px-3 py-1.5 text-left"
                  style={{
                    borderRadius: "var(--r-chico)",
                    border: "1px solid var(--nav-borde)",
                    fontSize: "var(--t-menor)",
                    color: "var(--muted)",
                    background: "#fff",
                  }}
                  onClick={() => {
                    setTexto(s);
                    enviar(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {todos.map((t, i) => (
        <Respuesta key={`${i}-${t.pregunta.slice(0, 20)}`} turno={t} nueva={i === 0 && turnos.length > 0} />
      ))}
    </div>
  );
}

function Respuesta({ turno, nueva }: { turno: Turno; nueva: boolean }) {
  const { respuesta } = turno;

  /**
   * «No lo sé» se muestra distinto, no escondido. Que Isabel diga que no puede
   * saber algo es información útil —le falta una ficha, o esa conversación no
   * existe— y ocultarlo la haría parecer más segura de lo que está.
   */
  const noSabe = respuesta.seguridad === "no_se";

  return (
    <div
      className="tarjeta mt-4 p-5"
      style={{
        borderLeft: `3px solid ${noSabe ? "#F59E0B" : nueva ? "var(--indigo)" : "var(--nav-borde)"}`,
      }}
    >
      <div style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>{turno.pregunta}</div>

      <p className="mt-2 leading-relaxed" style={{ fontSize: "var(--t-cuerpo)" }}>
        {respuesta.respuesta}
      </p>

      {(respuesta.apoyos?.length ?? 0) > 0 && (
        <>
          <div className="mt-4" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
            En qué se basa
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {(respuesta.apoyos ?? []).map((a, i) => (
              <li key={i} className="flex gap-2 leading-snug" style={{ fontSize: "var(--t-menor)" }}>
                <span
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                  style={{ background: "var(--muted-2)" }}
                />
                <span style={{ color: "var(--muted)" }}>{a}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {noSabe && (
        <p className="mt-3" style={{ fontSize: "var(--t-micro)", color: "#9A3412" }}>
          Isabel solo responde con lo que está cargado y con las conversaciones que hubo. Si
          esto debería saberlo, probablemente falte una ficha en Información.
        </p>
      )}
    </div>
  );
}
