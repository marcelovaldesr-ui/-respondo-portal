"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  responderComoHumano,
  enviarArchivoComoHumano,
} from "@/app/(portal)/conversaciones/acciones";

/**
 * Cuadro para que el humano del negocio le escriba al cliente desde el inbox
 * (Opción B). Al enviar: guarda el mensaje, toma el control (el bot calla) y lo
 * manda por WhatsApp. Ahora también permite adjuntar imagen o PDF.
 *
 * Auto-refresco: mientras hay un chat abierto, refresca la vista cada 8s para
 * que aparezcan los mensajes nuevos del cliente sin recargar a mano.
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
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  /** Lee un File como base64 (sin el prefijo data:) para mandarlo al server. */
  function leerBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || "");
        const coma = res.indexOf(",");
        resolve(coma >= 0 ? res.slice(coma + 1) : res);
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });
  }

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // permitir re-elegir el mismo archivo
    if (!file || subiendo) return;
    if (file.size > 12 * 1024 * 1024) {
      setAviso("El archivo supera los 12MB. Prueba con uno más liviano.");
      return;
    }
    setAviso(null);
    setSubiendo(true);
    try {
      const data = await leerBase64(file);
      const fd = new FormData();
      fd.set("empleadoId", empleadoId);
      fd.set("chatId", chatId);
      fd.set("filename", file.name);
      fd.set("mimetype", file.type || "application/octet-stream");
      fd.set("data", data);
      if (texto.trim()) fd.set("caption", texto.trim()); // el texto va como pie de foto
      const r = await enviarArchivoComoHumano(fd);
      if (r.ok) {
        setTexto("");
        router.refresh();
      } else {
        setAviso(r.error || "No se pudo enviar el archivo.");
      }
    } catch {
      setAviso("No se pudo leer el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  const ocupado = pendiente || subiendo;

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

      {aviso && (
        <div
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          {aviso}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Adjuntar archivo (imagen o PDF) */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={onArchivo}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={ocupado}
          title="Adjuntar imagen o PDF"
          aria-label="Adjuntar archivo"
          className="btn-secundario shrink-0 disabled:opacity-50"
          style={{ padding: "0 12px", height: 40 }}
        >
          {subiendo ? "…" : "📎"}
        </button>

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
          placeholder="Escríbele al cliente…  (Enter envía · 📎 adjunta imagen/PDF)"
          className="campo flex-1 resize-none"
        />
        <button
          onClick={enviar}
          disabled={ocupado || !texto.trim()}
          className="btn-primario shrink-0 disabled:opacity-50"
        >
          {pendiente ? "Enviando…" : "Enviar"}
        </button>
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
        Al escribir o adjuntar tomas el control: el asistente deja de responder en
        este chat hasta que se lo devuelvas. Si escribes texto junto al archivo, va
        como descripción de la imagen.
      </p>
    </div>
  );
}
