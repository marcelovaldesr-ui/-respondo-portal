/**
 * EXTRACCIÓN ESTRUCTURADA DE LA COTIZACIÓN — puro, sin red ni base.
 *
 * El agente no guardaba datos estructurados: producto y cantidad vivían solo en
 * el texto. Para saber si una conversación de un anuncio llegó a «cotización
 * con datos mínimos» (LeadSubmitted) o «cotización que califica»
 * (QualifiedLead) hace falta leerlos con un schema fijo, no adivinarlos del
 * texto libre con expresiones regulares.
 *
 * DÓNDE CORRE: en el cron (lib/ads/extraccionCotizacion.ts), FUERA del turno de
 * Tino. Así la conversación en vivo no paga ni un milisegundo ni un riesgo.
 *
 * QUÉ HACE ESTE ARCHIVO
 *   · el prompt y el schema de respuesta,
 *   · `interpretarExtraccion` — valida lo que devuelve el modelo,
 *   · `fusionarCotizacion` — combina lo nuevo con lo ya guardado sin perder
 *     datos que el modelo ya no ve (la ventana de mensajes es corta) y fija
 *     las fechas de «se completó» y «calificó» una sola vez.
 *
 * Solo imports puros: `node --test` lo carga con el alias de tests/_alias.mjs.
 */

import { califica, esCotizacionCompleta, type ReglaCalificacion } from "@/lib/ads/conversionesConfig";

export type DatosCotizacion = {
  producto: string | null;
  cantidad: number | null;
  tipo: string | null;
  fechaNecesita: string | null;
  tieneLogo: boolean | null;
  empresa: string | null;
};

/** Lo que se guarda en `ed_contactos.cotizacion`. */
export type CotizacionGuardada = DatosCotizacion & {
  /** Primera vez que tuvo producto + cantidad. Fija una vez. */
  completaEn: string | null;
  /** Primera vez que cumplió la regla (o se marcó a mano). Fija una vez. */
  calificadaEn: string | null;
  /** Si alguien la marcó a mano como calificada. */
  calificadaManual: { por: string; en: string } | null;
  actualizadaEn: string | null;
};

export const COTIZACION_VACIA: CotizacionGuardada = {
  producto: null,
  cantidad: null,
  tipo: null,
  fechaNecesita: null,
  tieneLogo: null,
  empresa: null,
  completaEn: null,
  calificadaEn: null,
  calificadaManual: null,
  actualizadaEn: null,
};

/** Schema de respuesta (subconjunto OpenAPI que acepta Gemini). */
export const ESQUEMA_COTIZACION = {
  type: "OBJECT",
  properties: {
    producto: { type: "STRING", nullable: true },
    cantidad: { type: "INTEGER", nullable: true },
    tipo: { type: "STRING", nullable: true },
    fecha_necesita: { type: "STRING", nullable: true },
    tiene_logo: { type: "BOOLEAN", nullable: true },
    empresa: { type: "STRING", nullable: true },
  },
  required: ["producto", "cantidad", "tipo", "fecha_necesita", "tiene_logo", "empresa"],
} as const;

export type MensajeExtraccion = { rol: string; texto: string };

export function promptCotizacion(p: {
  negocio: string;
  productos: string[];
  mensajes: MensajeExtraccion[];
}): string {
  const lista = p.productos.length
    ? `Si el producto corresponde a uno de estos, usa EXACTAMENTE esa palabra: ${p.productos.join(", ")}. Si no, un nombre corto en minúsculas.`
    : "Usa un nombre corto del producto, en minúsculas.";
  const historial = p.mensajes
    .map((m) => `${m.rol === "cliente" ? "CLIENTE" : "NEGOCIO"}: ${String(m.texto ?? "").slice(0, 600)}`)
    .join("\n");
  return [
    `Lees una conversación de WhatsApp entre un cliente y ${p.negocio}.`,
    "Extrae SOLO lo que el CLIENTE dijo sobre lo que quiere cotizar. No inventes ni supongas.",
    "Si un dato no aparece, devuelve null.",
    "",
    `producto: ${lista}`,
    "cantidad: número entero de unidades. Si el cliente elige un rango (por ejemplo «500–999» o «1.000–1.999»), usa el límite inferior. «5.000+» es 5000. Si dice «menos de 500» sin número exacto, devuelve 1. Puntos de miles no son decimales: «1.000» es 1000.",
    "tipo: variante o formato que pide (por ejemplo «mural», «escritorio», «imán»).",
    "fecha_necesita: cuándo lo necesita, tal como lo dijo.",
    "tiene_logo: true/false si dijo si tiene logo o no.",
    "empresa: nombre de la empresa del cliente, si lo dio.",
    "",
    "Conversación:",
    historial,
    "",
    "Responde solo el JSON.",
  ].join("\n");
}

