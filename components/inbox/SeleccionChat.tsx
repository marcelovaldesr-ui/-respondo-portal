"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { traer } from "./cacheDetalle";

/**
 * QUÉ CONVERSACIÓN ESTÁ ABIERTA — del lado del cliente.
 *
 * Antes esto vivía en la URL y solo en la URL: cada clic en la lista era una
 * navegación completa a una página `force-dynamic`, y el `loading.tsx` del
 * segmento tapaba **toda la pantalla** mientras el servidor rearmaba también la
 * lista y el resumen que no habían cambiado.
 *
 * Ahora la selección es estado del navegador y la URL se actualiza con
 * `history.pushState`, sin recargar nada.
 *
 * DOS COSAS QUE NO SE PIERDEN, Y QUE SON LA RAZÓN DE USAR pushState EN VEZ DE
 * GUARDAR EL ESTADO A SECAS:
 *
 *  1. **El enlace se puede compartir y recargar.** Si alguien manda "mira esta
 *     conversación", el que la abre cae en el chat correcto.
 *  2. **Atrás y adelante del navegador funcionan.** Es lo primero que la gente
 *     prueba, y romperlo se siente como una app rota aunque todo lo demás ande.
 */

type Seleccion = { empleadoId: string; chatId: string };

/**
 * LO QUE LA LISTA YA SABE DE UNA CONVERSACIÓN, ANTES DE PEDIR NADA.
 *
 * La fila de la lista ya trae en pantalla el nombre del contacto, quién atiende
 * y en qué modo está. Son exactamente los datos de la cabecera del chat.
 *
 * Pasarlos al hacer clic permite dibujar la cabecera **en el mismo fotograma
 * del toque**, sin esperar al servidor. Lo único que queda cargando son los
 * mensajes, que es lo único que la lista de verdad no tiene.
 *
 * Esto no acelera la red: hace que la pantalla RESPONDA. Es la diferencia entre
 * "tocué y no pasó nada" y "ya estoy en el chat, faltan los mensajes".
 */
export type Adelanto = {
  contacto: string;
  empleadoNombre: string;
  empleadoRol: string;
  modo: string;
};

type Contexto = Seleccion & {
  seleccionar: (empleadoId: string, chatId: string, adelanto?: Adelanto) => void;
  limpiar: () => void;
  /** Datos de la fila del chat elegido, para pintar antes de que llegue el detalle. */
  adelanto: Adelanto | null;
};

const Ctx = createContext<Contexto | null>(null);

export function useSeleccionChat(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSeleccionChat fuera de <SeleccionChatProvider>");
  return c;
}

export function SeleccionChatProvider({
  empleadoIdInicial,
  chatIdInicial,
  children,
}: {
  empleadoIdInicial: string;
  chatIdInicial: string;
  children: React.ReactNode;
}) {
  const [sel, setSel] = useState<Seleccion>({
    empleadoId: empleadoIdInicial,
    chatId: chatIdInicial,
  });
  const [adelanto, setAdelanto] = useState<Adelanto | null>(null);

  const escribirUrl = useCallback((empleadoId: string, chatId: string) => {
    const url = new URL(window.location.href);
    if (empleadoId && chatId) {
      url.searchParams.set("emp", empleadoId);
      url.searchParams.set("chat", chatId);
    } else {
      url.searchParams.delete("emp");
      url.searchParams.delete("chat");
    }
    window.history.pushState({ emp: empleadoId, chat: chatId }, "", url.toString());
  }, []);

  const seleccionar = useCallback(
    (empleadoId: string, chatId: string, datos?: Adelanto) => {
      setAdelanto(datos ?? null);
      setSel({ empleadoId, chatId });
      escribirUrl(empleadoId, chatId);
    },
    [escribirUrl],
  );

  const limpiar = useCallback(() => {
    setAdelanto(null);
    setSel({ empleadoId: "", chatId: "" });
    escribirUrl("", "");
  }, [escribirUrl]);

  /**
   * Atrás y adelante del navegador. Sin esto, `pushState` deja un historial que
   * el navegador recorre sin que la pantalla cambie: se aprieta atrás, la URL
   * retrocede y el chat sigue siendo el mismo. Peor que no tener historial.
   */
  useEffect(() => {
    const alVolver = () => {
      const p = new URLSearchParams(window.location.search);
      // El adelanto pertenece a la fila que se tocó; al volver con "atrás" no
      // hubo clic, así que mostrarlo sería pintar la cabecera de otro chat.
      setAdelanto(null);
      setSel({ empleadoId: p.get("emp") ?? "", chatId: p.get("chat") ?? "" });
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  const valor = useMemo<Contexto>(
    () => ({ ...sel, seleccionar, limpiar, adelanto }),
    [sel, seleccionar, limpiar, adelanto],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/**
 * Una fila de la lista de conversaciones.
 *
 * Sigue siendo un `<a href>` de verdad —para que "abrir en pestaña nueva",
 * copiar el enlace y los lectores de pantalla funcionen— pero el clic normal se
 * intercepta y no navega.
 *
 * **Precarga al pasar el mouse.** Los chats se eligen mirando: entre que el
 * cursor llega a la fila y el dedo baja hay cientos de milisegundos. Pedir el
 * detalle en ese hueco hace que el clic se sienta instantáneo aunque el
 * servidor tarde lo mismo de siempre.
 */
export function FilaChat({
  empleadoId,
  chatId,
  href,
  className,
  estilo,
  estiloActivo,
  adelanto,
  children,
}: {
  empleadoId: string;
  chatId: string;
  href: string;
  className?: string;
  estilo?: React.CSSProperties;
  estiloActivo?: React.CSSProperties;
  /** Lo que esta fila ya sabe, para pintar la cabecera sin esperar al servidor. */
  adelanto?: Adelanto;
  children: React.ReactNode;
}) {
  const { empleadoId: selEmp, chatId: selChat, seleccionar } = useSeleccionChat();
  const activo = selEmp === empleadoId && selChat === chatId;

  /**
   * ⚠️ ANTES ESTO NO SERVÍA PARA NADA.
   *
   * La versión anterior hacía un `fetch` suelto y **tiraba la respuesta**: no la
   * guardaba en ningún lado, y el endpoint responde `Cache-Control: no-store`,
   * así que el navegador tampoco la conservaba. Al hacer clic se volvía a pedir
   * todo desde cero. Lo único que lograba era calentar la función de Vercel.
   *
   * Ahora `traer` guarda en la misma caché que lee el panel, así que el trabajo
   * adelantado se aprovecha de verdad.
   */
  const precargar = useCallback(() => {
    void traer(empleadoId, chatId);
  }, [empleadoId, chatId]);

  return (
    <a
      href={href}
      onMouseEnter={precargar}
      onFocus={precargar}
      /**
       * `pointerdown` dispara ANTES que `click`: en escritorio adelanta el
       * trayecto del botón. SOLO con mouse: en el teléfono, cada dedo que
       * apoya para hacer scroll también es un pointerdown, y desplazar la
       * lista disparaba una petición por fila tocada (auditoría 3-sep-2026).
       * Ahí alcanza con el clic; la precarga inicial ya cubre las de arriba.
       */
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") precargar();
      }}
      onClick={(e) => {
        // Respetar Ctrl/Cmd/medio: la persona quiere una pestaña nueva.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        seleccionar(empleadoId, chatId, adelanto);
      }}
      className={className}
      style={{ ...estilo, ...(activo ? estiloActivo : null) }}
      aria-current={activo ? "true" : undefined}
    >
      {children}
    </a>
  );
}
