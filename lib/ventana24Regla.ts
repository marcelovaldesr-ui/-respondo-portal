/**
 * LA REGLA DE LA VENTANA DE 24 HORAS.
 *
 * Meta solo acepta texto libre dentro de las 24 horas desde el ÚLTIMO mensaje
 * del CLIENTE. Pasado eso, solo salen plantillas aprobadas — y eso vale igual
 * para el asistente y para la persona que escribe a mano.
 *
 * ⚠️ EN WAHA ESTA VENTANA NO EXISTE. Es una sesión no oficial: se puede escribir
 * cuando sea. Por eso la función recibe el transporte y no solo la fecha.
 *
 * Antes esto se calculaba mirando solo la fecha, y a un cliente en WAHA le
 * mostraba «pasaron más de 24 h, tu mensaje puede no llegar» cuando su mensaje
 * iba a llegar perfectamente. Un aviso falso en la pantalla donde alguien decide
 * si escribirle a un cliente es peor que no tener aviso: frena a la persona sin
 * motivo.
 *
 * ⚠️ **CONSECUENCIA COMERCIAL:** migrar un cliente de WAHA a Cloud API le QUITA
 * la posibilidad de escribirle libremente a quien quiera cuando quiera. Para un
 * negocio que hoy retoma conversaciones viejas a mano, eso es una pérdida de
 * capacidad concreta, no un detalle técnico. Debe decirse ANTES de migrar.
 * Ver docs/PLAN_MIGRACION_WAHA_A_CLOUD.
 *
 * ⚠️ ESTE ARCHIVO NO IMPORTA NADA A PROPÓSITO. Sin `@/lib/db` ni nada de Next,
 * `node --test` puede cargarlo y probar la regla sin levantar la aplicación —
 * igual que `parserMeta.ts` y `ritmoHumano.ts`.
 *
 * ⚠️⚠️ NO CONFUNDIR CON `lib/ventana24.ts`, QUE HACE OTRA COSA
 * ------------------------------------------------------------
 * Los nombres se parecen demasiado y calculan la ventana con criterios
 * distintos. Antes de usar uno, elegir a conciencia:
 *
 *  - **`ventana24.ts` → `ventanaAbierta()`** consulta la base y mira los
 *    mensajes de **TODOS los empleados del cliente**. Es la CORRECTA para
 *    decidir si se puede enviar, porque para Meta la ventana es **por número de
 *    WhatsApp**, no por empleado: si el cliente le escribió a Tino, Beto también
 *    puede responderle.
 *
 *  - **este archivo → `ventanaDesde()`** es la regla pura, sin base de datos, y
 *    se alimenta de `ed_chat_estado.ultimo_entrante_en`, que es **por (empleado,
 *    chat)**. Sirve para PINTAR el estado en la bandeja, donde ya se está
 *    mirando un empleado concreto.
 *
 * ⚠️ Consecuencia conocida y todavía sin arreglar: con Beto y Vera activos, el
 * cartel de la bandeja puede decir «cerrada» aunque la ventana esté abierta por
 * un mensaje que recibió otro empleado. Con un solo empleado da igual, y hoy
 * ningún cliente tiene más de uno operativo. **Revisar cuando Beto entre en
 * producción.**
 */

export type EstadoVentana = "abierta" | "cerrada" | "desconocida" | "no_aplica";

/** Duración de la ventana según Meta. */
export const HORAS_VENTANA = 24;

export function ventanaDesde(
  transporte: string | null | undefined,
  ultimoEntranteEn: string | null | undefined,
  ahora: number = Date.now(),
): EstadoVentana {
  /**
   * Sin transporte conocido se asume WAHA, que es lo que corre hoy en el único
   * cliente en producción. Asumir "cloud" mostraría el aviso de las 24 h a quien
   * no lo tiene, que es justo el error que esta función vino a arreglar.
   */
  if ((transporte ?? "waha") !== "cloud") return "no_aplica";

  // La columna `ultimo_entrante_en` la agrega la migración 210. Si falta, se
  // dice "desconocida" en vez de inventar que está abierta o cerrada.
  if (!ultimoEntranteEn) return "desconocida";

  const desde = new Date(ultimoEntranteEn).getTime();
  if (!Number.isFinite(desde)) return "desconocida";

  const horas = (ahora - desde) / 36e5;
  /**
   * Una fecha en el FUTURO da horas negativas. Puede pasar por desfase de reloj
   * entre el servidor de Meta y el nuestro. Cuenta como abierta: el mensaje
   * acaba de llegar.
   */
  return horas < HORAS_VENTANA ? "abierta" : "cerrada";
}
