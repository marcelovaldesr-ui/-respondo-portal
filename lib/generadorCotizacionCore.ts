/**
 * A QUIÉN LE TOCA UN SEGUIMIENTO DE COTIZACIÓN — reglas puras, sin base de datos.
 *
 * EL AGUJERO QUE TAPA (26-ago-2026)
 * ---------------------------------
 * Se rastrearon TODOS los puntos del código que programan un seguimiento. Eran
 * tres, y los tres dependen de una CITA o del rubro motos:
 *
 *   · `agendaSeguimientos.ts` → confirmación, recordatorio y encuesta de una cita
 *   · `generadorSeguimientos.ts` → `mantencion_toca` (motos/taller)
 *   · `clientes/acciones.ts` → `cliente_inactivo`, y solo si alguien aprieta
 *
 * **Una imprenta no agenda horas.** Impresora Color tiene 356 conversaciones y
 * ninguna cita: cotiza, produce y entrega. Resultado: Beto y Vera no le hacían
 * absolutamente nada, y las plantillas recién creadas quedaban inertes.
 *
 * Este generador usa la única señal que YA existe sin datos nuevos: **Tino marca
 * la conversación con la etiqueta `cotizacion` cuando su motor decide cotizar**,
 * y la etapa pasa a `cotizado`. Con eso alcanza para saber a quién se le cotizó
 * y quién no volvió a responder.
 *
 * ⚠️ CUESTA PLATA. `cotizacion_pendiente` es MARKETING para Meta (~$85 por
 * envío), y no se puede evitar: se probaron dos redacciones y las movió las dos
 * (ver `lib/plantillas.ts`). Por eso acá hay topes de verdad, no decorativos.
 *
 * ⚠️ SIN IMPORTS A PROPÓSITO — `node --test` puede cargarlo. Mismo patrón que
 * `generadorCore.ts`, `parserMeta.ts` y `ventana24Regla.ts`.
 */

/**
 * Días de silencio antes de insistir.
 *
 * Tres días es el mínimo razonable: antes de eso la persona todavía lo está
 * pensando y el mensaje se siente como presión. Después de treinta ya no es un
 * seguimiento de cotización — es una reactivación fría, que es otro mensaje y
 * otra conversación con el negocio.
 */
export const DIAS_MIN = 3;
export const DIAS_MAX = 30;

/** No insistir dos veces por la misma cotización. */
export const DIAS_SIN_REPETIR = 45;

/** Etiqueta que pone el motor de Tino cuando decide cotizar. */
export const ETIQUETA = "cotizacion";
/** Etapa del embudo equivalente. */
export const ETAPA = "cotizado";

export type Candidato = {
  chatId: string;
  /** Etiquetas actuales del contacto. */
  etiquetas: string[];
  etapa: string | null;
  /** Fecha del último mensaje de la conversación, venga de quien venga. */
  ultimoMensajeEn: string | null;
  /**
   * Quién habló último. Si fue el CLIENTE, no hay nada que perseguir: la pelota
   * está en la cancha del negocio, y escribirle una plantilla de reactivación a
   * alguien que acaba de preguntar algo es el peor mensaje posible.
   */
  ultimoRol: string | null;
  /** Cuándo se le mandó el último seguimiento de este tipo, si hubo. */
  ultimoSeguimientoEn?: string | null;
};

export type Veredicto =
  | { enviar: true; diasEsperando: number }
  | { enviar: false; motivo: string };

export function decidirCotizacion(
  c: Candidato,
  ahora: number = Date.now(),
): Veredicto {
  /**
   * ⚠️ `no_contactar` SE MIRA PRIMERO Y SIEMPRE.
   *
   * Es la etiqueta con la que alguien dijo «a esta persona no le escriban más».
   * Va antes que cualquier otra regla porque ninguna de las siguientes debería
   * poder pasarle por encima.
   */
  if (c.etiquetas.includes("no_contactar")) {
    return { enviar: false, motivo: "marcado como no contactar" };
  }

  const esCotizacion = c.etiquetas.includes(ETIQUETA) || c.etapa === ETAPA;
  if (!esCotizacion) return { enviar: false, motivo: "no hay cotización de por medio" };

  // Ya se cerró: ni perseguir a quien compró ni a quien dijo que no.
  if (c.etapa === "ganado" || c.etapa === "perdido") {
    return { enviar: false, motivo: `la oportunidad ya está ${c.etapa}` };
  }

  /**
   * EL CLIENTE HABLÓ ÚLTIMO → NO SE LE ESCRIBE.
   *
   * Es la regla que más protege. Si la última palabra es suya, o bien está
   * esperando respuesta del negocio —y entonces el problema es otro, y para eso
   * está el vigilante de conversaciones abandonadas— o bien ya respondió la
   * cotización. Mandarle «¿sigue en pie?» en cualquiera de los dos casos deja al
   * negocio como si no leyera lo que le escriben.
   */
  if (c.ultimoRol === "cliente") {
    return { enviar: false, motivo: "el cliente habló último: le toca al negocio" };
  }

  /**
   * ⚠️ FAIL-CLOSED (auditoría 27-ago): sin dato de quién habló último, NO se
   * envía. Este es un mensaje de MARKETING pagado; ante una anomalía de datos,
   * el error barato es no mandar. El bug de plomería que dejaba esto en null
   * para todos habría hecho que la regla anterior jamás se activara — con esta
   * barrera, ese mismo bug habría resultado en CERO envíos en vez de envíos
   * indebidos, que es exactamente el lado correcto donde fallar.
   */
  if (c.ultimoRol === null || c.ultimoRol === undefined) {
    return { enviar: false, motivo: "sin dato de quién habló último: no se arriesga" };
  }

  if (!c.ultimoMensajeEn) return { enviar: false, motivo: "sin fecha del último mensaje" };
  const t = new Date(c.ultimoMensajeEn).getTime();
  if (!Number.isFinite(t)) return { enviar: false, motivo: "fecha inválida" };

  const dias = Math.floor((ahora - t) / 86_400_000);
  if (dias < DIAS_MIN) return { enviar: false, motivo: `solo ${dias} día(s) de silencio` };
  if (dias > DIAS_MAX) {
    return { enviar: false, motivo: `${dias} días: ya es reactivación fría, no seguimiento` };
  }

  if (c.ultimoSeguimientoEn) {
    const ts = new Date(c.ultimoSeguimientoEn).getTime();
    const desde = Math.floor((ahora - ts) / 86_400_000);
    if (Number.isFinite(ts) && desde < DIAS_SIN_REPETIR) {
      return { enviar: false, motivo: `ya se le insistió hace ${desde} día(s)` };
    }
  }

  return { enviar: true, diasEsperando: dias };
}

/**
 * Cuántos se pueden mandar en esta pasada.
 *
 * ⚠️ ESTE TOPE ES SOBRE PLATA, NO SOBRE CARGA. Cada envío son ~$85. Con 134
 * cotizaciones abiertas en Impresora, una pasada sin freno serían ~$11.000 de
 * una, decididos por un cron a las tres de la mañana. El tope diario es lo que
 * convierte esto en una decisión del negocio y no en una sorpresa en la factura.
 */
export function cuposDisponibles(p: {
  topeDiario: number;
  enviadosHoy: number;
  candidatos: number;
}): number {
  const resto = Math.max(0, p.topeDiario - p.enviadosHoy);
  return Math.min(resto, p.candidatos);
}
