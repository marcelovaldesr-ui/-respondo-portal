/**
 * DERIVACIONES: QUÉ SIGNIFICA CADA UNA PARA LA PERSONA QUE ATIENDE (Fase 1).
 *
 * `ed_escalaciones` no tiene columna de motivo: tiene `trigger` (lo que dijo el
 * modelo) y `resumen` (texto). Tres derivaciones las abre el SISTEMA, no el
 * modelo, y todas llegan como `incertidumbre`: un fallo del canal, un fallo del
 * modelo y un audio que Tino no puede escuchar. Para la portada eso no es «el
 * asistente no estaba seguro»: es un problema técnico o un audio por oír.
 *
 * Los textos de esas tres viven ACÁ y responderBot los usa desde acá, así que
 * la clasificación compara con la misma cadena que se guarda. Si alguien
 * cambia una frase, cambia en los dos lados a la vez.
 *
 * ⚠️ Puro: sin base ni Next.
 */

export const RESUMEN_FALLO_CANAL =
  "El asistente no pudo entregar su respuesta por un fallo del canal. La conversación quedó esperando a una persona.";

export const RESUMEN_FALLO_MODELO =
  "El asistente no pudo responder por un problema técnico momentáneo. La conversación quedó esperando a una persona.";

export const RESUMEN_AUDIO =
  "El cliente mandó un audio. Tino todavía no puede escucharlos: la conversación quedó esperando a una persona.";

export type ClaseDerivacion =
  | "cliente_molesto"
  | "pidio_persona"
  | "tema_delicado"
  | "problema_tecnico"
  | "asistente_no_pudo";

export type DerivacionClasificada = { clase: ClaseDerivacion; label: string };

export function clasificarDerivacion(trigger: string | null | undefined, resumen: string | null | undefined): DerivacionClasificada {
  const r = (resumen ?? "").trim();
  if (r === RESUMEN_FALLO_CANAL) return { clase: "problema_tecnico", label: "No se pudo entregar la respuesta" };
  if (r === RESUMEN_FALLO_MODELO) return { clase: "problema_tecnico", label: "El asistente tuvo una falla técnica" };
  switch (trigger) {
    case "sentimiento_negativo":
      return { clase: "cliente_molesto", label: "Cliente molesto" };
    case "pedido_explicito":
      return { clase: "pidio_persona", label: "Pidió hablar con una persona" };
    case "monto_alto":
      return { clase: "tema_delicado", label: "Monto alto" };
    case "palabra_clave":
      return { clase: "tema_delicado", label: "Tema delicado" };
    case "sin_resolver":
      return { clase: "asistente_no_pudo", label: "El asistente no pudo resolverlo" };
  }
  if (r === RESUMEN_AUDIO) return { clase: "asistente_no_pudo", label: "Mandó un audio" };
  return { clase: "asistente_no_pudo", label: "El asistente no estaba seguro" };
}
