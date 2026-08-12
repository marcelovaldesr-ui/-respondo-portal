/**
 * PRESUPUESTO DE TIEMPO DE LA FUNCIÓN SERVERLESS.
 *
 * PROBLEMA REAL (auditoría 11-ago-2026, antes de escalar a varios clientes).
 * El camino de un mensaje entrante puede pedir más tiempo del que Vercel le da:
 *
 *   debounce largo            20 s   (ventanaDeEspera: mensaje corto sin cierre)
 *   generarJSON peor caso     82.7 s (2 modelos × 2 intentos × 20 s + esperas)
 *   envío con "escribiendo…"   6 s
 *   ─────────────────────────────────
 *   total                    108.7 s   vs.  maxDuration = 60 s
 *
 * Vercel mata la función a los 60 s. Y lo mata JUSTO donde más duele: la "red
 * de seguridad" de responderBot —la que le avisa al cliente que hubo un
 * problema y deja la conversación esperando a una persona— vive DESPUÉS de la
 * llamada al modelo. Si la función muere antes, esa red nunca corre.
 *
 * O sea: la garantía de "el cliente NUNCA queda en silencio" se cae exactamente
 * en el escenario para el que fue escrita (Gemini saturado, que según el propio
 * comentario de gemini.ts es común a ciertas horas). Y se cae en silencio: no
 * hay error visible, el cliente simplemente no recibe nada.
 *
 * SOLUCIÓN: fecha límite absoluta que se calcula al entrar y se pasa hacia
 * abajo. El modelo nunca puede consumir el tiempo reservado para responderle al
 * cliente. Si no alcanza, se salta el intento y se cae a la red de seguridad
 * CON tiempo suficiente para ejecutarse.
 */

/** Techo de la función en Vercel (`export const maxDuration`) para los webhooks. */
export const MAX_FUNCION_MS = 60_000;

/**
 * Tiempo que se aparta para lo que va DESPUÉS del modelo y no se puede saltar:
 * envío del mensaje (con la espera de tipeo, hasta 6 s), guardado, y la red de
 * seguridad completa (aviso al cliente + escalación) si el modelo falló.
 * Medido con holgura: el envío por WAHA tiene timeout de 15 s.
 */
export const RESERVA_RESPUESTA_MS = 16_000;

/** Margen para el arranque de la función y el parseo del webhook. */
const MARGEN_ARRANQUE_MS = 2_000;

/**
 * Fecha límite (timestamp absoluto) hasta la que se puede llamar al modelo.
 *
 * @param inicioMs  Date.now() capturado al ENTRAR al manejador del webhook.
 */
export function fechaLimiteModelo(inicioMs: number): number {
  return inicioMs + MAX_FUNCION_MS - RESERVA_RESPUESTA_MS - MARGEN_ARRANQUE_MS;
}

/** Milisegundos que quedan hasta la fecha límite (nunca negativo). */
export function restanteMs(fechaLimite: number): number {
  return Math.max(0, fechaLimite - Date.now());
}
