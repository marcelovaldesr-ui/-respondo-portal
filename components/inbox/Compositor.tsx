"use client";

import { memo, useRef, useState } from "react";

/**
 * EL COMPOSITOR, AISLADO DEL RESTO DEL CHAT.
 *
 * POR QUÉ ES SU PROPIO COMPONENTE — no es una preferencia de estilo.
 *
 * El texto que se está escribiendo vivía en el mismo componente que la lista de
 * mensajes. En React eso significa que **cada tecla volvía a dibujar las 200
 * burbujas de la conversación**, con sus imágenes y sus fechas. En un chat largo
 * se sentía como escribir sobre barro.
 *
 * Sacando el estado del texto acá abajo, tipear no toca la lista para nada.
 */

const RAPIDAS_DEFECTO = [
  "¡Hola! ¿En qué te puedo ayudar?",
  "Te confirmo y te aviso a la brevedad 👍",
  "¿Me cuentas un poco más para ayudarte mejor?",
  "¡Gracias por escribirnos! 🙌",
];

function CompositorBase({
  enviarTexto,
  enviarArchivo,
  ventana,
  empleadoNombre,
  enControl,
  rapidas,
  subiendo,
  progreso,
}: {
  enviarTexto: (texto: string) => void;
  enviarArchivo: (archivo: File, caption: string) => void;
  ventana: "abierta" | "cerrada" | "desconocida";
  empleadoNombre: string;
  enControl: boolean;
  rapidas?: string[];
  subiendo: boolean;
  progreso: number;
}) {
  const [texto, setTexto] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const RAPIDAS = rapidas && rapidas.length > 0 ? rapidas : RAPIDAS_DEFECTO;

  const mandar = () => {
    const limpio = texto.trim();
    if (!limpio) return;
    // Se limpia ANTES de que responda el servidor: el mensaje ya se ve en la
    // conversación gracias al dibujo optimista, y dejar el texto en la caja
    // hace dudar de si se envió.
    setTexto("");
    enviarTexto(limpio);
    areaRef.current?.focus();
  };

  const onArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // permitir volver a elegir el mismo archivo
    if (!file || subiendo) return;
    enviarArchivo(file, texto.trim());
    setTexto("");
  };

  /** Pegar una imagen desde el portapapeles: es como se comparte una captura. */
  const onPegar = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file || subiendo) return;
    e.preventDefault();
    enviarArchivo(file, texto.trim());
    setTexto("");
  };

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--borde)" }}>
      {ventana === "cerrada" && (
        <div
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite
          responder con plantilla aprobada; un texto libre puede no llegar.
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {RAPIDAS.map((r) => (
          <button
            key={r}
            onClick={() => {
              setTexto(r);
              areaRef.current?.focus();
            }}
            className="rounded-full px-3 py-1.5 text-[12px]"
            style={{ background: "#F1F2F7", color: "var(--muted)" }}
            title="Insertar respuesta rápida"
          >
            {r.length > 34 ? r.slice(0, 32) + "…" : r}
          </button>
        ))}
      </div>

      {subiendo && (
        <div className="mb-2" aria-live="polite">
          <div className="mb-1 text-[11.5px]" style={{ color: "var(--muted)" }}>
            Enviando archivo… {progreso}%
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "#EDEFF5" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${progreso}%`,
                background: "var(--indigo, #4F46E5)",
                transition: "width .15s linear",
              }}
            />
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          onChange={onArchivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={subiendo}
          title="Adjuntar imagen o PDF"
          aria-label="Adjuntar archivo"
          className="btn-suave shrink-0 disabled:opacity-50"
          style={{ padding: "0 12px", height: 42 }}
        >
          {subiendo ? "…" : "📎"}
        </button>

        <textarea
          ref={areaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={onPegar}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
          rows={2}
          placeholder="Escríbele al cliente…  (Enter envía · 📎 o pegar una imagen)"
          className="campo flex-1 resize-none"
        />
        <button
          onClick={mandar}
          disabled={!texto.trim()}
          className="btn-primario shrink-0 disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
        {enControl
          ? `${empleadoNombre} no responde mientras tú tienes el control.`
          : `Apenas escribas, tomas el control y ${empleadoNombre} se calla en este chat.`}
      </p>
    </div>
  );
}

export const Compositor = memo(CompositorBase);
