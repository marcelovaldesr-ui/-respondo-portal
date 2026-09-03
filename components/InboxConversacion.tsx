"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { responderComoHumano, cambiarModo } from "@/app/(portal)/conversaciones/acciones";
import { Burbuja } from "@/components/inbox/Burbuja";
import { Compositor } from "@/components/inbox/Compositor";
import { Cobro } from "@/components/inbox/Cobro";
import { useMensajesEnVivo } from "@/components/inbox/useMensajesEnVivo";
import type { MensajeUI } from "@/components/inbox/tipos";
import { ventanaDesde, type EstadoVentana } from "@/lib/ventana24Regla";

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
  ventana: ventanaInicial,
  ventanaAplica,
  ultimoClienteEn,
  mensajesIniciales,
  hayMasInicial,
  modoInicial,
  rapidas,
  contacto,
  rubro,
}: {
  empleadoId: string;
  chatId: string;
  empleadoNombre: string;
  ventana: EstadoVentana;
  /** Transporte cloud: la ventana de 24 h existe. En WAHA no. */
  ventanaAplica?: boolean;
  /** Último mensaje del cliente (por número) al cargar; se actualiza con el stream. */
  ultimoClienteEn?: string | null;
  mensajesIniciales: MensajeUI[];
  hayMasInicial?: boolean;
  modoInicial: string;
  rapidas?: string[];
  /** Nombre del contacto: precarga el primer dato de las plantillas. */
  contacto?: string;
  /** Rubro del negocio: decide qué plantillas se ofrecen (ver SelectorPlantilla). */
  rubro?: string | null;
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
    confirmar,
    cargarAnteriores,
    hayMasHistorial,
    cargandoHistorial,
  } = useMensajesEnVivo({
    empleadoId,
    chatId,
    inicial: mensajesIniciales,
    modoInicial,
    hayMasInicial,
  });

  const [, startTransition] = useTransition();
  const [cambiando, setCambiando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [sinLeer, setSinLeer] = useState(0);
  const [enviandoPlantilla, setEnviandoPlantilla] = useState(false);
  /** El servidor rechazó un envío por ventana cerrada: manda sobre cualquier cálculo local. */
  const [ventanaCerradaConfirmada, setVentanaCerradaConfirmada] = useState(false);
  /** Cada incremento le pide al compositor que abra el selector de plantillas. */
  const [pedirPlantilla, setPedirPlantilla] = useState(0);
  /** Reloj de un minuto: la ventana de 24 h se cierra sola con la pestaña abierta. */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  /**
   * VENTANA DE 24 H EN VIVO (auditoría 3-sep-2026).
   *
   * Antes era una foto del momento de carga: con la bandeja abierta toda la
   * mañana, decía «abierta» sobre una conversación que se cerró hace horas, y
   * el mensaje "salía" y no llegaba. Ahora se recalcula con el último mensaje
   * del cliente que se conoce (el del servidor o uno que llegó por el stream)
   * y con un reloj de un minuto.
   */
  const ventana: EstadoVentana = (() => {
    if (ventanaCerradaConfirmada) return "cerrada";
    if (ventanaAplica === undefined) return ventanaInicial;
    if (!ventanaAplica) return "no_aplica";
    let ultimo = ultimoClienteEn ?? null;
    for (const m of mensajes) {
      if (m.rol === "cliente" && (!ultimo || Date.parse(m.creadoEn) > Date.parse(ultimo))) {
        ultimo = m.creadoEn;
      }
    }
    return ventanaDesde("cloud", ultimo, ahora);
  })();
  // Un mensaje nuevo del cliente reabre la ventana: se levanta la confirmación.
  useEffect(() => {
    if (!ventanaCerradaConfirmada) return;
    const delCliente = mensajes.filter((m) => m.rol === "cliente");
    const ultimo = delCliente[delCliente.length - 1];
    if (ultimo && Date.now() - Date.parse(ultimo.creadoEn) < 60_000) setVentanaCerradaConfirmada(false);
  }, [mensajes, ventanaCerradaConfirmada]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const estabaAbajo = useRef(true);
  const cantidadPrevia = useRef(mensajes.length);
  /** Alto del contenido antes de insertar historial, para no perder el punto. */
  const altoPrevio = useRef(0);

  /**
   * QUIÉN HACE SCROLL DE VERDAD.
   *
   * En escritorio la lista de mensajes desplaza por dentro (cadena flex con
   * min-h-0). En el teléfono no hay alto fijo y la que desplaza es la columna
   * o la página entera. Medir siempre `scrollRef` daba "estás abajo" en todos
   * los casos (scrollHeight == clientHeight), así que el aviso de «N nuevos»
   * nunca aparecía y "ver anteriores" saltaba al final (auditoría 3-sep-2026).
   */
  const contenedorScroll = useCallback((): HTMLElement | null => {
    let n: HTMLElement | null = scrollRef.current;
    while (n) {
      const desborda = n.scrollHeight > n.clientHeight + 1;
      const estilo = window.getComputedStyle(n).overflowY;
      if (desborda && (estilo === "auto" || estilo === "scroll")) return n;
      n = n.parentElement;
    }
    return null; // desplaza la página
  }, []);

  const estaAbajo = useCallback(() => {
    const el = contenedorScroll();
    if (!el) {
      const doc = document.documentElement;
      return doc.scrollHeight - window.scrollY - window.innerHeight < UMBRAL_ABAJO;
    }
    return el.scrollHeight - el.scrollTop - el.clientHeight < UMBRAL_ABAJO;
  }, [contenedorScroll]);

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
    // -1 = acaba de insertarse historial arriba: no es "nuevo", no se baja.
    if (cantidadPrevia.current === -1) {
      cantidadPrevia.current = mensajes.length;
      return;
    }
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

  // El scroll puede ocurrir en un ancestro o en la ventana (teléfono): se
  // escucha en captura para enterarse igual.
  useEffect(() => {
    const h = () => onScroll();
    window.addEventListener("scroll", h, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", h, { capture: true });
  }, [onScroll]);

  /**
   * Cargar historial conservando la posición visual.
   *
   * Sin esto, insertar 50 mensajes arriba empuja el contenido y la persona
   * termina mirando otra parte de la conversación sin haber tocado nada.
   */
  const verAnteriores = useCallback(async () => {
    const el = contenedorScroll();
    const doc = document.documentElement;
    altoPrevio.current = el ? el.scrollHeight : doc.scrollHeight;
    // Se marca que NO estamos abajo: los mensajes que se insertan arriba no son
    // "nuevos" y no deben arrastrar la vista al final.
    estabaAbajo.current = false;
    cantidadPrevia.current = -1; // ver efecto de scroll: ignora este cambio
    await cargarAnteriores();
    requestAnimationFrame(() => {
      const e2 = contenedorScroll();
      if (e2) e2.scrollTop += e2.scrollHeight - altoPrevio.current;
      else window.scrollBy(0, doc.scrollHeight - altoPrevio.current);
    });
  }, [cargarAnteriores, contenedorScroll]);

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
            // Fuera de las 24 h: en vez de solo avisar, se ofrece la plantilla.
            if (r.codigo === "ventana_cerrada") {
              setVentanaCerradaConfirmada(true);
              setPedirPlantilla((n) => n + 1);
            }
          } else {
            setAviso(null);
            // El id real reemplaza al temporal: cuando llegue por el stream se
            // fusiona en vez de duplicarse.
            if (r.mensajeId) confirmar(idTmp, { id: r.mensajeId });
            // Trae la versión real (con estado) para que el ✓ empiece a
            // moverse sin esperar al próximo ciclo.
            void sondear();
          }
        } catch {
          quitar(idTmp);
          setAviso("No se pudo enviar el mensaje. Intenta de nuevo.");
        }
      });
    },
    [empleadoId, chatId, agregarOptimista, quitar, marcar, confirmar, setModo, sondear],
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
        // La vista previa local se libera un rato después: la burbuja la sigue
        // usando hasta que llega el adjunto real, y revocarla al instante
        // dejaba la imagen rota si el stream tardaba.
        if (previa) setTimeout(() => URL.revokeObjectURL(previa), 30_000);
      };
      xhr.onload = () => {
        let r: {
          ok?: boolean;
          error?: string;
          enviado?: boolean;
          codigo?: string;
          mensajeId?: string;
          texto?: string;
          media?: MensajeUI["media"];
        } = {};
        try {
          r = JSON.parse(xhr.responseText);
        } catch {
          /* respuesta ilegible */
        }
        if (r.ok) {
          // Id, texto y adjunto reales: la burbuja temporal pasa a definitiva
          // (antes quedaban la temporal Y la real, con textos distintos).
          if (r.mensajeId) {
            confirmar(idTmp, { id: r.mensajeId, texto: r.texto ?? undefined, media: r.media ?? null });
          }
          void sondear();
        } else {
          if (!r.enviado) quitar(idTmp);
          else marcar(idTmp, { fallido: true });
          setAviso(r.error || "No se pudo enviar el archivo.");
          if (r.codigo === "ventana_cerrada") {
            setVentanaCerradaConfirmada(true);
            setPedirPlantilla((n) => n + 1);
          }
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
    [empleadoId, chatId, subiendo, agregarOptimista, quitar, marcar, confirmar, setModo, sondear],
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
          /*
            En escritorio (lg+) la columna del chat tiene alto fijo y ESTA lista
            es la que desplaza (cadena flex + min-h-0 desde PanelChat). En el
            teléfono no hay alto fijo: la lista crece y desplaza la página.
          */
          className="flex min-h-[46vh] flex-col gap-2.5 overflow-y-auto pr-1 lg:h-full lg:min-h-0"
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
          role="status"
          aria-live="polite"
          className="mt-2 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: "var(--alerta-suave)", color: "var(--alerta)" }}
        >
          {aviso}
        </div>
      )}

      <div className="mt-4">
        {/*
        COBRAR EN LA CONVERSACIÓN (26-ago-2026). Va acá y no dentro del
        compositor para no engordar un componente que ya está memoizado por
        rendimiento. El mensaje del cobro aparece en el chat por el stream.
      */}
      <div className="mb-2 flex justify-end">
        <Cobro empleadoId={empleadoId} chatId={chatId} />
      </div>
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
          rubro={rubro ?? null}
          enviarPlantilla={enviarPlantilla}
          enviandoPlantilla={enviandoPlantilla}
          pedirPlantilla={pedirPlantilla}
        />
      </div>
    </div>
  );
}
