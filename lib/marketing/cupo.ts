import { limitarDistribuido } from "@/lib/seguridad";

/**
 * TOPE DE USO DE LOS PASOS QUE CUESTAN PLATA.
 *
 * Escribir un anuncio, generar una imagen y preguntarle al copiloto son
 * llamadas pagadas a un modelo. Un usuario autenticado no debería poder —por
 * accidente, por un bucle en una pestaña o a propósito— disparar cientos de
 * generaciones y convertir eso en una factura.
 *
 * NO ES UN SISTEMA DE COBRO. Es un tope por negocio y por hora, holgado a
 * propósito: un dueño que trabaja una tarde entera en el estudio no lo toca ni
 * de lejos. Reutiliza el limitador distribuido que ya existe en el portal
 * (`lib/seguridad.ts` + migración 273), no construye nada nuevo.
 *
 * Se cuenta por NEGOCIO y no por usuario: el costo lo genera la cuenta, y así
 * dos personas del mismo negocio no multiplican el tope.
 */
const TOPES = {
  /** Escribir el texto de un anuncio: barato y rápido, se usa mucho. */
  texto: { max: 120, ventanaSeg: 3600 },
  /** Generar una imagen: es lo más caro y lo más lento. */
  imagen: { max: 60, ventanaSeg: 3600 },
  /** Preguntarle al copiloto: caro, y encadenar preguntas es normal. */
  copiloto: { max: 100, ventanaSeg: 3600 },
} as const;

export type PasoConCosto = keyof typeof TOPES;

const TEXTO: Record<PasoConCosto, string> = {
  texto: "Escribiste muchos anuncios en la última hora. Espera unos minutos y sigue.",
  imagen: "Generaste muchas imágenes en la última hora. Espera unos minutos y sigue.",
  copiloto: "Le hiciste muchas preguntas al copiloto en la última hora. Espera unos minutos y sigue.",
};

/**
 * Devuelve null si puede seguir, o el texto a mostrar si topó.
 *
 * Si el limitador distribuido no está disponible cae al bucket en memoria de la
 * instancia, que es peor pero sigue protegiendo. Nunca bloquea por un fallo de
 * infraestructura: un error del limitador deja pasar.
 */
export async function cupoDisponible(clienteId: string, paso: PasoConCosto): Promise<string | null> {
  const { max, ventanaSeg } = TOPES[paso];
  try {
    const r = await limitarDistribuido(`mk:${paso}:${clienteId}`, max, ventanaSeg);
    if (r.ok) return null;
    console.error(JSON.stringify({ evento: "marketing.tope", paso, cliente: clienteId }));
    return TEXTO[paso];
  } catch {
    return null;
  }
}
