/**
 * Catálogo de etiquetas de conversación (inbox).
 *
 * Unas las pone el asistente solo (auto), otras las agrega el humano a mano.
 * El humano puede usar cualquiera; el catálogo solo define nombre y color.
 */

export type Etiqueta = {
  valor: string;
  label: string;
  color: string; // texto
  fondo: string; // fondo del chip
  auto: boolean; // ¿la asigna el bot?
};

export const ETIQUETAS: Etiqueta[] = [
  { valor: "posible_comprador", label: "Posible comprador", color: "#9A3412", fondo: "#FFF7ED", auto: true },
  { valor: "cotizacion", label: "Cotización", color: "#92400E", fondo: "#FEF9C3", auto: true },
  { valor: "cliente_nuevo", label: "Cliente nuevo", color: "#0F766E", fondo: "#CCFBF1", auto: true },
  { valor: "agendado", label: "Agendado", color: "#3730A3", fondo: "#E0E7FF", auto: true },
  { valor: "reclamo", label: "Reclamo", color: "#991B1B", fondo: "#FEE2E2", auto: true },
  { valor: "necesita_atencion", label: "Necesita atención", color: "#9A3412", fondo: "#FFEDD5", auto: true },
  { valor: "cliente", label: "Cliente", color: "#166534", fondo: "#DCFCE7", auto: false },
  { valor: "resuelto", label: "Resuelto", color: "#475569", fondo: "#F1F5F9", auto: false },
];

const PORVALOR = new Map(ETIQUETAS.map((e) => [e.valor, e]));

/** Devuelve la definición de una etiqueta (o una genérica si es personalizada). */
export function metaEtiqueta(valor: string): Etiqueta {
  return (
    PORVALOR.get(valor) ?? {
      valor,
      label: valor.replace(/_/g, " "),
      color: "#475569",
      fondo: "#F1F5F9",
      auto: false,
    }
  );
}

/** Etiquetas que Cecilia puede agregar a mano desde el inbox. */
export const ETIQUETAS_MANUALES = ETIQUETAS;

/**
 * Deriva etiquetas automáticas de la salida del motor (para cuando el bot
 * responde en vivo). No borra las existentes: solo suma.
 */
export function etiquetasDesdeMotor(datos: {
  escalar?: boolean;
  trigger?: string | null;
  accion?: string | null;
  lead?: { clasificacion?: string } | null;
}): string[] {
  const out: string[] = [];
  if (datos.lead?.clasificacion === "caliente") out.push("posible_comprador");
  if (datos.accion === "cotizar") out.push("cotizacion");
  if (datos.accion === "agendar") out.push("agendado");
  if (datos.escalar && datos.trigger === "sentimiento_negativo") out.push("reclamo");
  else if (datos.escalar) out.push("necesita_atencion");
  return out;
}
