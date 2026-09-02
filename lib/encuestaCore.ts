/**
 * ENCUESTA POSTVENTA DE VERA — reglas puras, sin red ni base de datos.
 *
 * POR QUÉ EXISTE (1-sep-2026)
 * ----------------------------
 * Dos bloqueos documentados el 26-ago valen, en palabras de la propia auditoría,
 * «más que cualquier función de Tecnom»:
 *
 *  1. NADIE cierra la cita. `cambiarEstado` en lib/agenda.ts es un botón que
 *     nadie aprieta — la cita del 4-ago de Impresora sigue en "confirmada" tres
 *     semanas después. Consecuencia: "clientes que vuelven" queda en 0% PARA
 *     SIEMPRE en el panel de fidelización (/analitica), que es la métrica que
 *     más vende (nuestro caso publicado de OdontoAndrauss es "−38% de horas
 *     perdidas por inasistencia").
 *  2. La nota 1-5 que Vera pide en su encuesta ("Nota 4-5 → agradece. Nota 1-3
 *     → escalación INMEDIATA") es hoy pura instrucción de prompt: no existe
 *     ningún campo donde esa nota se guarde, y el modelo no siempre obedece.
 *
 * LA SALIDA DECIDIDA (documentada, no inventada acá)
 * ----------------------------------------------------
 * Que Vera cierre la cita SOLA cuando el cliente contesta la encuesta con una
 * nota — nunca por el solo paso del tiempo, porque dar por "completada" toda
 * cita cuya hora pasó infla el retorno y deja la inasistencia en cero, que es
 * justo el número que queremos mostrar bien. Quien no contesta la encuesta
 * queda para el cierre manual (franja "Por cerrar" en /agenda).
 *
 * MISMO PATRÓN QUE LA CONFIRMACIÓN DE CITA (`esTextoDeConfirmacion` en
 * agendaBot.ts): un regex ANCLADO de punta a punta, no una búsqueda suelta.
 * "tuve 2 problemas con el servicio" contiene un "2", pero NO es una nota — y
 * como esto dispara escribir una fila permanente en ed_resultados y cerrar una
 * cita, se prefiere fallar-cerrado (no reconocer la nota, cae al modelo) antes
 * que adivinar mal. Quien escribe algo más largo o ambiguo lo sigue atendiendo
 * Vera normalmente; solo se pierde el atajo, no la conversación.
 *
 * ⚠️ SIN IMPORTS A PROPÓSITO — `node --test` lo carga directo. Mismo patrón que
 * `pagosCore.ts`, `pedidosCore.ts` y `generadorCotizacionCore.ts`.
 */

/**
 * Acepta el número solo, con la decoración mínima con la que la gente
 * realmente contesta un "de 1 a 5": "5", "5!", "un 4", "le doy un 5", "4/5",
 * "5 estrellas", "nota 3". Nada de texto después del número: eso ya no es
 * "solo la nota", es un comentario, y el comentario se lo dejamos al modelo.
 */
const REGEX_NOTA =
  /^\s*(?:nota\s*)?(?:le\s+doy\s+)?(?:un[ao]?\s+)?([1-5])\s*(?:\/\s*5)?\s*(?:estrellas?|⭐+|\*+)?\s*[.!]*\s*$/iu;

/**
 * ¿El texto entrante es, sin ambigüedad, una nota de 1 a 5?
 * Devuelve null si no lo es (incluye 0, 6+, o cualquier texto con más
 * contenido) — nunca adivina.
 */
export function detectarNota(texto: string): number | null {
  const t = (texto ?? "").trim();
  if (!t || t.length > 20) return null;
  const m = t.match(REGEX_NOTA);
  return m ? Number(m[1]) : null;
}

/** nota 1-3 → mala. Dispara escalación, nunca defensa del negocio. */
export function esNotaMala(nota: number): boolean {
  return nota <= 3;
}

/**
 * El mensaje que recibe el cliente al contestar. Distinto según la nota,
 * siguiendo al pie la instrucción que Vera ya tenía en el prompt (por eso el
 * texto se parece tanto al que ella misma redactaría) — la diferencia es que
 * ahora sale garantizado, no cuando al modelo "le tocó" seguir la regla.
 *
 * ⚠️ No se ofrece un link de reseña: no existe ningún campo en el negocio que
 * lo guarde (se verificó antes de escribir esto). Prometerlo sería inventar
 * información, la regla más inquebrantable del prompt de cualquier empleado.
 */
export function textoRespuestaEncuesta(nota: number): string {
  if (esNotaMala(nota)) {
    return "Gracias por contarnos, de verdad 💛 Lamento que no haya sido lo que esperabas. Ya le aviso a alguien del equipo para que te contacte.";
  }
  if (nota === 4) {
    return "¡Qué bueno saberlo! Gracias por tomarte el tiempo de contarnos 🙌";
  }
  return "¡Nos encanta leer eso! 🙌 Gracias por contarnos, se lo paso al equipo.";
}
