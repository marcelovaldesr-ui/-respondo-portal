"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import InboxConversacion from "@/components/InboxConversacion";
import EtiquetasEditor from "@/components/EtiquetasEditor";
import { metaEmpleado } from "@/lib/empleados";
import { ETIQUETA_RESULTADO, ETIQUETA_TRIGGER, type DetalleConversacion } from "@/lib/conversaciones";
import { metaEtapa } from "@/lib/embudo";
import { useSeleccionChat } from "./SeleccionChat";
import { clave as claveDe, guardar, leer, olvidar, traer } from "./cacheDetalle";
import { AvisarPedido, PagosCard } from "./PagosCard";

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

/**
 * ESQUELETO DE LOS MENSAJES.
 *
 * Ocupa el lugar de la conversación mientras llega, con burbujas alternadas del
 * ancho aproximado de un mensaje real. No es decoración: sin algo acá, la
 * cabecera quedaría flotando sobre un vacío y parecería un chat sin mensajes en
 * vez de un chat cargando.
 *
 * `animate-pulse` es de Tailwind y no necesita configuración.
 */
function EsqueletoMensajes() {
  // Anchos distintos a propósito: bloques iguales se leen como una tabla rota.
  const filas: [boolean, string][] = [
    [false, "62%"], [true, "45%"], [false, "78%"], [true, "38%"],
    [false, "55%"], [true, "68%"], [false, "42%"],
  ];
  return (
    <div className="mt-4 animate-pulse space-y-3" aria-hidden="true">
      {filas.map(([propio, ancho], i) => (
        <div key={i} className={"flex " + (propio ? "justify-end" : "justify-start")}>
          <div
            className="rounded-2xl"
            style={{
              width: ancho,
              height: i % 3 === 0 ? 46 : 32,
              background: propio ? "var(--indigo-suave)" : "var(--fondo-hundido)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Mismo papel que el anterior, para que la columna de contexto no se mueva. */
function EsqueletoContexto() {
  return (
    <div className="animate-pulse space-y-3" aria-hidden="true">
      {[92, 78, 148].map((alto, i) => (
        <div
          key={i}
          className="rounded-xl"
          style={{ height: alto, background: "var(--fondo-hundido)" }}
        />
      ))}
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
  const { empleadoId, chatId, limpiar, adelanto } = useSeleccionChat();

  /**
   * ⚠️ EL DETALLE SE GUARDA JUNTO A LA CLAVE DE A QUIÉN PERTENECE. NO SEPARARLOS.
   *
   * Guardar solo el detalle abre un agujero de un fotograma, y es un agujero
   * grave. Al hacer clic en otra conversación, el estado de selección cambia y
   * React vuelve a dibujar ENSEGUIDA; el efecto que carga el detalle corre
   * DESPUÉS de esa pintada. En ese hueco quedaba en pantalla la mezcla peor
   * posible: la cabecera del chat nuevo sobre los mensajes del anterior.
   *
   * Peor todavía, la `key` de `InboxConversacion` se armaba con el empleado
   * nuevo y el chat viejo, o sea una combinación que no existe.
   *
   * Con la clave adentro del estado, `d` se calcula: si lo cargado no es de la
   * conversación que está abierta AHORA, vale null. No hay fotograma posible en
   * el que se vean dos chats mezclados, porque no depende de cuándo corra un
   * efecto.
   */
  const [cargado, setCargado] = useState<{ clave: string; d: DetalleConversacion } | null>(
    inicial && claveInicial ? { clave: claveInicial, d: inicial } : null,
  );
  const claveActual = empleadoId && chatId ? claveDe(empleadoId, chatId) : "";
  const d = cargado && cargado.clave === claveActual ? cargado.d : null;
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  /** Cambiarlo vuelve a disparar el efecto de carga sin tocar la selección. */
  const [reintento, setReintento] = useState(0);
  /** Evita que una respuesta lenta pise a un chat que ya se cambió. */
  const pedido = useRef(0);

  /**
   * Sembrar la caché con lo que ya vino renderizado del servidor: si la persona
   * abre un chat, se va a otro y vuelve, el primero no se vuelve a pedir.
   */
  useEffect(() => {
    if (inicial && claveInicial) guardar(claveInicial, inicial);
  }, [inicial, claveInicial]);

  useEffect(() => {
    if (!empleadoId || !chatId) {
      setCargado(null);
      return;
    }
    const k = claveDe(empleadoId, chatId);
    const mio = ++pedido.current;
    /** Guarda atando el detalle a ESTA conversación, nunca a "la actual". */
    const poner = (v: DetalleConversacion) => setCargado({ clave: k, d: v });

    /**
     * CAMINO RÁPIDO: ya lo tenemos. Cero red, cero espera.
     *
     * Se lee de forma SÍNCRONA —no dentro de una promesa— a propósito: así el
     * chat aparece en la misma pintada del clic. Metido en un `.then()`, aunque
     * la promesa ya esté resuelta, se iría al siguiente ciclo y se vería un
     * parpadeo de esqueleto por nada.
     */
    const guardado = leer(k);
    if (guardado) {
      poner(guardado);
      setCargando(false);
      setFallo(false);

      /**
       * Y ADEMÁS SE REFRESCA POR DETRÁS (stale-while-revalidate).
       *
       * Lo guardado puede tener la etapa, las etiquetas o la nota internas de
       * hace un rato. Los MENSAJES no importan —el stream en vivo los pone al
       * día solo— pero el panel de contexto sí, y ahí un dato viejo se cree.
       *
       * La persona ve el chat al instante y el panel se corrige solo un momento
       * después. Nunca hay pantalla en blanco esperando esto.
       */
      void traer(empleadoId, chatId, { forzar: true }).then((fresco) => {
        if (fresco && mio === pedido.current) poner(fresco);
      });
      return;
    }

    /**
     * ⚠️ NO HACE FALTA BORRAR LO ANTERIOR: YA NO SE VE.
     *
     * `d` se deriva comparando la clave de lo cargado con la conversación
     * abierta, así que al cambiar de chat lo viejo deja de mostrarse solo, en la
     * misma pintada, sin depender de que este efecto alcance a correr.
     *
     * Antes acá se dejaba a propósito la conversación anterior en pantalla,
     * atenuada, "para que no quedara en blanco". Pero eso es mostrar los
     * mensajes de un cliente bajo el nombre y la URL de OTRO: alguien podía leer
     * —o responder— creyendo que estaba en el chat que acababa de abrir.
     *
     * En ese hueco ahora va la cabecera de verdad (que la lista ya conocía) y un
     * esqueleto donde irán los mensajes. Se ve mejor Y es correcto.
     */
    setCargando(true);
    setFallo(false);

    void traer(empleadoId, chatId)
      .then((json) => {
        // Llegó tarde: la persona ya está en otro chat. Descartar.
        if (mio !== pedido.current) return;
        if (json) poner(json);
        else setFallo(true);
      })
      .finally(() => {
        if (mio === pedido.current) setCargando(false);
      });
    // `reintento` está en las dependencias a propósito: es lo que
    // permite volver a pedir sin cambiar de conversación.
  }, [empleadoId, chatId, reintento]);

  /** Reintento manual tras un fallo de carga. */
  const reintentar = () => {
    olvidar(claveDe(empleadoId, chatId));
    setFallo(false);
    setReintento((n) => n + 1);
  };

  if (fallo) {
    return (
      <div className="tarjeta-plana flex min-h-[320px] flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-[15px] font-bold">No se pudo abrir la conversación</div>
        <p className="text-[13.5px]" style={{ color: "var(--muted)" }}>
          Puede haber sido un corte de conexión. Nada se perdió.
        </p>
        <button onClick={reintentar} className="btn-primario px-4 py-2 text-[13.5px]">
          Reintentar
        </button>
      </div>
    );
  }

  /**
   * QUÉ SE DIBUJA MIENTRAS LLEGAN LOS MENSAJES.
   *
   * Si hay detalle, manda el detalle. Si no, mandan los datos de la fila que se
   * tocó: el nombre del contacto, quién atiende y su color ya estaban en
   * pantalla en la lista, así que la cabecera puede pintarse **en el mismo
   * fotograma del clic**, sin una sola petición.
   *
   * Lo único que espera es la lista de mensajes, que es lo único que la fila de
   * verdad no sabe.
   */
  const rolVisible = d?.empleadoRol ?? adelanto?.empleadoRol ?? null;
  const meta = rolVisible ? metaEmpleado(rolVisible) : null;
  const color = meta?.color ?? "var(--indigo)";
  const contactoVisible = d?.contacto ?? adelanto?.contacto ?? "";
  const empleadoVisible = d?.empleadoNombre ?? adelanto?.empleadoNombre ?? "";
  const modoVisible = d?.modo ?? adelanto?.modo ?? "bot";
  /** Hay conversación abierta: con detalle completo o solo con el adelanto. */
  const hayChat = Boolean(d) || Boolean(adelanto && empleadoId && chatId);

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
      style={{ display: "contents" }}
      aria-busy={cargando}
    >
    {/* Detalle — en móvil ocupa toda la pantalla; el panel vacío solo tiene
        sentido en escritorio, donde convive con la lista. */}
    <div
      className={
        "tarjeta-plana min-w-0 overflow-y-auto p-4 sm:p-5 lg:h-full " +
        (hayChat ? "block" : "hidden lg:block")
      }
      style={{ background: "var(--fondo)" }}
    >
      {hayChat && (
        /*
          VOLVER A LA LISTA, en móvil.

          Era un <Link> a /conversaciones, o sea una navegación completa al
          servidor solo para cerrar el chat abierto. Ahora limpia la selección
          en el cliente: instantáneo, y la lista sigue montada tal como estaba,
          con el mismo scroll y los mismos filtros.
        */
        <button
          type="button"
          onClick={limpiar}
          className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold lg:hidden"
          style={{ color: "var(--indigo)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver a la lista
        </button>
      )}
      {!hayChat ? (
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
              {meta && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={meta.avatar}
                  alt={empleadoVisible}
                  width={34}
                  height={34}
                  className="avatar h-[34px] w-[34px]"
                  style={{ ["--anillo" as string]: color }}
                />
              )}
              <div className="min-w-0">
                <div className="h-cifra truncate">{contactoVisible}</div>
                <div
                  className="truncate"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                >
                  {/*
                    El teléfono y la etiqueta solo los sabe el detalle. Mientras
                    llega se deja el hueco con el alto exacto de esa línea, para
                    que al aparecer el texto no empuje la cabecera hacia abajo:
                    un salto acá mueve toda la conversación bajo el cursor.
                  */}
                  {d ? (
                    <>
                      <span className="cifra">{d.telefono ?? `+${d.chatId}`}</span>
                      {d.etiqueta ? ` · ${d.etiqueta}` : ""}
                    </>
                  ) : (
                    <span className="cifra" style={{ opacity: 0.45 }}>
                      +{chatId}
                    </span>
                  )}
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

          {d?.escalacion && (
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
          {/*
            ⚠️ LA `key` NO ES DECORATIVA: SIN ELLA EL CHAT NO CAMBIA.
            
            `InboxConversacion` guarda los mensajes en `useState`, y **useState
            solo lee su valor inicial en el PRIMER render**. Al cambiar de
            conversación, React ve el mismo componente en la misma posición del
            árbol y REUSA la instancia: las props nuevas llegan, pero el estado
            —los mensajes, el cursor de "hasta dónde leí", el modo— sigue siendo
            el del chat anterior.
            
            En pantalla eso era exactamente lo que se veía: tocabas otro chat y
            seguían los mensajes del primero hasta recargar la página.
            
            Con una `key` distinta por conversación, React DESMONTA y vuelve a
            montar: estado limpio, cursor nuevo y el stream reabierto donde
            corresponde.
            
            Es un bug que introduje al pasar el cambio de chat al lado del
            cliente. Antes cada clic recargaba la página entera, así que el
            remontaje ocurría solo y esto nunca se notó.
          */}
          {!d ? (
            <EsqueletoMensajes />
          ) : (
          <InboxConversacion
            key={`${empleadoId}|${d.chatId}`}
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
            rubro={d.rubro}
          />
          )}
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
    {/*
      ⚠️ SE DIBUJA CON `hayChat`, NO CON `d`.

      Al vaciar `d` para no mostrar la conversación anterior, esta columna
      desaparecía y volvía en cada cambio de chat. En una grilla de tres
      columnas eso NO es que se vea un hueco: las otras dos se ensanchan y se
      vuelven a angostar, o sea la conversación entera salta de lugar bajo el
      cursor justo cuando la persona va a leer.

      Con el adelanto, "quién atiende" ya se puede pintar de verdad, y lo que
      todavía no sabemos va como esqueleto ocupando su lugar.
    */}
    {hayChat && (
      <aside className="hidden min-w-0 flex-col gap-3 overflow-y-auto xl:flex xl:h-full">
        <div className="tarjeta p-3.5">
          <Rotulo>Quién atiende</Rotulo>
          <div className="mt-2 flex items-center gap-2.5">
            {meta && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={meta.avatar}
                alt=""
                width={30}
                height={30}
                className="avatar h-[30px] w-[30px]"
                style={{ ["--anillo" as string]: color }}
              />
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                {empleadoVisible}
              </div>
              <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                {modoVisible === "humano"
                  ? "en silencio · tú tienes el control"
                  : modoVisible === "pausado"
                    ? "pausado"
                    : "respondiendo"}
              </div>
            </div>
          </div>
        </div>

        {!d ? (
          <EsqueletoContexto />
        ) : (
        <>
        <div className="tarjeta p-3.5">
          <Rotulo>Etiquetas</Rotulo>
          <EtiquetasEditor chatId={d.chatId} etiquetas={d.etiquetas} />
        </div>

        {/* Cobros del chat (migración 289). La tarjeta no se dibuja si no hay. */}
        <PagosCard pagos={d.pagos} />

        {/* Aviso de pedido listo: solo rubros que entregan (imprenta/tienda). */}
        {d.puedeAvisarPedido && (
          <AvisarPedido empleadoId={empleadoId!} chatId={d.chatId} />
        )}

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
        </>
        )}
      </aside>
    )}
    </div>
  );
}
