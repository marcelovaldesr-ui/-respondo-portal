"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import InboxConversacion from "@/components/InboxConversacion";
import EtiquetasEditor from "@/components/EtiquetasEditor";
import { metaEmpleado } from "@/lib/empleados";
import { ETIQUETA_RESULTADO, ETIQUETA_TRIGGER, type DetalleConversacion } from "@/lib/conversaciones";
import { metaEtapa } from "@/lib/embudo";
import { useSeleccionChat } from "./SeleccionChat";

/**
 * LA COLUMNA DEL CHAT, DEL LADO DEL CLIENTE.
 *
 * QUÉ PROBLEMA RESUELVE (24-ago-2026)
 * -----------------------------------
 * Cambiar de conversación era lento. Cada clic navegaba a la página completa,
 * que es `force-dynamic`: el servidor rearmaba la lista de 50 chats, el resumen
 * con los conteos de las 499 y recién después el chat pedido.
 *
 * Pero lo que de verdad se sentía era otra cosa. El `loading.tsx` es del
 * segmento entero, así que en cada clic **la pantalla completa se volvía
 * esqueleto** —incluida la lista que la persona estaba mirando— y volvía. Medio
 * segundo de servidor se percibe como varios cuando todo desaparece.
 *
 * Acá el detalle se pide solo a sí mismo, y además:
 *
 *  - **Se guarda en memoria lo ya abierto.** Volver a un chat visitado es
 *    instantáneo, sin red. Es lo que hace que se sienta como una app y no como
 *    una web.
 *  - **Nunca se queda en blanco.** Mientras llega lo nuevo se muestra lo
 *    anterior atenuado. Un vacío da la sensación de que algo se rompió; un
 *    contenido que se aclara un instante, no.
 *  - **Se precarga al pasar el mouse.** Para cuando la persona hace clic, el
 *    dato suele estar. Los chats se eligen mirando: hay cientos de milisegundos
 *    gratis entre que el cursor llega y el dedo baja.
 *
 * El JSX es el MISMO que tenía la página. No se rediseñó nada acá: se movió.
 */

/** Caché por pestaña. `emp|chat` → detalle ya traído. */
const cache = new Map<string, DetalleConversacion>();

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 font-semibold uppercase"
      style={{ fontSize: "var(--t-micro)", letterSpacing: ".08em", color: "var(--muted-3)" }}
    >
      {children}
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span style={{ fontSize: "var(--t-mini)", color: "var(--muted-2)" }}>{etiqueta}</span>
      <span className="text-right font-semibold" style={{ fontSize: "var(--t-mini)" }}>
        {children}
      </span>
    </div>
  );
}

