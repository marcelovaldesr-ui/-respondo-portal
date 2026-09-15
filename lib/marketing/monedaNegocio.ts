import { db } from "@/lib/db";
import { MONEDA_DESCONOCIDA, monedaConocida, normalizarMoneda, type Moneda } from "@/lib/ads/moneda";

/**
 * LA MONEDA EN QUE COBRA EL NEGOCIO — que NO es la de su cuenta publicitaria.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOS MONEDAS QUE NO SON LA MISMA, Y EL PRODUCTO LAS CONFUNDÍA
 *
 *   · moneda de PUBLICIDAD → en qué factura Meta o Google. La declara la
 *     plataforma y viene por API. Si no viene, NO se inventa: ver `moneda.ts`.
 *   · moneda del NEGOCIO   → en qué cobra este negocio a sus clientes. Es lo
 *     que mide `cobrado`, que en Respondo sale de los enlaces de pago.
 *
 * Una cuenta de Meta en dólares con un negocio que cobra en pesos es el caso
 * normal, no el raro. Por eso el retorno sobre la inversión solo se calcula
 * cuando las dos monedas coinciden, y cuando no, se dice.
 *
 * ⚠️ POR QUÉ ESTO NO ES UN `?? "CLP"` MÁS
 *
 * En `datos.ts` y en `atribucion.ts` había un `monedaNegocio = "CLP"` escrito a
 * mano —y en `atribucion.ts`, con un comentario encima que decía «se lee del
 * cliente en vez de asumir CLP», que era literalmente falso—. La diferencia con
 * lo de arriba es real y vale la pena decirla: la moneda de la cuenta
 * publicitaria es un HECHO EXTERNO que la API entrega o no entrega, y afirmarlo
 * sin dato es inventar; la moneda del negocio es una CONFIGURACIÓN de esta
 * instalación, que se declara y se puede cambiar. Por eso acá sí hay un valor
 * por defecto, y por eso está en una variable de entorno y en una columna del
 * cliente, en vez de en medio de una función.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Lo que cobra esta instalación si nadie dice otra cosa. Respondo nace en Chile. */
export function monedaPorDefecto(): Moneda {
  const env = normalizarMoneda(process.env.RESPONDO_MONEDA_NEGOCIO);
  return monedaConocida(env) ? env : "CLP";
}

/**
 * La moneda de UN negocio. La columna `ed_clientes.moneda` la agrega la
 * migración 311; sin ella —o sin valor— se usa la de la instalación.
 *
 * PostgREST rechaza el select ENTERO cuando una columna no existe, así que el
 * fallo se atrapa y se responde con el valor por defecto en vez de dejar sin
 * moneda a todas las pantallas de una instalación que no aplicó la migración.
 */
export async function monedaDelNegocio(clienteId: string): Promise<Moneda> {
  try {
    const { data, error } = await db().from("ed_clientes").select("moneda").eq("id", clienteId).maybeSingle();
    if (error) return monedaPorDefecto();
    const m = normalizarMoneda((data as Record<string, unknown> | null)?.moneda);
    return monedaConocida(m) ? m : monedaPorDefecto();
  } catch {
    return monedaPorDefecto();
  }
}

/**
 * ¿Se puede calcular el retorno de esta campaña?
 *
 * Solo si la plata gastada y la plata cobrada están en la misma moneda. No hay
 * tipo de cambio que inventar: un ROAS calculado sobre dólares gastados y pesos
 * cobrados es un número con tres decimales y cero significado.
 */
export function retornoComparable(monedaPublicidad: Moneda | null, monedaNegocio: Moneda): boolean {
  const a = normalizarMoneda(monedaPublicidad ?? MONEDA_DESCONOCIDA);
  const b = normalizarMoneda(monedaNegocio);
  return monedaConocida(a) && monedaConocida(b) && a === b;
}
