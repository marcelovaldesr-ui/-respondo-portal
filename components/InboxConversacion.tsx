"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { responderComoHumano, cambiarModo } from "@/app/(portal)/conversaciones/acciones";
import { Burbuja } from "@/components/inbox/Burbuja";
import { Compositor } from "@/components/inbox/Compositor";
import { useMensajesEnVivo } from "@/components/inbox/useMensajesEnVivo";
import type { MensajeUI } from "@/components/inbox/tipos";

/**
 * INBOX EN VIVO — la pantalla donde el negocio atiende.
 *
 * El modelo es humano-primero: la persona sabe el negocio; el asistente es un
 * ayudante que se calla apenas ella toma el control.
 *
 * REESCRITO EL 21-AGO-2026 POR RENDIMIENTO. Lo que había hacía esto:
 *  - pedía los 200 mensajes completos cada 4 s y reemplazaba la lista entera;
 *  - usaba el índice del arreglo como clave de React, así que en cada ciclo
 *    re-montaba todas las burbujas y las imágenes parpadeaban;
 *  - tenía el texto que se está escribiendo en el MISMO componente que la lista,
 *    así que cada tecla redibujaba la conversación completa;
 *  - arrastraba el scroll al final aunque estuvieras leyendo mensajes viejos;
 *  - vivía en una caja de 44vh, o sea media pantalla desperdiciada.
 *
 * Ahora: el transporte en vivo está en `useMensajesEnVivo` (SSE con respaldo de
 * sondeo), cada burbuja se memoiza por su contenido, el compositor es su propio
 * componente y el scroll respeta lo que la persona está haciendo.
 */

/** A qué distancia del final se considera que la persona "está abajo". */
const UMBRAL_ABAJO = 120;

