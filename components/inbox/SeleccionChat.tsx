"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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

type Contexto = Seleccion & {
  seleccionar: (empleadoId: string, chatId: string) => void;
  limpiar: () => void;
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
    (empleadoId: string, chatId: string) => {
      setSel({ empleadoId, chatId });
      escribirUrl(empleadoId, chatId);
    },
    [escribirUrl],
  );

  const limpiar = useCallback(() => {
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
      setSel({ empleadoId: p.get("emp") ?? "", chatId: p.get("chat") ?? "" });
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  const valor = useMemo<Contexto>(
    () => ({ ...sel, seleccionar, limpiar }),
    [sel, seleccionar, limpiar],
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
  children,
}: {
  empleadoId: string;
  chatId: string;
  href: string;
  className?: string;
  estilo?: React.CSSProperties;
  estiloActivo?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { empleadoId: selEmp, chatId: selChat, seleccionar } = useSeleccionChat();
  const activo = selEmp === empleadoId && selChat === chatId;

  const precargar = useCallback(() => {
    // `fetch` normal: la respuesta queda en la caché de la petición del panel
    // solo si el navegador la reusa, así que además se avisa al panel por su
    // propia caché en memoria a través del mismo endpoint.
    void fetch(
      `/api/conversaciones/detalle?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`,
      { priority: "low" } as RequestInit,
    ).catch(() => {});
  }, [empleadoId, chatId]);

  return (
    <a
      href={href}
      onMouseEnter={precargar}
      onFocus={precargar}
      onClick={(e) => {
        // Respetar Ctrl/Cmd/medio: la persona quiere una pestaña nueva.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        seleccionar(empleadoId, chatId);
      }}
      className={className}
      style={{ ...estilo, ...(activo ? estiloActivo : null) }}
      aria-current={activo ? "true" : undefined}
    >
      {children}
    </a>
  );
}