export default function PanelChat({
  inicial,
  claveInicial,
}: {
  inicial: DetalleConversacion | null;
  /** `emp|chat` de lo que vino del servidor, para sembrar la caché. */
  claveInicial: string;
}) {
  const { empleadoId, chatId } = useSeleccionChat();
  const [d, setD] = useState<DetalleConversacion | null>(inicial);
  const [cargando, setCargando] = useState(false);
  /** Evita que una respuesta lenta pise a un chat que ya se cambió. */
  const pedido = useRef(0);

  /**
   * Sembrar la caché con lo que ya vino renderizado del servidor: si la persona
   * abre un chat, se va a otro y vuelve, el primero no se vuelve a pedir.
   */
  useEffect(() => {
    if (inicial && claveInicial) cache.set(claveInicial, inicial);
  }, [inicial, claveInicial]);

  useEffect(() => {
    if (!empleadoId || !chatId) {
      setD(null);
      return;
    }
    const clave = `${empleadoId}|${chatId}`;
    const guardado = cache.get(clave);
    if (guardado) {
      setD(guardado);
      setCargando(false);
      return;
    }
    const mio = ++pedido.current;
    setCargando(true);
    fetch(`/api/conversaciones/detalle?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: DetalleConversacion | null) => {
        // Llegó tarde: la persona ya está en otro chat. Descartar.
        if (mio !== pedido.current) return;
        if (json) {
          cache.set(clave, json);
          setD(json);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mio === pedido.current) setCargando(false);
      });
  }, [empleadoId, chatId]);

  const meta = d ? metaEmpleado(d.empleadoRol) : null;
  const color = meta?.color ?? "var(--indigo)";

  return (
    /**
     * `display: contents` NO es un truco: es lo que evita un bug.
     *
     * Este componente devuelve DOS columnas de la grilla —el chat y el panel de
     * contexto— y la grilla las espera como hijas directas. Un `<div>` normal
     * las metería dentro de una sola celda y el diseño de tres columnas se
     * rompería: el contexto caería debajo del chat en vez de al lado.
     *
     * Con `contents` el envoltorio desaparece del layout y las dos vuelven a ser
     * hijas de la grilla, pero sigue existiendo para colgarle el estado de carga.
     */
    <div
      style={{
        display: "contents",
        opacity: cargando ? 0.55 : 1,
      }}
      aria-busy={cargando}
    >
    {/* Detalle — en móvil ocupa toda la pantalla; el panel vacío solo tiene
        sentido en escritorio, donde convive con la lista. */}
    <div
      className={
        "tarjeta-plana min-w-0 overflow-y-auto p-4 sm:p-5 lg:h-full " +
        (d ? "block" : "hidden lg:block")
      }
      style={{
        background: "var(--fondo)",
        // Mientras llega otro chat se atenúa en vez de quedar en blanco: un
        // vacío parece que algo se rompió; un contenido que se aclara, no.
        opacity: cargando ? 0.5 : 1,
        transition: "opacity .12s ease-out",
      }}
    >
      {d && (
        <Link
          href="/conversaciones"
          className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold lg:hidden"
          style={{ color: "var(--indigo)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver a la lista
        </Link>
      )}
      {!d ? (
        <div
          className="flex h-full min-h-[340px] flex-col items-center justify-center gap-2 text-center"
          style={{ color: "var(--muted)" }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--muted-2)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3.2A8 8 0 1 1 21 12z" />
          </svg>
          Elige una conversación para ver el chat completo.
        </div>
      ) : (
        <>
          <div
            /*
              CABECERA FIJA.

              La columna entera hace scroll, así que al bajar por una
              conversación larga el nombre del contacto se iba de la
              pantalla: terminabas escribiéndole a alguien sin ver a quién.
              En una bandeja con 101 chats abiertos eso es una forma directa
              de mandarle a Erika lo que era para Marcelo.

              Pegada arriba con el fondo del panel, para que los mensajes
              pasen por debajo sin transparentarse.
            */
            className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 pb-3 pt-1 sm:-mx-5 sm:px-5"
            style={{ borderColor: "var(--borde)", background: "var(--fondo)" }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={meta!.avatar}
                alt={d.empleadoNombre}
                width={34}
                height={34}
                className="avatar h-[34px] w-[34px]"
                style={{ ["--anillo" as string]: color }}
              />
              <div className="min-w-0">
                <div className="h-cifra truncate">{d.contacto}</div>
                <div
                  className="truncate"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                >
                  <span className="cifra">
                    {d.telefono ?? `+${d.chatId}`}
                  </span>
                  {d.etiqueta ? ` · ${d.etiqueta}` : ""}
                </div>
              </div>
            </div>

            {/* Atajo a la agenda: en el rediseño de Design está acá arriba
                porque agendar es la acción que más se dispara desde una
                conversación abierta. */}
            <Link href="/agenda" className="btn-chico shrink-0">
              Agendar hora
            </Link>
          </div>

          {d.escalacion && (
            <div
              className="mt-4 rounded-xl border p-4"
              style={{
                borderColor: "var(--alerta-borde)",
                background: "var(--alerta-suave)",
              }}
            >
              <div className="text-[13.5px] font-bold" style={{ color: "var(--alerta)" }}>
                {ETIQUETA_TRIGGER[d.escalacion.trigger] ?? "Derivada a tu equipo"}
                {d.escalacion.atendida ? " · ya atendida" : " · te espera"}
              </div>
              <p className="mt-1 text-[14px]">{d.escalacion.resumen}</p>
            </div>
          )}

          {/* Inbox en vivo: control (tomar/devolver) + mensajes + responder manual */}
          <InboxConversacion
            empleadoId={empleadoId!}
            chatId={d.chatId}
            empleadoNombre={d.empleadoNombre}
            ventana={d.ventana}
            /*
              Se pasa el mensaje COMPLETO (id, adjunto y estado de entrega).
              Antes se recortaba a rol/texto/fecha, así que la primera
              pintada no tenía ni claves estables ni imágenes: las fotos
              aparecían recién cuando el refresco reemplazaba la lista.
            */
            mensajesIniciales={d.mensajes}
            modoInicial={d.modo}
            contacto={d.contacto}
          />
        </>
      )}
    </div>

    {/*
      COLUMNA DE CONTEXTO — quién atiende, cómo está clasificada y qué
      historia tiene esta persona con el negocio.

      Todo sale de ed_contactos, que desde la migración 250 mantiene el total
      de mensajes y la fecha del primero por trigger. Sin eso, mostrar
      "cliente desde" habría obligado a buscar el mensaje más antiguo del
      chat cada vez que se abre una conversación.
    */}
    {d && (
      <aside className="hidden min-w-0 flex-col gap-3 overflow-y-auto xl:flex xl:h-full">
        <div className="tarjeta p-3.5">
          <Rotulo>Quién atiende</Rotulo>
          <div className="mt-2 flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={meta!.avatar}
              alt=""
              width={30}
              height={30}
              className="avatar h-[30px] w-[30px]"
              style={{ ["--anillo" as string]: color }}
            />
            <div className="min-w-0">
              <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                {d.empleadoNombre}
              </div>
              <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                {d.modo === "humano"
                  ? "en silencio · tú tienes el control"
                  : d.modo === "pausado"
                    ? "pausado"
                    : "respondiendo"}
              </div>
            </div>
          </div>
        </div>

        <div className="tarjeta p-3.5">
          <Rotulo>Etiquetas</Rotulo>
          <EtiquetasEditor chatId={d.chatId} etiquetas={d.etiquetas} />
        </div>

        <div className="tarjeta p-3.5">
          <Rotulo>Contexto</Rotulo>
          <dl className="mt-2 space-y-1.5">
            <Dato etiqueta="Etapa">
              {(() => {
                const e = metaEtapa(d.etapa);
                return (
                  <span className="pildora" style={{ background: e.fondo, color: e.color }}>
                    {e.label}
                  </span>
                );
              })()}
            </Dato>
            <Dato etiqueta="Mensajes">
              <span className="cifra">{d.mensajesTotal}</span>
            </Dato>
            {/* Un contacto anterior al trigger de la 250 puede no tener
                primer mensaje registrado. Se omite la fila en vez de
                mostrar una fecha inventada o un guion sin explicación. */}
            {d.clienteDesde && (
              <Dato etiqueta="Cliente desde">
                {/* Solo la fecha: la hora exacta en que alguien escribió por
                    primera vez hace meses no le sirve a nadie. */}
                <span className="cifra">
                  {new Intl.DateTimeFormat("es-CL", {
                    timeZone: "America/Santiago",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(d.clienteDesde))}
                </span>
              </Dato>
            )}
            {d.ventana !== "desconocida" && (
              <Dato etiqueta="Ventana 24 h">
                <span
                  className="pildora"
                  style={
                    d.ventana === "abierta"
                      ? { background: "var(--ok-suave)", color: "var(--ok)" }
                      : { background: "var(--fondo-hundido)", color: "var(--muted)" }
                  }
                >
                  {d.ventana === "abierta" ? "Abierta" : "Cerrada"}
                </span>
              </Dato>
            )}
          </dl>
        </div>

        {d.resultados.length > 0 && (
          <div className="tarjeta p-3.5">
            <Rotulo>Resultados</Rotulo>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.resultados.map((r, i) => (
                <span key={`${r}-${i}`} className="pildora-ok">
                  {ETIQUETA_RESULTADO[r] ?? r}
                </span>
              ))}
            </div>
          </div>
        )}

        {d.notas && (
          <div className="tarjeta p-3.5">
            <Rotulo>Nota interna</Rotulo>
            <p
              className="mt-2 whitespace-pre-wrap"
              style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
            >
              {d.notas}
            </p>
            {/* Se dice explícito porque es la duda que aparece siempre: si
                el cliente puede leer esto. */}
            <p className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>
              Solo la ve tu equipo. El cliente nunca la lee.
            </p>
          </div>
        )}

        <Link
          href={`/clientes/${d.chatId}`}
          className="btn-suave w-full justify-center"
        >
          Ver ficha completa →
        </Link>
      </aside>
    )}
    </div>
  );
}
