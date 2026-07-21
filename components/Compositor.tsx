"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { responderComoHumano } from "@/app/(portal)/conversaciones/acciones";

/**
 * Cuadro para que el humano del negocio le escriba al cliente desde el inbox
 * (Opción B). Al enviar: guarda el mensaje, toma el control (el bot calla) y lo
 * manda por WhatsApp.
 *
 * Auto-refresco: mientras hay un chat abierto, refresca la vista cada 8s para
 * que aparezcan los mensajes nuevos del cliente sin recargar a mano. Es la
 * versión simple de "tiempo real"; se puede subir a Supabase Realtime después.
 */
export default function Compositor({
  empleadoId,
  chatId,
  ventana,
}: {
  empleadoId: string;
  chatId: string;
  ventana: "abierta" | "cerrada" | "desconocida";
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [pendiente, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-refresco cada 8s para ver mensajes entrantes.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [router]);

  function enviar() {
    const limpio = texto.trim();
    if (!limpio || pendiente) return;
    const fd = new FormData();
    fd.set("empleadoId", empleadoId);
    fd.set("chatId", chatId);
    fd.set("texto", limpio);
    startTransition(async () => {
      await responderComoHumano(fd);
      setTexto("");
      areaRef.current?.focus();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--borde)" }}>
      {ventana === "cerrada" && (
        <div
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp
          solo permite responder con una plantilla aprobada; un texto libre puede
          no llegar. (El envío de plantillas llega en la próxima etapa.)
        </div>
      )}

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
          placeholder="Escríbele al cliente…  (Enter envía, Shift+Enter salta línea)"
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
        Al escribir tomas el control: el asistente deja de responder en este chat
        hasta que se lo devuelvas.
      </p>
    </div>
  );
}
