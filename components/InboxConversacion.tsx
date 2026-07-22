"use client";

import { useEffect, useRef, useState, useTransition, useCallback } from "react";
import {
  responderComoHumano,
  cambiarModo,
} from "@/app/(portal)/conversaciones/acciones";

type Msg = { rol: string; texto: string; creadoEn: string };

const hora = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

/** Respuestas rápidas de Cecilia (atajos suyos, no IA). Editable a futuro. */
const RAPIDAS = [
  "¡Hola! ¿En qué te puedo ayudar?",
  "Te confirmo y te aviso a la brevedad 👍",
  "¿Me pasas producto, cantidad y medidas?",
  "Los pedidos se retiran en Arauco 1060, Chillán.",
];

/**
 * Inbox en vivo para que CECILIA atienda. El modelo es humano-primero: ella sabe
 * el negocio; Tino es solo un asistente que se calla apenas ella toma el control.
 *  - Toma de control en 1 clic (o al escribir) → Tino queda en silencio al instante.
 *  - Devolver el control a Tino cuando ella quiera.
 *  - Mensajes en vivo (sin recargar) + envío con Enter.
 */
export default function InboxConversacion({
  empleadoId,
  chatId,
  empleadoNombre,
  color,
  ventana,
  mensajesIniciales,
  modoInicial,
}: {
  empleadoId: string;
  chatId: string;
  empleadoNombre: string;
  color: string;
  ventana: "abierta" | "cerrada" | "desconocida";
  mensajesIniciales: Msg[];
  modoInicial: string;
}) {
  const [mensajes, setMensajes] = useState<Msg[]>(mensajesIniciales);
  const [modo, setModo] = useState(modoInicial);
  const [texto, setTexto] = useState("");
  const [pendiente, startTransition] = useTransition();
  const [cambiando, setCambiando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const bajar = () => finRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(bajar, [mensajes.length]);

  // Poll en vivo cada 4s: mensajes nuevos + modo actual, sin recargar la página.
  const refrescar = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/whatsapp/mensajes?emp=${empleadoId}&chat=${encodeURIComponent(chatId)}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d.mensajes)) setMensajes(d.mensajes);
      if (d.modo) setModo(d.modo);
    } catch {
      /* silencioso */
    }
  }, [empleadoId, chatId]);

  useEffect(() => {
    const t = setInterval(refrescar, 4000);
    return () => clearInterval(t);
  }, [refrescar]);

  const enControl = modo === "humano";

  function setModoServidor(destino: "bot" | "humano") {
    setCambiando(true);
    setModo(destino); // optimista: se refleja al tiro
    const fd = new FormData();
    fd.set("empleadoId", empleadoId);
    fd.set("chatId", chatId);
    fd.set("modo", destino);
    startTransition(async () => {
      try {
        await cambiarModo(fd);
      } finally {
        setCambiando(false);
        refrescar();
      }
    });
  }

  function enviar() {
    const limpio = texto.trim();
    if (!limpio || pendiente) return;
    // Al escribir, Cecilia toma el control y Tino se calla.
    setMensajes((m) => [...m, { rol: "humano", texto: limpio, creadoEn: new Date().toISOString() }]);
    setModo("humano");
    setTexto("");
    const fd = new FormData();
    fd.set("empleadoId", empleadoId);
    fd.set("chatId", chatId);
    fd.set("texto", limpio);
    startTransition(async () => {
      try {
        await responderComoHumano(fd);
      } finally {
        areaRef.current?.focus();
        refrescar();
      }
    });
  }

  return (
    <div className="mt-4 flex flex-col">
      {/* Barra de control: quién tiene la conversación */}
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5"
        style={{
          background: enControl ? "#EEF2FF" : "#F6F7FB",
          border: `1px solid ${enControl ? "#C7D2FE" : "var(--borde)"}`,
        }}
      >
        <span className="text-[13px] font-semibold" style={{ color: enControl ? "#3730A3" : "var(--muted)" }}>
          {enControl ? (
            <>🙋 Tú tienes el control · {empleadoNombre} está en silencio</>
          ) : (
            <>🤖 {empleadoNombre} está atendiendo este chat</>
          )}
        </span>
        {enControl ? (
          <button
            onClick={() => setModoServidor("bot")}
            disabled={cambiando}
            className="btn-suave px-3 py-1.5 text-[12.5px] disabled:opacity-50"
          >
            Devolver a {empleadoNombre}
          </button>
        ) : (
          <button
            onClick={() => setModoServidor("humano")}
            disabled={cambiando}
            className="btn-primario px-3.5 py-1.5 text-[12.5px] disabled:opacity-50"
          >
            Tomar el control
          </button>
        )}
      </div>

      {/* Mensajes en vivo */}
      <div className="flex max-h-[44vh] flex-col gap-2.5 overflow-y-auto pr-1">
        {mensajes.map((m, i) => {
          const delCliente = m.rol === "cliente";
          const esHumano = m.rol === "humano";
          return (
            <div key={i} className={`flex ${delCliente ? "justify-start" : "justify-end"}`}>
              <div
                className={
                  "max-w-[76%] px-4 py-2.5 text-[14.5px] leading-relaxed " +
                  (delCliente
                    ? "rounded-2xl rounded-bl-md border bg-white"
                    : "rounded-2xl rounded-br-md text-white")
                }
                style={
                  delCliente
                    ? { borderColor: "var(--borde)" }
                    : { background: esHumano ? "#334155" : color }
                }
              >
                {esHumano && (
                  <div className="mb-0.5 text-[10px] font-extrabold uppercase tracking-widest opacity-80">
                    Tú
                  </div>
                )}
                <div className="whitespace-pre-wrap">{m.texto}</div>
                <div
                  className={"mt-1 text-[10.5px] " + (delCliente ? "" : "opacity-75")}
                  style={delCliente ? { color: "var(--muted-2)" } : undefined}
                >
                  {hora(m.creadoEn)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      {/* Compositor */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--borde)" }}>
        {ventana === "cerrada" && (
          <div
            className="mb-2 rounded-lg px-3 py-2 text-[12.5px]"
            style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
          >
            Pasaron más de 24h desde el último mensaje del cliente. WhatsApp solo permite
            responder con plantilla aprobada; un texto libre puede no llegar.
          </div>
        )}

        {/* Respuestas rápidas de Cecilia */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {RAPIDAS.map((r) => (
            <button
              key={r}
              onClick={() => { setTexto(r); areaRef.current?.focus(); }}
              className="rounded-full px-3 py-1.5 text-[12px]"
              style={{ background: "#F1F2F7", color: "var(--muted)" }}
              title="Insertar respuesta rápida"
            >
              {r.length > 34 ? r.slice(0, 32) + "…" : r}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={2}
            placeholder="Escríbele al cliente…  (Enter envía · Shift+Enter salta línea)"
            className="campo flex-1 resize-none"
          />
          <button
            onClick={enviar}
            disabled={pendiente || !texto.trim()}
            className="btn-primario shrink-0 disabled:opacity-50"
          >
            {pendiente ? "Enviando…" : "Enviar"}
          </button>
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
          {enControl
            ? `${empleadoNombre} no responde mientras tú tienes el control.`
            : `Apenas escribas, tomas el control y ${empleadoNombre} se calla en este chat.`}
        </p>
      </div>
    </div>
  );
}
