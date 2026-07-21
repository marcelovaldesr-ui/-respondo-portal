"use client";

import { useRef, useState, useEffect } from "react";
import { metaEmpleado } from "@/lib/empleados";

export type EmpleadoSimple = { id: string; rol: string; nombrePublico: string };

type Mensaje = {
  rol: "cliente" | "empleado";
  texto: string;
  escalar?: boolean;
  trigger?: string | null;
  resumen?: string | null;
};

/** Arranques sugeridos por rol: en una demo no hay que pensar qué escribir. */
const SUGERENCIAS: Record<string, string[]> = {
  tino: ["¿Cuánto cuesta?", "¿Atienden los sábados?", "Quiero hablar con una persona"],
  rita: ["Me pareció caro", "Se me había pasado, ¿qué días tienen?", "No me contacten más"],
  vera: ["Un 10, quedé feliz", "Un 3, esperaba más", "Todo bien, gracias"],
};

export default function ChatPrueba({ empleados }: { empleados: EmpleadoSimple[] }) {
  const [empleadoId, setEmpleadoId] = useState(empleados[0]?.id ?? "");
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const finRef = useRef<HTMLDivElement>(null);

  const empleado = empleados.find((e) => e.id === empleadoId) ?? empleados[0];
  const meta = metaEmpleado(empleado?.rol ?? "tino");

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, cargando]);

  function reiniciar(id: string) {
    setEmpleadoId(id);
    setMensajes([]);
    setError("");
    setTexto("");
  }

  async function enviar(contenido: string) {
    const limpio = contenido.trim();
    if (!limpio || cargando) return;

    const historial: Mensaje[] = [...mensajes, { rol: "cliente", texto: limpio }];
    setMensajes(historial);
    setTexto("");
    setCargando(true);
    setError("");

    try {
      const r = await fetch("/api/probar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId,
          historial: historial.map((m) => ({ rol: m.rol, texto: m.texto })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "No se pudo responder");

      setMensajes([
        ...historial,
        {
          rol: "empleado",
          texto: data.respuesta,
          escalar: data.escalar,
          trigger: data.trigger,
          resumen: data.resumen,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  if (!empleado) {
    return (
      <div
        className="rounded-2xl border border-dashed p-10 text-center"
        style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted)" }}
      >
        Todavía no tienes empleados activos para probar.
      </div>
    );
  }

  return (
    <div>
      {/* Selector de empleado */}
      <div className="flex flex-wrap items-center gap-2">
        {empleados.map((e) => {
          const m = metaEmpleado(e.rol);
          const activo = e.id === empleadoId;
          return (
            <button
              key={e.id}
              onClick={() => reiniciar(e.id)}
              className={
                "flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-left transition " +
                (activo ? "text-white" : "border bg-white hover:bg-[#FAFAFD]")
              }
              style={
                activo
                  ? { background: m.color }
                  : { borderColor: "var(--borde)", color: "var(--tinta)" }
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.avatar}
                alt={e.nombrePublico}
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
              <span className="leading-tight">
                <span className="block text-[14px] font-bold">{e.nombrePublico}</span>
                <span className="block text-[11px] opacity-75">{m.funcion}</span>
              </span>
            </button>
          );
        })}
        <button
          onClick={() => reiniciar(empleadoId)}
          className="btn-suave ml-auto rounded-full px-4 py-2 text-[13px]"
        >
          Reiniciar conversación
        </button>
      </div>

      {/* Chat */}
      <div className="tarjeta-plana mt-4 p-5" style={{ background: "var(--fondo)" }}>
        <div className="flex min-h-[360px] max-h-[52vh] flex-col gap-3 overflow-y-auto pr-1">
          {mensajes.length === 0 && !cargando && (
            <div className="m-auto max-w-sm text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={meta.avatar}
                alt={empleado.nombrePublico}
                width={64}
                height={64}
                className="avatar mx-auto h-16 w-16"
                style={{ ["--anillo" as string]: meta.color }}
              />
              <p className="mt-3 text-[14.5px]" style={{ color: "var(--muted)" }}>
                Escríbele a <strong style={{ color: "var(--tinta)" }}>{empleado.nombrePublico}</strong>{" "}
                como si fueras un cliente. Te responde en vivo con la información real de tu
                negocio.
              </p>
            </div>
          )}

          {mensajes.map((m, i) => (
            <div key={i}>
              <div
                className={`flex items-end gap-2 ${
                  m.rol === "cliente" ? "justify-start" : "justify-end"
                }`}
              >
                {m.rol === "empleado" && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={meta.avatar}
                    alt=""
                    width={28}
                    height={28}
                    className="order-2 h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                )}
                <div
                  className={
                    "max-w-[74%] px-4 py-2.5 text-[14.5px] leading-relaxed " +
                    (m.rol === "cliente"
                      ? "rounded-2xl rounded-bl-md border bg-white"
                      : "rounded-2xl rounded-br-md text-white")
                  }
                  style={
                    m.rol === "cliente"
                      ? { borderColor: "var(--borde)" }
                      : { background: meta.color }
                  }
                >
                  <div className="whitespace-pre-wrap">{m.texto}</div>
                </div>
              </div>

              {/* El momento que vende: la escalación ocurriendo en vivo */}
              {m.escalar && (
                <div
                  className="mt-2.5 rounded-xl border p-3.5"
                  style={{
                    borderColor: "var(--alerta-borde)",
                    background: "var(--alerta-suave)",
                  }}
                >
                  <div className="text-[13.5px] font-bold" style={{ color: "var(--alerta)" }}>
                    Derivado a una persona
                    {m.trigger ? ` · ${m.trigger.replace(/_/g, " ")}` : ""}
                  </div>
                  {m.resumen && <p className="mt-1 text-[14px]">{m.resumen}</p>}
                  <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                    En tu WhatsApp real, este aviso te llega al instante.
                  </p>
                </div>
              )}
            </div>
          ))}

          {cargando && (
            <div className="flex items-end justify-end gap-2">
              <div
                className="rounded-2xl rounded-br-md px-4 py-2.5 text-[14.5px] text-white opacity-80"
                style={{ background: meta.color }}
              >
                escribiendo…
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={meta.avatar}
                alt=""
                width={28}
                height={28}
                className="order-2 h-7 w-7 shrink-0 rounded-full object-cover"
              />
            </div>
          )}
          <div ref={finRef} />
        </div>

        {/* Sugerencias */}
        {mensajes.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(SUGERENCIAS[empleado.rol] ?? SUGERENCIAS.tino).map((s) => (
              <button
                key={s}
                onClick={() => enviar(s)}
                className="rounded-full border bg-white px-3.5 py-1.5 text-[13.5px] transition hover:border-[color:var(--indigo)]"
                style={{ borderColor: "var(--borde)" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div
            className="mt-3 rounded-xl p-3 text-[14px]"
            style={{ background: "#FEF2F2", color: "#B91C1C" }}
          >
            {error}
          </div>
        )}

        {/* Entrada */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(texto);
          }}
          className="mt-4 flex gap-2"
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={`Escríbele a ${empleado.nombrePublico}...`}
            className="campo flex-1"
          />
          <button
            type="submit"
            disabled={cargando || !texto.trim()}
            className="btn px-5 text-white disabled:opacity-50"
            style={{ background: meta.color }}
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
