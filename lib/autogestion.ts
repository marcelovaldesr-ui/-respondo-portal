/**
 * AUTOGESTIÓN DE LA HORA POR PARTE DEL CLIENTE FINAL (migración 277).
 * Núcleo puro: decide QUÉ puede hacer alguien con su cita, sin tocar la base.
 *
 * POR QUÉ EXISTE
 * Hasta ahora la única salida era "escríbenos por WhatsApp". Es el hueco más
 * grande que teníamos frente a AgendaPro y Dentalink, y no solo por
 * competencia:
 *
 *   · Para el cliente final: cancelar a las 23:40 sin tener que escribirle a
 *     nadie ni esperar respuesta.
 *   · Para el negocio: la hora se libera EN EL MOMENTO y otra persona puede
 *     tomarla. Hoy queda ocupada hasta que alguien lee el WhatsApp y la mueve a
 *     mano — en la práctica, hasta el otro día.
 *   · Para nosotros: cada cambio que el cliente resuelve solo es una
 *     conversación menos que Tino tiene que entender y escalar.
 *
 * DECISIÓN DE DISEÑO: el negocio manda. Hay rubros donde dejar cancelar solo es
 * lo correcto (peluquería) y otros donde no (una hora de pabellón que ya
 * reservó equipo). Por eso son tres interruptores por cliente y no una regla
 * nuestra.
 */

export type PoliticaAutogestion = {
  permiteCancelar: boolean;
  permiteReagendar: boolean;
  /** Horas mínimas de antelación. 0 = hasta la hora misma. */
  cancelacionMinHoras: number;
};

export type EstadoCita = {
  estado: string;
  inicioIso: string;
};

export type Permiso = { permitido: boolean; motivo?: string };

export const ESTADOS_GESTIONABLES = ["agendada", "confirmada", "reagendada"];

/**
 * Traduce estado + política + reloj en "qué botones se muestran".
 *
 * Devuelve motivos redactados para el CLIENTE FINAL, no para nosotros: esta
 * pantalla la abre alguien que quiere resolver algo, y un mensaje seco lo
 * empuja justo a lo que queríamos evitar (escribir por WhatsApp).
 */
export function permisosDeGestion(
  cita: EstadoCita,
  politica: PoliticaAutogestion,
  ahora: Date = new Date(),
): { cancelar: Permiso; reagendar: Permiso; yaPaso: boolean; anulada: boolean } {
  const inicio = Date.parse(cita.inicioIso);
  const yaPaso = Number.isFinite(inicio) && inicio <= ahora.getTime();
  const anulada = !ESTADOS_GESTIONABLES.includes(cita.estado);

  if (anulada) {
    const motivo =
      cita.estado === "cancelada"
        ? "Esta hora ya está cancelada."
        : cita.estado === "completada"
          ? "Esta hora ya se realizó."
          : "Esta hora ya no está activa.";
    return { cancelar: { permitido: false, motivo }, reagendar: { permitido: false, motivo }, yaPaso, anulada };
  }

  if (yaPaso) {
    const motivo = "Esta hora ya pasó.";
    return { cancelar: { permitido: false, motivo }, reagendar: { permitido: false, motivo }, yaPaso, anulada };
  }

  const horasFaltantes = (inicio - ahora.getTime()) / 3_600_000;
  const dentroDePlazo = horasFaltantes >= politica.cancelacionMinHoras;
  const motivoPlazo = textoPlazo(politica.cancelacionMinHoras);

  return {
    yaPaso,
    anulada,
    cancelar: politica.permiteCancelar
      ? dentroDePlazo
        ? { permitido: true }
        : { permitido: false, motivo: motivoPlazo }
      : { permitido: false, motivo: "Para anular tu hora, escríbenos y lo hacemos al tiro." },
    reagendar: politica.permiteReagendar
      ? dentroDePlazo
        ? { permitido: true }
        : { permitido: false, motivo: motivoPlazo }
      : { permitido: false, motivo: "Para mover tu hora, escríbenos y lo vemos contigo." },
  };
}

function textoPlazo(horas: number): string {
  if (horas <= 0) return "Ya no se puede modificar por internet.";
  if (horas === 1) return "Los cambios por internet se cierran 1 hora antes. Escríbenos y lo vemos.";
  if (horas < 24) return `Los cambios por internet se cierran ${horas} horas antes. Escríbenos y lo vemos.`;
  const dias = Math.round(horas / 24);
  return `Los cambios por internet se cierran ${dias} ${dias === 1 ? "día" : "días"} antes. Escríbenos y lo vemos.`;
}

/**
 * ¿El token tiene forma de token? Barrera barata ANTES de ir a la base: evita
 * que un escaneo de URLs nos haga una consulta por cada intento.
 * Formato: 36 caracteres hex (18 bytes) — ver migración 277.
 */
export function tokenConFormato(valor: string | null | undefined): boolean {
  return typeof valor === "string" && /^[0-9a-f]{36}$/.test(valor);
}
