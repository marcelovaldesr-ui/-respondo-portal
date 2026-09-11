/**
 * MEMORIA DE LAS PROPUESTAS DE BETO — reglas puras (Fase 0, 11-sep-2026).
 *
 * El problema: el generador corre cada 5 minutos. Sin memoria, un candidato que
 * el juez FRENÓ o que una persona RECHAZÓ volvía a pasar la reja en la corrida
 * siguiente, se le pagaba al modelo por leer el mismo hilo otra vez y —si el
 * juez cambiaba de opinión— reaparecía en /seguimientos. En modo aprobación,
 * además, las propuestas no gastan cupo, así que se consultaba al juez hasta
 * `tope` veces cada 5 minutos, todo el día.
 *
 * La regla: una decisión (del juez o de una persona) vale mientras la
 * conversación no cambie. Si llega un mensaje nuevo después de la decisión, se
 * vuelve a evaluar; si no, no.
 *
 * ⚠️ SIN IMPORTS: `node --test` lo carga directo.
 */

export type EstadoPropuesta = "propuesto" | "aprobado" | "rechazado" | "vencido" | "frenado";

export type UltimaPropuesta = {
  estado: EstadoPropuesta | string;
  creado_en: string;
  resuelto_en: string | null;
  motivo_juez?: string | null;
};

/**
 * Motivo con el que se guarda un juez SIN VEREDICTO (modelo caído, respuesta
 * ilegible). No es un "no": se reintenta, pero no antes de un día. Sin esta
 * marca, un hilo que el modelo no logra leer se volvía a pagar cada 5 minutos
 * y ocupaba el único cupo de la lista.
 */
export const PREFIJO_SIN_VEREDICTO = "sin veredicto:";
export const HORAS_REINTENTO_SIN_VEREDICTO = 24;

/** Días que bloquea una aprobación aunque la fila de ed_seguimientos no exista. */
export const DIAS_BLOQUEO_APROBADO = 45;

export function bloqueoPorPropuesta(
  ultima: UltimaPropuesta | null | undefined,
  ultimoMensajeEn: string | null,
  ahora: number = Date.now(),
): { bloquea: false } | { bloquea: true; motivo: string } {
  if (!ultima) return { bloquea: false };
  if (ultima.estado === "propuesto") return { bloquea: true, motivo: "ya espera aprobación" };
  if (ultima.estado === "vencido") return { bloquea: false };

  const decidido = Date.parse(ultima.resuelto_en ?? ultima.creado_en);
  if (!Number.isFinite(decidido)) return { bloquea: true, motivo: "decisión previa sin fecha" };

  if (ultima.estado === "aprobado") {
    const dias = Math.floor((ahora - decidido) / 86_400_000);
    return dias < DIAS_BLOQUEO_APROBADO
      ? { bloquea: true, motivo: `aprobado hace ${dias} día(s)` }
      : { bloquea: false };
  }

  if (ultima.estado === "frenado" && (ultima.motivo_juez ?? "").startsWith(PREFIJO_SIN_VEREDICTO)) {
    const horas = (ahora - decidido) / 3_600_000;
    return horas < HORAS_REINTENTO_SIN_VEREDICTO
      ? { bloquea: true, motivo: "el juez no pudo decidir hace poco: se reintenta mañana" }
      : { bloquea: false };
  }

  // rechazado / frenado: vale mientras no haya conversación nueva.
  const ultimo = ultimoMensajeEn ? Date.parse(ultimoMensajeEn) : NaN;
  if (Number.isFinite(ultimo) && ultimo > decidido) return { bloquea: false };
  return {
    bloquea: true,
    motivo: ultima.estado === "rechazado" ? "rechazado y sin mensajes nuevos" : "frenado por el juez y sin mensajes nuevos",
  };
}

/** Para cada chat, la propuesta más reciente (por creado_en). */
export function ultimaPorChat<T extends UltimaPropuesta & { chat_id: string }>(filas: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const f of filas) {
    const prev = m.get(f.chat_id);
    if (!prev || Date.parse(f.creado_en) > Date.parse(prev.creado_en)) m.set(f.chat_id, f);
  }
  return m;
}

export type ContactoAlAprobar = {
  etiquetas: string[] | null;
  etapa: string | null;
  etapa_motivo?: string | null;
  ultimo_mensaje_en: string | null;
  ultimo_mensaje_rol: string | null;
} | null;

/**
 * ¿Sigue teniendo sentido al momento de APROBAR? La propuesta pudo generarse
 * hace días; entre medio el cliente pudo escribir, comprar o pedir que no le
 * escriban. Aprobar un «¿sigue en pie?» en esos casos es pagar por quedar mal.
 */
export function vigenciaAlAprobar(
  contacto: ContactoAlAprobar,
  propuestaCreadaEn: string,
): { vigente: true } | { vigente: false; motivo: string } {
  if (!contacto) return { vigente: false, motivo: "la conversación ya no existe" };
  const etiquetas = contacto.etiquetas ?? [];
  if (etiquetas.includes("no_contactar")) return { vigente: false, motivo: "el contacto está marcado como no contactar" };
  if (etiquetas.includes("pago_pendiente")) {
    return { vigente: false, motivo: "el cliente ya aprobó y falta el abono: corresponde pedir el pago, no retomar la cotización" };
  }
  // Perdido por silencio (sin_respuesta) sigue siendo retomable: es el caso de
  // Beto. Ver generadorCotizacionCore.ts.
  const perdidoPorSilencio = contacto.etapa === "perdido" && contacto.etapa_motivo === "sin_respuesta";
  if (contacto.etapa === "ganado" || (contacto.etapa === "perdido" && !perdidoPorSilencio)) {
    return { vigente: false, motivo: `la oportunidad ya está ${contacto.etapa}` };
  }
  const ultimo = contacto.ultimo_mensaje_en ? Date.parse(contacto.ultimo_mensaje_en) : NaN;
  if (contacto.ultimo_mensaje_rol === "cliente" && Number.isFinite(ultimo) && ultimo > Date.parse(propuestaCreadaEn)) {
    return { vigente: false, motivo: "el cliente escribió después de la propuesta: revisa la conversación" };
  }
  return { vigente: true };
}
