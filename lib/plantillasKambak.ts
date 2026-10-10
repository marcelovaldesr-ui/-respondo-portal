import { limpiarParam } from "@/lib/plantillas";

/**
 * PLANTILLAS DE KAMBAK (cuenta de solo mensajería).
 *
 * Viven APARTE de `PLANTILLAS` (lib/plantillas.ts) a propósito: ese catálogo se
 * reparte por rubro entre los clientes de Respondo, y estas seis no deben
 * aparecer jamás en el portafolio de Meta de otro cliente. Los nombres y el
 * orden de las variables son los MISMOS que usa lib/messaging.js del repo de
 * Kambak: si cambia uno, cambia el otro.
 *
 * Estos textos los sube un HUMANO a Meta (ver KAMBAK.md). El código nunca
 * crea plantillas.
 *
 * Las de marketing terminan con la línea de baja: es la que hace que la gente
 * pueda salir y la que `lib/bajas.ts` reconoce al llegar la respuesta.
 *
 * `sello_codigo` es de categoría AUTHENTICATION. Meta fija su texto ("{{1}} es
 * tu código de verificación…"); acá se deja una descripción para el registro
 * del envío. Se manda con el código en el cuerpo Y en el botón (así lo exige
 * Meta para el botón "copiar código").
 */

export type CategoriaKambak = "utility" | "marketing" | "authentication";

export type PlantillaKambak = {
  nombre: string;
  idioma: "es";
  categoria: CategoriaKambak;
  /** Texto exacto para dar de alta en Meta ({{1}}, {{2}}…). */
  cuerpo: string;
  variables: string[];
  ejemplos: string[];
  /** Máximo de caracteres por variable (Meta acepta más; esto cuida el cuerpo total). */
  maxPorVariable: number[];
  /** Si la plantilla lleva el valor de la variable 1 también en un botón URL. */
  botonConCodigo?: boolean;
  /** Texto que se guarda en la conversación (no incluye datos sensibles). */
  textoRegistro?: string;
};

const BAJA = "Responde BAJA para no recibir más avisos.";

export const PLANTILLAS_KAMBAK: Record<string, PlantillaKambak> = {
  sello_premio_cerca: {
    nombre: "sello_premio_cerca",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, ¡ya casi! Te faltan {{2}} sello(s) para tu {{3}} en {{4}}.\n\n" +
      "Te esperamos para completar tu tarjeta.",
    variables: ["nombre", "sellos que faltan (solo el número)", "premio", "local"],
    ejemplos: ["Camila", "2", "café gratis", "Café Aroma"],
    maxPorVariable: [40, 3, 60, 60],
  },
  sello_promo: {
    nombre: "sello_promo",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, en {{2}} tenemos una promo para ti: {{3}}.\n\n{{4}}\n\n" +
      "Válida hasta {{5}}.\n\n" + BAJA,
    variables: ["nombre", "local", "título de la promo", "detalle", "fecha límite"],
    ejemplos: ["Camila", "Café Aroma", "2x1 en cafés", "Pide uno y llévate otro gratis, de lunes a jueves.", "el 31 de octubre"],
    maxPorVariable: [40, 60, 80, 300, 40],
  },
  sello_evento: {
    nombre: "sello_evento",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, {{2}} te invita: {{3}}.\n\n{{4}}\n\nFecha: {{5}}.\n\n" + BAJA,
    variables: ["nombre", "local", "título del evento", "detalle", "fecha"],
    ejemplos: ["Camila", "Café Aroma", "Noche de música en vivo", "Entrada liberada para quienes tienen tarjeta de sellos.", "sábado 25 a las 20:00"],
    maxPorVariable: [40, 60, 80, 300, 60],
  },
  sello_rescate: {
    nombre: "sello_rescate",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, hace tiempo que no te vemos por {{2}}. {{3}}\n\n" +
      "Te esperamos con tu tarjeta de sellos.\n\n" + BAJA,
    variables: ["nombre", "local", "detalle"],
    ejemplos: ["Camila", "Café Aroma", "Esta semana tu próximo café tiene doble sello."],
    maxPorVariable: [40, 60, 300],
  },
  sello_cerca: {
    nombre: "sello_cerca",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, en {{2}} llevas {{3}} de {{4}} sellos. ¡Te falta poco para tu premio!\n\n" + BAJA,
    variables: ["nombre", "local", "sellos actuales", "sellos de la meta"],
    ejemplos: ["Camila", "Café Aroma", "8", "10"],
    maxPorVariable: [40, 60, 3, 3],
  },
  sello_codigo: {
    nombre: "sello_codigo",
    idioma: "es",
    categoria: "authentication",
    // Texto fijado por Meta para plantillas de autenticación.
    cuerpo: "{{1}} es tu código de verificación.",
    variables: ["código"],
    ejemplos: ["123456"],
    maxPorVariable: [15],
    botonConCodigo: true,
    textoRegistro: "Código de verificación enviado.",
  },
};

