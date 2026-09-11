/**
 * DECISIONES PURAS DE LA COLA DE SEGUIMIENTOS (Fase 0, 11-sep-2026).
 *
 * Sin base de datos: reciben datos y devuelven qué hacer con una fila. Viven
 * aparte de lib/seguimientos.ts para poder probarlas sin red.
 *
 * Dos problemas reales que resuelven:
 *  1. COLA ATASCADA. Una fila que no puede salir y queda "pendiente" con su
 *     `programado_para` en el pasado vuelve a ser de las más viejas en cada
 *     pasada. Suficientes filas así tapaban los recordatorios de TODOS los
 *     negocios. Ahora toda fila que no sale se reprograma hacia adelante o se
 *     descarta con motivo: nunca queda estancada al frente.
 *  2. MENSAJES A DESTIEMPO. El motor solo envía de 10:00 a 18:59 y no miraba si
 *     la cita ya había pasado: "Te esperamos hoy a las 09:00" llegaba a las
 *     10:00. Un recordatorio vencido se descarta; nunca se manda tarde.
 */
import { fechaChileDe, horaChileAUtc } from "@/lib/agendaCore";

/**
 * Columna (ruta JSON) que marca una fila de ed_seguimientos como DESCARTADA.
 *
 * `descartar()` cierra la fila poniendo `enviado_en` (para que salga de la cola)
 * y `variables.descartado = motivo`. Por eso "enviado_en no nulo" NO significa
 * "le llegó al cliente": toda consulta que cuente envíos reales, rutee
 * respuestas o muestre "mensaje enviado" tiene que filtrar además
 * `.is(COL_DESCARTADO, null)`.
 *
 * Límite conocido: las filas `no_contactar` cerradas ANTES del 11-sep-2026 no
 * tienen la marca y siguen pareciendo envíos.
 */
export const COL_DESCARTADO = "variables->>descartado";

export const TIPOS_DE_CITA = new Set(["confirmacion_cita", "recordatorio_cita", "encuesta_postventa"]);

/** Horas mínimas antes de la cita para que una confirmación "de mañana" tenga sentido. */
export const CONFIRMACION_MIN_HORAS = 12;
/** Un recordatorio que saldría con menos de esto de anticipación ya no sirve. */
export const RECORDATORIO_MIN_MIN = 15;
/** Una encuesta después de esto ya no es "de hoy". */
export const ENCUESTA_MAX_HORAS = 20;
/** Un texto libre que espera la ventana de 24 h no espera para siempre. */
export const POSPUESTO_MAX_DIAS = 7;
/** Cada cuánto se vuelve a mirar una fila pospuesta por ventana cerrada. */
export const POSPUESTO_REINTENTO_MIN = 120;

export type CitaVigencia = { estado: string; inicio: string; fin: string } | null;

export type Vigencia = { vigente: true } | { vigente: false; motivo: string };

const CITA_CERRADA = new Set(["cancelada", "no_show"]);

/** ¿Tiene sentido todavía enviar este seguimiento ligado a una cita? */
export function vigenciaDeCita(tipo: string, cita: CitaVigencia, ahora: Date): Vigencia {
  if (!TIPOS_DE_CITA.has(tipo)) return { vigente: true };
  if (!cita) return { vigente: false, motivo: "cita no encontrada" };
  const t = ahora.getTime();
  const inicio = Date.parse(cita.inicio);
  const fin = Date.parse(cita.fin);
  if (tipo === "encuesta_postventa") {
    if (CITA_CERRADA.has(cita.estado)) return { vigente: false, motivo: `cita ${cita.estado}` };
    if (Number.isFinite(fin) && t - fin > ENCUESTA_MAX_HORAS * 3600_000) {
      return { vigente: false, motivo: "encuesta vencida" };
    }
    return { vigente: true };
  }
  if (CITA_CERRADA.has(cita.estado) || cita.estado === "completada") {
    return { vigente: false, motivo: `cita ${cita.estado}` };
  }
  if (tipo === "confirmacion_cita" && inicio - t < CONFIRMACION_MIN_HORAS * 3600_000) {
    return { vigente: false, motivo: "confirmación tardía (ya corresponde el recordatorio)" };
  }
  if (tipo === "recordatorio_cita" && inicio - t < RECORDATORIO_MIN_MIN * 60_000) {
    return { vigente: false, motivo: "la cita ya empezó o está por empezar" };
  }
  return { vigente: true };
}

/** Próximo día hábil de envío a las 10:00 de Chile (el tope diario es por día). */
export function manana10Chile(ahora: Date): Date {
  const hoy = fechaChileDe(ahora);
  const mediodia = horaChileAUtc(hoy.anio, hoy.mes, hoy.dia, 12, 0);
  const manana = fechaChileDe(new Date(mediodia.getTime() + 24 * 3600_000));
  return horaChileAUtc(manana.anio, manana.mes, manana.dia, 10, 0);
}

export type DecisionPospuesto =
  | { accion: "reprogramar"; para: Date; pospuestoDesde: string }
  | { accion: "descartar"; motivo: string };

/**
 * Texto libre con la ventana de 24 h cerrada: se vuelve a mirar en 2 horas (por
 * si el cliente escribe) y se descarta a los 7 días de espera.
 */
export function decidirPospuesto(
  variables: Record<string, unknown> | null,
  ahora: Date,
): DecisionPospuesto {
  const desde = typeof variables?.pospuesto_desde === "string" ? variables.pospuesto_desde : null;
  const desdeMs = desde ? Date.parse(desde) : NaN;
  if (Number.isFinite(desdeMs) && ahora.getTime() - desdeMs > POSPUESTO_MAX_DIAS * 24 * 3600_000) {
    return { accion: "descartar", motivo: `ventana de 24 h cerrada por más de ${POSPUESTO_MAX_DIAS} días` };
  }
  return {
    accion: "reprogramar",
    para: new Date(ahora.getTime() + POSPUESTO_REINTENTO_MIN * 60_000),
    pospuestoDesde: Number.isFinite(desdeMs) ? (desde as string) : ahora.toISOString(),
  };
}
