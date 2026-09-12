/**
 * ¿TINO TODAVÍA TIENE EL TURNO? (Fase 3)
 *
 * Una sola regla, en un solo lugar, para la pregunta que más incidentes ha
 * causado en este producto: entre que Tino empezó a pensar y el momento de
 * mandar el mensaje pasan varios segundos, y en esos segundos el mundo cambia.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. La regla estaba escrita tres veces —una por
 * transporte— y las tres copias se fueron separando: la de Instagram nunca
 * miró el modo, así que si una persona tomaba el control durante el
 * "escribiendo…", Tino hablaba encima. Es exactamente el incidente que
 * lib/inboundWaha.ts documenta como ya ocurrido en producción, repetido en
 * otro canal porque la regla se había copiado en vez de compartido.
 *
 * Las dos formas de perder el turno:
 *
 *  1. UNA PERSONA TOMÓ EL CONTROL. El modo dejó de ser "bot" (alguien
 *     respondió desde el teléfono o desde el portal, o se pausó el chat).
 *     Gana siempre la persona: Tino jamás compite con el dueño.
 *
 *  2. LLEGÓ UN MENSAJE MÁS NUEVO. La respuesta que Tino traía contestaba a un
 *     mensaje que ya quedó atrás. Otra ejecución, con el historial completo,
 *     va a contestar mejor.
 *
 * Es pura a propósito: el turno se decide con dos datos, y esos dos datos se
 * pueden poner en una tabla de pruebas. La parte que consulta la base vive en
 * cada transporte.
 */

export type EstadoTurno = {
  /** Modo del chat LEÍDO RECIÉN, no el del principio del procesamiento. */
  modo: string | null | undefined;
  /** Id del último mensaje del cliente en el chat, ahora mismo. */
  idUltimoDelCliente?: string | null;
  /** Id del mensaje que esta ejecución está respondiendo. */
  idQueRespondo?: string | null;
};

export type Veredicto = {
  conserva: boolean;
  /** Nombre estable, va a los logs y a `accion`. */
  motivo: "ok" | "modo_no_bot" | "mensaje_mas_nuevo";
};

export function evaluarTurno(e: EstadoTurno): Veredicto {
  if ((e.modo ?? "bot") !== "bot") return { conserva: false, motivo: "modo_no_bot" };

  /**
   * Sin alguno de los dos ids no se puede comparar, y entonces NO se bloquea.
   *
   * Podría parecer más seguro bloquear ante la duda, pero sería al revés: un
   * canal que no da ids (o un mensaje sin id) dejaría a Tino mudo para siempre
   * en vez de tener una carrera improbable. El modo, que es la protección que
   * de verdad importa, ya se evaluó arriba.
   */
  if (!e.idQueRespondo || !e.idUltimoDelCliente) return { conserva: true, motivo: "ok" };

  if (e.idUltimoDelCliente !== e.idQueRespondo) {
    return { conserva: false, motivo: "mensaje_mas_nuevo" };
  }
  return { conserva: true, motivo: "ok" };
}

/** Atajo para los `sigueVigente` de los transportes. */
export function conservaElTurno(e: EstadoTurno): boolean {
  return evaluarTurno(e).conserva;
}
