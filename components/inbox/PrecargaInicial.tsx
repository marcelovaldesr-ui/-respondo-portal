"use client";

import { useEffect } from "react";
import { precargarLista } from "./cacheDetalle";

/**
 * ADELANTA LAS PRIMERAS CONVERSACIONES DE LA LISTA.
 *
 * QUÉ AGUJERO TAPA
 * ----------------
 * La precarga al pasar el mouse cubre el segundo clic en adelante, pero deja
 * fuera los dos casos que más importan:
 *
 *  1. **El primer clic.** Nadie pasa el cursor por encima antes de decidir a
 *     cuál entrar: se mira la lista y se hace clic. Ese primer chat —que casi
 *     siempre es el de arriba, el más reciente— esperaba entero.
 *  2. **El teléfono.** No hay mouse que pasar por encima. En un celular la
 *     precarga por hover simplemente no existe, y es justo donde la conexión es
 *     peor.
 *
 * Traer las primeras mientras el navegador está desocupado hace que la mayoría
 * de los primeros clics ya no esperen nada. Es lo que hace WhatsApp Web al
 * abrir: cuando llegas, las recientes ya están.
 *
 * No pinta nada: existe solo por el efecto.
 */
export default function PrecargaInicial({
  filas,
}: {
  filas: { empleadoId: string; chatId: string }[];
}) {
  useEffect(() => {
    precargarLista(filas);
    // Solo al montar: si la lista cambia por un filtro, la persona ya está
    // mirando otra cosa y adelantar trabajo ahí compite con lo que pidió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
