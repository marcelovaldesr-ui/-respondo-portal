"use client";

import { memo, useEffect, useRef, useState } from "react";
import { SelectorPlantilla } from "./SelectorPlantilla";

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
  contacto,
  rubro,
  enviarPlantilla,
  enviandoPlantilla,
  pedirPlantilla = 0,
}: {
  enviarTexto: (texto: string) => void;
  enviarArchivo: (archivo: File, caption: string) => void;
  ventana: "abierta" | "cerrada" | "desconocida" | "no_aplica";
  empleadoNombre: string;
  enControl: boolean;
  rapidas?: string[];
  subiendo: boolean;
  progreso: number;
  /** Nombre del contacto, para precargar la plantilla. */
  contacto: string;
  /** Rubro del negocio: decide qué plantillas se ofrecen. */
  rubro: string | null;
  enviarPlantilla: (nombre: string, params: string[]) => void;
  enviandoPlantilla: boolean;
  /** Contador: cada incremento abre el selector de plantillas (el servidor rechazó por 24 h). */
  pedirPlantilla?: number;
}) {
  const [texto, setTexto] = useState("");
  const [conPlantilla, setConPlantilla] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const RAPIDAS = rapidas && rapidas.length > 0 ? rapidas : RAPIDAS_DEFECTO;

  useEffect(() => {
    if (pedirPlantilla > 0) setConPlantilla(true);
  }, [pedirPlantilla]);

  /**
   * En un teléfono, Enter NO envía: es el salto de línea. El teclado táctil no
   * tiene Shift+Enter cómodo, y un Enter que manda a medio escribir es el error
   * más común en chats móviles (auditoría 3-sep-2026). En escritorio Enter
   * envía, como en WhatsApp Web.
   */
  const [tactil, setTactil] = useState(false);
  useEffect(() => {
    try {
      setTactil(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      /* sin matchMedia: escritorio */
    }
  }, []);

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
      {/*
        FUERA DE PLAZO: OFRECER UNA SALIDA, NO SOLO AVISAR.

        Antes acá solo estaba la advertencia. La persona la leía, escribía igual
        —porque el campo seguía habilitado— y el mensaje moría en Meta con el
        error 131047. Un aviso que no ofrece qué hacer es peor que ninguno:
        deja a alguien mirando una conversación que no puede retomar.

        La ventana de 24 h es de Meta y aplica al asistente y a la persona por
        igual. Lo que SÍ pasa fuera de plazo es una plantilla aprobada.
      */}
      {ventana === "cerrada" && !conPlantilla && (
        <div
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          <span>
            Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite
            retomar con una plantilla aprobada.
          </span>
          <button
            onClick={() => setConPlantilla(true)}
            className="btn-suave shrink-0 px-3 py-1 text-[12px]"
          >
            Usar plantilla
          </button>
        </div>
      )}

      {conPlantilla && (
        <SelectorPlantilla
          rubro={rubro}
          contacto={contacto}
          enviando={enviandoPlantilla}
          onCancelar={() => setConPlantilla(false)}
          onEnviar={(nombre, params) => {
            enviarPlantilla(nombre, params);
            setConPlantilla(false);
          }}
        />
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
            if (!tactil && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
          rows={2}
          placeholder={
            tactil
              ? "Escríbele al cliente…"
              : "Escríbele al cliente…  (Enter envía · 📎 o pegar una imagen)"
          }
          aria-label="Mensaje para el cliente"
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