function texto(v: unknown, max = 80): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s.slice(0, max);
}

/** «1.000», «1000», «500-999», 500 → número entero o null. */
export function interpretarCantidad(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= 10_000_000 ? Math.floor(v) : null;
  const s = String(v);
  const m = s.match(/\d[\d.]*/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, ""));
  return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? Math.floor(n) : null;
}

/** Valida la respuesta del modelo. Null si no es JSON de la forma esperada. */
export function interpretarExtraccion(crudo: string): DatosCotizacion | null {
  let o: Record<string, unknown>;
  try {
    const limpio = String(crudo ?? "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const j = JSON.parse(limpio);
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    o = j as Record<string, unknown>;
  } catch {
    return null;
  }
  const producto = texto(o.producto, 60);
  return {
    producto: producto ? producto.toLowerCase() : null,
    cantidad: interpretarCantidad(o.cantidad),
    tipo: texto(o.tipo, 60),
    fechaNecesita: texto(o.fecha_necesita ?? o.fechaNecesita, 60),
    tieneLogo: typeof o.tiene_logo === "boolean" ? o.tiene_logo : typeof o.tieneLogo === "boolean" ? (o.tieneLogo as boolean) : null,
    empresa: texto(o.empresa, 80),
  };
}

/** Lee lo guardado en la columna, tolerante a basura. */
export function leerCotizacion(crudo: unknown): CotizacionGuardada {
  const o = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const cm = o.calificadaManual as Record<string, unknown> | null | undefined;
  return {
    producto: texto(o.producto, 60),
    cantidad: interpretarCantidad(o.cantidad),
    tipo: texto(o.tipo, 60),
    fechaNecesita: texto(o.fechaNecesita, 60),
    tieneLogo: typeof o.tieneLogo === "boolean" ? o.tieneLogo : null,
    empresa: texto(o.empresa, 80),
    completaEn: texto(o.completaEn, 40),
    calificadaEn: texto(o.calificadaEn, 40),
    calificadaManual: cm && typeof cm === "object" && cm.en ? { por: String(cm.por ?? ""), en: String(cm.en) } : null,
    actualizadaEn: texto(o.actualizadaEn, 40),
  };
}

/**
 * Combina lo recién extraído con lo guardado.
 *
 *  · Un dato que el modelo ya no ve (quedó fuera de la ventana) NO se borra:
 *    lo nuevo solo pisa si trae valor.
 *  · La cantidad SÍ se corrige si el cliente da otra («mejor 1.000»): manda la
 *    última que dijo.
 *  · `completaEn` y `calificadaEn` se fijan la primera vez y no se mueven. El
 *    evento ya pudo haber salido; reescribir la fecha no lo «des-envía».
 */
export function fusionarCotizacion(
  previa: CotizacionGuardada,
  nueva: DatosCotizacion | null,
  reglas: ReglaCalificacion[],
  ahoraIso: string,
): CotizacionGuardada {
  const n = nueva ?? { producto: null, cantidad: null, tipo: null, fechaNecesita: null, tieneLogo: null, empresa: null };
  const out: CotizacionGuardada = {
    ...previa,
    producto: n.producto ?? previa.producto,
    cantidad: n.cantidad ?? previa.cantidad,
    tipo: n.tipo ?? previa.tipo,
    fechaNecesita: n.fechaNecesita ?? previa.fechaNecesita,
    tieneLogo: n.tieneLogo ?? previa.tieneLogo,
    empresa: n.empresa ?? previa.empresa,
    actualizadaEn: ahoraIso,
  };
  if (!out.completaEn && esCotizacionCompleta(out)) out.completaEn = ahoraIso;
  if (!out.calificadaEn && califica(out, reglas)) out.calificadaEn = ahoraIso;
  return out;
}

/** Marca manual «Cotización calificada»: también la deja completa. */
export function marcarCalificadaManual(previa: CotizacionGuardada, por: string, ahoraIso: string): CotizacionGuardada {
  return {
    ...previa,
    completaEn: previa.completaEn ?? ahoraIso,
    calificadaEn: previa.calificadaEn ?? ahoraIso,
    calificadaManual: previa.calificadaManual ?? { por, en: ahoraIso },
    actualizadaEn: ahoraIso,
  };
}
