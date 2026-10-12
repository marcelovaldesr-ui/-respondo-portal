import type { PlantillaKambak } from "@/lib/plantillasKambak";
import { textoDe } from "@/lib/plantillasKambak";

/**
 * LÍNEA OBLIGATORIA DE BAJA PARA MARKETING.
 * Cualquier mensaje de marketing en WAHA debe incluir esta línea al final.
 */
export const LINEA_BAJA = "Responde BAJA para no recibir más avisos.";

function selectorSemilla(semilla: string, max: number): number {
  if (max <= 1) return 0;
  let hash = 0;
  for (let i = 0; i < semilla.length; i++) {
    hash = (hash * 31 + semilla.charCodeAt(i)) >>> 0;
  }
  return hash % max;
}

function renderizar(cuerpo: string, params: string[]): string {
  let out = cuerpo;
  params.forEach((v, i) => {
    out = out.replaceAll(`{{${i + 1}}}`, v);
  });
  return out;
}

/**
 * 2–3 VARIANTES POR PLANTILLA DE MARKETING PARA WAHA.
 * Evita el patrón de envío masivo con textos idénticos en canales no oficiales.
 * Conserva intacto el significado, todas las variables y la línea de baja obligatoria.
 */
export const VARIANTES_PLANTILLAS_WAHA: Record<string, string[]> = {
  sello_promo: [
    "Hola {{1}}, en {{2}} tenemos una promo para ti: {{3}}.\n\n{{4}}\n\nVálida hasta {{5}}.\n\n" + LINEA_BAJA,
    "¡Hola {{1}}! En {{2}} tenemos una novedad para ti: {{3}}.\n\n{{4}}\n\nAprovecha hasta {{5}}.\n\n" + LINEA_BAJA,
    "Hola {{1}}, desde {{2}} te compartimos esta promo especial: {{3}}.\n\n{{4}}\n\nVigente hasta {{5}}.\n\n" + LINEA_BAJA,
  ],
  sello_evento: [
    "Hola {{1}}, {{2}} te invita: {{3}}.\n\n{{4}}\n\nFecha: {{5}}.\n\n" + LINEA_BAJA,
    "¡Hola {{1}}! En {{2}} tenemos una invitación para ti: {{3}}.\n\n{{4}}\n\nCuándo: {{5}}.\n\n" + LINEA_BAJA,
    "Hola {{1}}, el equipo de {{2}} te invita a: {{3}}.\n\n{{4}}\n\nFecha: {{5}}.\n\n" + LINEA_BAJA,
  ],
  sello_rescate: [
    "Hola {{1}}, hace tiempo que no te vemos por {{2}}. {{3}}\n\nTe esperamos con tu tarjeta de sellos.\n\n" + LINEA_BAJA,
    "¡Hola {{1}}! Te extrañamos en {{2}}. {{3}}\n\nPasa cuando quieras con tu tarjeta de sellos.\n\n" + LINEA_BAJA,
    "Hola {{1}}, ¡hace falta tu visita en {{2}}! {{3}}\n\nTe esperamos para sumar más sellos a tu tarjeta.\n\n" + LINEA_BAJA,
  ],
  sello_cerca: [
    "Hola {{1}}, en {{2}} llevas {{3}} de {{4}} sellos. ¡Te falta poco para tu premio!\n\n" + LINEA_BAJA,
    "¡Hola {{1}}! En {{2}} ya completaste {{3}} de {{4}} sellos. ¡Estás a nada de tu premio!\n\n" + LINEA_BAJA,
    "Hola {{1}}, tu tarjeta en {{2}} va en {{3}} de {{4}} sellos. ¡Muy cerca de tu recompensa!\n\n" + LINEA_BAJA,
  ],
};

/**
 * Devuelve todas las variantes renderizadas para una plantilla y sus variables.
 */
export function variantesWaha(p: PlantillaKambak, params: string[]): string[] {
  const moldes = VARIANTES_PLANTILLAS_WAHA[p.nombre];
  if (!moldes || moldes.length === 0) {
    const base = textoDe(p, params);
    if (p.categoria === "marketing" && !base.includes(LINEA_BAJA)) {
      return [`${base}\n\n${LINEA_BAJA}`];
    }
    return [base];
  }
  return moldes.map((m) => {
    const res = renderizar(m, params);
    if (p.categoria === "marketing" && !res.includes(LINEA_BAJA)) {
      return `${res}\n\n${LINEA_BAJA}`;
    }
    return res;
  });
}

/**
 * Texto adaptado para WAHA con variación determinista por semilla (ej. teléfono destinatario).
 * `textoDe` de `lib/plantillasKambak.ts` permanece intacto para Meta.
 */
export function textoWaha(
  p: PlantillaKambak,
  params: string[],
  semilla: string = "",
): string {
  const vars = variantesWaha(p, params);
  if (vars.length === 1 || !semilla) {
    return vars[0];
  }
  const idx = selectorSemilla(semilla, vars.length);
  return vars[idx];
}