export default function InboxConversacion({
  empleadoId,
  chatId,
  empleadoNombre,
  ventana,
  mensajesIniciales,
  modoInicial,
  rapidas,
  contacto,
}: {
  empleadoId: string;
  chatId: string;
  empleadoNombre: string;
  ventana: "abierta" | "cerrada" | "desconocida" | "no_aplica";
  mensajesIniciales: MensajeUI[];
  modoInicial: string;
  rapidas?: string[];
  /** Nombre del contacto: precarga el primer dato de las plantillas. */
  contacto?: string;
}) {
  const {
    mensajes,
    modo,
    setModo,
    conexion,
    sondear,
    agregarOptimista,
    quitar,
    marcar,
    cargarAnteriores,
    hayMasHistorial,
    cargandoHistorial,
  } = useMensajesEnVivo({ empleadoId, chatId, inicial: mensajesIniciales, modoInicial });

  const [, startTransition] = useTransition();
  const [cambiando, setCambiando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [sinLeer, setSinLeer] = useState(0);
  const [enviandoPlantilla, setEnviandoPlantilla] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const estabaAbajo = useRef(true);
  const cantidadPrevia = useRef(mensajes.length);
  /** Alto del contenido antes de insertar historial, para no perder el punto. */
  const altoPrevio = useRef(0);

  const estaAbajo = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < UMBRAL_ABAJO;
  }, []);

  const irAlFinal = useCallback((suave = true) => {
    finRef.current?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "end" });
    setSinLeer(0);
  }, []);

  /**
   * SCROLL QUE NO SECUESTRA.
   *
   * Antes se bajaba al final cada vez que cambiaba la cantidad de mensajes. Si
   * estabas leyendo algo de ayer y entraba un mensaje, te tiraba abajo. Ahora
   * solo baja solo si YA estabas abajo; si no, aparece un contador de "nuevos".
   *
   * Es exactamente lo que hace WhatsApp, y la diferencia se nota al primer uso.
   */
  useEffect(() => {
    const nuevos = mensajes.length - cantidadPrevia.current;
    cantidadPrevia.current = mensajes.length;
    if (nuevos <= 0) return;

    if (estabaAbajo.current) {
      irAlFinal();
    } else {
      // Los propios no cuentan como "sin leer": los acabas de mandar tú.
      const ajenos = mensajes.slice(-nuevos).filter((m) => m.rol === "cliente").length;
      if (ajenos > 0) setSinLeer((n) => n + ajenos);
    }
  }, [mensajes, irAlFinal]);

  /** Primera pintada: al final, sin animación. */
  useEffect(() => {
    irAlFinal(false);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback(() => {
    estabaAbajo.current = estaAbajo();
    if (estabaAbajo.current && sinLeer) setSinLeer(0);
  }, [estaAbajo, sinLeer]);

  /**
   * Cargar historial conservando la posición visual.
   *
   * Sin esto, insertar 50 mensajes arriba empuja el contenido y la persona
   * termina mirando otra parte de la conversación sin haber tocado nada.
   */
  const verAnteriores = useCallback(async () => {
    const el = scrollRef.current;
    altoPrevio.current = el?.scrollHeight ?? 0;
    await cargarAnteriores();
    requestAnimationFrame(() => {
      const e2 = scrollRef.current;
      if (!e2) return;
      e2.scrollTop = e2.scrollHeight - altoPrevio.current;
    });
  }, [cargarAnteriores]);

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
      }
    });
  }

  /** Enviar texto: se dibuja al instante y se confirma o se revierte después. */
  const enviarTexto = useCallback(
    (limpio: string) => {
      const idTmp = agregarOptimista({
        rol: "humano",
        texto: limpio,
        creadoEn: new Date().toISOString(),
        estado: "pendiente",
      });
      setModo("humano");

      const fd = new FormData();
      fd.set("empleadoId", empleadoId);
      fd.set("chatId", chatId);
      fd.set("texto", limpio);

      startTransition(async () => {
        try {
          const r = await responderComoHumano(fd);
          if (!r.ok) {
            // Si el proveedor SÍ lo mandó, quitarlo sería mentir al revés: el
            // cliente lo recibió. Se deja marcado y se avisa.
            if (!r.enviado) quitar(idTmp);
            else marcar(idTmp, { fallido: true });
            setAviso(r.error || "No se pudo enviar el mensaje.");
          } else {
            setAviso(null);
            // Trae la versión real (con id y estado) para que el ✓ empiece a
            // moverse sin esperar al próximo ciclo.
            void sondear();
          }
        } catch {
          quitar(idTmp);
          setAviso("No se pudo enviar el mensaje. Intenta de nuevo.");
        }
      });
    },
    [empleadoId, chatId, agregarOptimista, quitar, marcar, setModo, sondear],
  );

  /**
   * Enviar archivo con vista previa inmediata y progreso real.
   *
   * Se usa XMLHttpRequest y no `fetch` por una sola razón: `fetch` todavía no
   * expone el progreso de SUBIDA de forma confiable en todos los navegadores, y
   * sin progreso una foto de 5 MB parece que se colgó.
   */
  const enviarArchivo = useCallback(
    (archivo: File, caption: string) => {
      if (subiendo) return;
      const esImagen = archivo.type.startsWith("image/");
      const previa = esImagen ? URL.createObjectURL(archivo) : null;

      const idTmp = agregarOptimista({
        rol: "humano",
        texto: caption || (esImagen ? "📷 Imagen enviada" : `📎 ${archivo.name}`),
        creadoEn: new Date().toISOString(),
        estado: "pendiente",
        previa,
      });
      setModo("humano");
      setSubiendo(true);
      setProgreso(0);
      setAviso(null);

      const fd = new FormData();
      fd.set("empleadoId", empleadoId);
      fd.set("chatId", chatId);
      fd.set("archivo", archivo);
      if (caption) fd.set("caption", caption);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/whatsapp/adjunto");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgreso(Math.round((e.loaded / e.total) * 100));
      };
      const terminar = () => {
        setSubiendo(false);
        setProgreso(0);
        if (previa) URL.revokeObjectURL(previa);
      };
      xhr.onload = () => {
        let r: { ok?: boolean; error?: string; enviado?: boolean } = {};
        try {
          r = JSON.parse(xhr.responseText);
        } catch {
          /* respuesta ilegible */
        }
        if (r.ok) {
          void sondear();
        } else {
          if (!r.enviado) quitar(idTmp);
          else marcar(idTmp, { fallido: true });
          setAviso(r.error || "No se pudo enviar el archivo.");
        }
        terminar();
      };
      xhr.onerror = () => {
        quitar(idTmp);
        setAviso("Se cortó la conexión al enviar el archivo.");
        terminar();
      };
      xhr.send(fd);
    },
    [empleadoId, chatId, subiendo, agregarOptimista, quitar, marcar, setModo, sondear],
  );

  /** Enviar una plantilla aprobada (única vía fuera de la ventana de 24 h). */
  const enviarPlantilla = useCallback(
    (nombre: string, params: string[]) => {
      setEnviandoPlantilla(true);
      setAviso(null);
      fetch("/api/whatsapp/plantilla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId, chatId, plantilla: nombre, params }),
      })
        .then((r) => r.json())
        .then((r: { ok?: boolean; error?: string }) => {
          if (r.ok) {
            setModo("humano");
            void sondear();
          } else {
            setAviso(r.error || "No se pudo enviar la plantilla.");
          }
        })
        .catch(() => setAviso("Se cortó la conexión al enviar la plantilla."))
        .finally(() => setEnviandoPlantilla(false));
    },
    [empleadoId, chatId, setModo, sondear],
  );

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {/* Barra de control: quién tiene la conversación */}
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5"
        style={{
          background: enControl ? "#EEF2FF" : "#F6F7FB",
          border: `1px solid ${enControl ? "#C7D2FE" : "var(--borde)"}`,
        }}
      >
        <span
          className="flex items-center gap-2 text-[13px] font-semibold"
          style={{ color: enControl ? "#3730A3" : "var(--muted)" }}
        >
          {enControl ? (
            <>🙋 Tú tienes el control · {empleadoNombre} está en silencio</>
          ) : (
            <>🤖 {empleadoNombre} está atendiendo este chat</>
          )}
          {/*
            Punto de conexión. Discreto a propósito: informa sin alarmar, porque
            esta pantalla la puede estar viendo un prospecto en una demo.
          */}
          <span
            title={
              conexion === "vivo"
                ? "En vivo"
                : conexion === "sondeando"
                  ? "Actualizando cada pocos segundos"
                  : "Reconectando…"
            }
            aria-label={conexion === "vivo" ? "En vivo" : "Reconectando"}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              display: "inline-block",
              background:
                conexion === "vivo" ? "#22C55E" : conexion === "sondeando" ? "#F59E0B" : "#CBD5E1",
            }}
          />
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

      {/* Conversación */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex h-full min-h-[46vh] flex-col gap-2.5 overflow-y-auto pr-1"
          style={{ overflowAnchor: "none" }}
        >
          {hayMasHistorial && mensajes.length > 0 && (
            <div className="flex justify-center py-1">
              <button
                onClick={verAnteriores}
                disabled={cargandoHistorial}
                className="rounded-full px-3 py-1 text-[12px] disabled:opacity-50"
                style={{ background: "#F1F2F7", color: "var(--muted)" }}
              >
                {cargandoHistorial ? "Cargando…" : "Ver mensajes anteriores"}
              </button>
            </div>
          )}

          {mensajes.map((m) => (
            <Burbuja key={m.id} m={m} />
          ))}
          <div ref={finRef} />
        </div>

        {/* Aviso de mensajes nuevos cuando estás leyendo más arriba */}
        {sinLeer > 0 && (
          <button
            onClick={() => irAlFinal()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold shadow-lg"
            style={{ background: "var(--indigo, #4F46E5)", color: "#fff" }}
          >
            {sinLeer} mensaje{sinLeer > 1 ? "s" : ""} nuevo{sinLeer > 1 ? "s" : ""} ↓
          </button>
        )}
      </div>

      {aviso && (
        <div
          className="mt-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          {aviso}
        </div>
      )}

      <div className="mt-4">
        <Compositor
          enviarTexto={enviarTexto}
          enviarArchivo={enviarArchivo}
          ventana={ventana}
          empleadoNombre={empleadoNombre}
          enControl={enControl}
          rapidas={rapidas}
          subiendo={subiendo}
          progreso={progreso}
          contacto={contacto ?? ""}
          enviarPlantilla={enviarPlantilla}
          enviandoPlantilla={enviandoPlantilla}
        />
      </div>
    </div>
  );
}
