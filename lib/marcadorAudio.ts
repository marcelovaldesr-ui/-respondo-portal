/**
 * EL MARCADOR DE AUDIO — una sola fuente de verdad.
 *
 * WAHA (lib/waha.ts) y Meta Cloud API (lib/parserMeta.ts) guardan el MISMO
 * texto fijo cuando un cliente manda un audio: hoy Tino no lo transcribe (no
 * hay ningún STT en el código, en ningún canal — se investigó a fondo el
 * 3-sep-2026 antes de este cambio). Antes cada archivo tenía su propio literal
 * "[el cliente envió un audio]" repetido a mano; ahora hay un solo lugar.
 *
 * POR QUÉ IMPORTA que sea EXACTO: lib/responderBot.ts lo usa para detectar
 * "el último mensaje del cliente es un audio" y responder por código, sin
 * pasar por el modelo (ver esa función más abajo para el porqué). Si algún
 * día alguno de los dos parsers cambia el texto sin tocar este archivo, ese
 * atajo deja de dispararse silenciosamente — por eso viven juntos acá.
 */
export const MARCADOR_AUDIO = "[el cliente envió un audio]";

/** ¿El texto guardado es EXACTAMENTE el marcador de "llegó un audio sin transcribir"? */
export function esAudioSinTexto(texto: string | null | undefined): boolean {
  return (texto ?? "").trim() === MARCADOR_AUDIO;
}
