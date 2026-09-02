/**
 * CICLO DE VIDA DE LAS ETIQUETAS AUTOMÁTICAS.
 *
 * EL PROBLEMA (Marcelo, 2-sep-2026)
 * ---------------------------------
 * «No tiene sentido que diga "te espera" pero yo ya lo atendí, o que diga
 * "cotización" pero se cerró la venta.»
 *
 * Las etiquetas automáticas solo se SUMABAN (`etiquetasDesdeMotor` en
 * etiquetas.ts: "no borra las existentes: solo suma"). Nada las quitaba
 * nunca. Una conversación cotizada en julio seguía con "Cotización" en
 * septiembre aunque el cliente hubiera pagado, o aunque se hubiera perdido.
 * Y el filtro dejaba de servir: mezclaba lo abierto con lo muerto.
 *
 * LA REGLA
 * --------
 * Hay etiquetas que describen un ESTADO ABIERTO ("esto está en curso") y
 * otras que describen un HECHO ("esto pasó"). Las de estado abierto se
 * cierran cuando el estado termina; las de hecho se quedan.
 *
 *   abiertas: posible_comprador · cotizacion · necesita_atencion · pago_pendiente
 *   hechos:   cliente_nuevo · agendado · reclamo · cliente · resuelto (manuales)
 *
 * ⚠️ ESTE ARCHIVO NO IMPORTA NADA A PROPÓSITO: es puro y `node --test` lo
 * carga sin base ni Next (tests/etiquetas-ciclo.test.mjs).
 */

/** Etiquetas que significan "en curso". Se retiran cuando el curso termina. */
export const ETIQUETAS_ABIERTAS = [
  "posible_comprador",
  "cotizacion",
  "necesita_atencion",
  "pago_pendiente",
] as const;

const ABIERTAS = new Set<string>(ETIQUETAS_ABIERTAS);

/** ¿Hay algo que limpiar en esta lista si la conversación se cierra? */
export function tieneAbiertas(etiquetas: readonly string[]): boolean {
  return etiquetas.some((e) => ABIERTAS.has(e));
}

/**
 * Etiquetas que quedan cuando la conversación llega a una etapa terminal.
 *
 *  - ganado: se retiran las abiertas y se agrega "cliente" (compró: ese es
 *    exactamente el significado de la etiqueta manual "Cliente").
 *  - perdido: se retiran las abiertas. Que cotizó queda registrado en el
 *    embudo como Perdido; la etiqueta "Cotización" vuelve a significar
 *    "cotización abierta", que es lo útil para trabajar.
 *  - cualquier otra etapa: no se toca nada.
 *
 * Devuelve la MISMA referencia si no hay cambios, para que quien llama pueda
 * saber si vale la pena escribir en la base.
 */
export function etiquetasTrasCierre(etiquetas: readonly string[], etapa: string): string[] {
  if (etapa !== "ganado" && etapa !== "perdido") return etiquetas as string[];
  const sinAbiertas = etiquetas.filter((e) => !ABIERTAS.has(e));
  const out = etapa === "ganado" && !sinAbiertas.includes("cliente")
    ? [...sinAbiertas, "cliente"]
    : sinAbiertas;
  return iguales(out, etiquetas) ? (etiquetas as string[]) : out;
}

/**
 * Etiquetas que quedan cuando una persona atendió la derivación: se retira
 * "necesita_atencion", que es literalmente la etiqueta de la escalación
 * pendiente. "reclamo" se queda: que lo hayan atendido no dice que se
 * resolvió; eso lo marca la persona con "resuelto".
 */
export function etiquetasTrasAtencion(etiquetas: readonly string[]): string[] {
  if (!etiquetas.includes("necesita_atencion")) return etiquetas as string[];
  return etiquetas.filter((e) => e !== "necesita_atencion");
}

/** Agrega una etiqueta si no está. Misma referencia si ya estaba. */
export function conEtiqueta(etiquetas: readonly string[], valor: string): string[] {
  return etiquetas.includes(valor) ? (etiquetas as string[]) : [...etiquetas, valor];
}

/** Quita una etiqueta si está. Misma referencia si no estaba. */
export function sinEtiqueta(etiquetas: readonly string[], valor: string): string[] {
  return etiquetas.includes(valor)
    ? etiquetas.filter((e) => e !== valor)
    : (etiquetas as string[]);
}

function iguales(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