export function plantillaKambak(nombre: string): PlantillaKambak | null {
  return Object.prototype.hasOwnProperty.call(PLANTILLAS_KAMBAK, nombre)
    ? PLANTILLAS_KAMBAK[nombre]
    : null;
}

/**
 * Valida y limpia las variables. Devuelve el error en palabras o los valores
 * listos para Meta (sin saltos de línea, sin vacíos, sin pasarse del largo).
 */
export function prepararVariables(
  p: PlantillaKambak,
  variables: unknown,
): { ok: true; params: string[] } | { ok: false; error: string } {
  if (!Array.isArray(variables)) return { ok: false, error: "variables debe ser una lista" };
  if (variables.length !== p.variables.length) {
    return { ok: false, error: `${p.nombre} necesita ${p.variables.length} variables y llegaron ${variables.length}` };
  }
  const params: string[] = [];
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    if (typeof v !== "string" && typeof v !== "number") {
      return { ok: false, error: `la variable ${i + 1} (${p.variables[i]}) debe ser texto` };
    }
    const limpio = limpiarParam(v);
    if (!limpio) return { ok: false, error: `la variable ${i + 1} (${p.variables[i]}) está vacía` };
    if (limpio.length > p.maxPorVariable[i]) {
      return { ok: false, error: `la variable ${i + 1} (${p.variables[i]}) pasa de ${p.maxPorVariable[i]} caracteres` };
    }
    if (p.categoria === "authentication" && !/^[A-Za-z0-9]{4,15}$/.test(limpio)) {
      return { ok: false, error: "el código debe tener entre 4 y 15 letras o números" };
    }
    params.push(limpio);
  }
  return { ok: true, params };
}

/** Reglas de Meta sobre el cuerpo (se corre en los tests). */
export function validarPlantillaKambak(p: PlantillaKambak): string[] {
  const e: string[] = [];
  const c = p.cuerpo;
  if (c.length > 1024) e.push("el cuerpo pasa los 1024 caracteres");
  if (p.categoria !== "authentication") {
    if (/^\s*\{\{\d+\}\}/.test(c)) e.push("empieza con variable");
    if (/\{\{\d+\}\}\s*$/.test(c)) e.push("termina con variable");
    if (/\{\{\d+\}\}\{\{\d+\}\}/.test(c)) e.push("variables pegadas");
  }
  const n = new Set([...c.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))).size;
  if (n !== p.variables.length) e.push("variables del cuerpo y descritas no calzan");
  if (n !== p.ejemplos.length) e.push("faltan ejemplos");
  if (n !== p.maxPorVariable.length) e.push("faltan largos máximos");
  if (!/^[a-z0-9_]+$/.test(p.nombre)) e.push("nombre inválido");
  if (p.categoria === "marketing" && !c.includes(BAJA)) e.push("falta la línea de baja");
  return e;
}

export function textoDe(p: PlantillaKambak, params: string[]): string {
  if (p.textoRegistro) return p.textoRegistro;
  let out = p.cuerpo;
  params.forEach((v, i) => { out = out.replaceAll(`{{${i + 1}}}`, v); });
  return out;
}
