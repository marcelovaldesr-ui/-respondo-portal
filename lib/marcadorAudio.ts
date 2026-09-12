/**
 * EL MARCADOR DE AUDIO — una sola fuente de verdad.
 *
 * Los tres transportes —Meta (lib/parserMeta.ts), WAHA (lib/waha.ts) e Instagram
 * (lib/instagram.ts)— guardan el MISMO texto fijo cuando un cliente manda un
 * audio. Tino no lo transcribe: en la Fase 3 se construyó la transcripción, se
 * evaluó y se retiró (informe de la fase, sección AF). Antes cada archivo tenía
 * su propio literal repetido a mano; ahora hay un solo lugar.
 *
 * POR QUÉ IMPORTA: lib/responderBot.ts necesita reconocer "el último mensaje
 * del cliente es un audio" para derivarlo a una persona sin pasar por el
 * modelo. Esa detección vive abajo, en `esAudioDelCliente`, y mira el TIPO del
 * archivo antes que el texto — el marcador quedó como respaldo. Los dos viven
 * acá, junto a los transportes que los escriben, porque una divergencia entre
 * ellos deja de disparar el atajo EN SILENCIO.
 */
export const MARCADOR_AUDIO = "[el cliente envió un audio]";

/** ¿El texto guardado es EXACTAMENTE el marcador de "llegó un audio sin transcribir"? */
export function esAudioSinTexto(texto: string | null | undefined): boolean {
  return (texto ?? "").trim() === MARCADOR_AUDIO;
}

/**
 * ¿Este mensaje del cliente es una nota de voz que Tino NO puede leer?
 *
 * Dos señales, y con cualquiera basta:
 *
 *  · `mediaTipo === "audio"` — el dato estructural (columna `media_tipo`,
 *    migración 270). Es el bueno: no depende de cómo quedó armado el texto.
 *  · el marcador exacto — para los mensajes viejos de Instagram, que se
 *    guardaron sin `media_tipo` porque el canal recién lo empezó a informar
 *    en la Fase 3.
 *
 * POR QUÉ NO ALCANZA EL MARCADOR SOLO. En la Fase 3 se corrigió que el pie de
 * foto dejara de borrar el marcador del adjunto. A partir de ahí, un canal que
 * entregue texto junto a un audio guardaría «[el cliente envió un audio] …» y
 * la comparación exacta devolvería `false` sin que nadie se entere: Tino
 * contestaría un audio que no escuchó. Es el peor fallo posible de la fase, y
 * por eso la detección mira el tipo del archivo y no la forma del texto.
 */
export function esAudioDelCliente(m: {
  mediaTipo?: string | null;
  texto?: string | null;
}): boolean {
  return m.mediaTipo === "audio" || esAudioSinTexto(m.texto);
}
