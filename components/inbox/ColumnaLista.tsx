"use client";

import { useSeleccionChat } from "./SeleccionChat";

/**
 * LA COLUMNA DE LA LISTA — su visibilidad depende del cliente, no del servidor.
 *
 * ⚠️ POR QUÉ EXISTE: UNA REGRESIÓN QUE INTRODUJE Y CACÉ ANTES DE DESPLEGAR.
 *
 * En un teléfono, la lista y el chat no caben lado a lado: al abrir una
 * conversación, la lista se oculta. Eso estaba resuelto con `seleccion`, el
 * valor que calculaba el SERVIDOR desde la URL.
 *
 * Cuando pasé el cambio de conversación al lado del cliente, ese valor dejó de
 * cambiar al tocar un chat — la página ya no se vuelve a renderizar. Resultado
 * en un celular: tocabas una conversación y la lista se quedaba encima, tapando
 * justo lo que acababas de abrir.
 *
 * Es el tipo de cosa que no aparece en el escritorio, donde las dos columnas
 * conviven y todo "se ve bien".
 */
export function ColumnaLista({ children }: { children: React.ReactNode }) {
  const { chatId } = useSeleccionChat();
  const hayChat = Boolean(chatId);

  return (
    <div
      className={
        "tarjeta overflow-y-auto p-0 max-lg:max-h-[70vh] lg:h-full " +
        (hayChat ? "hidden lg:block" : "block")
      }
    >
      {children}
    </div>
  );
}
