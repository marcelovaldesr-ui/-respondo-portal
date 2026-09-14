import { ETIQUETA_RESULTADO, type TipoResultado } from "@/lib/ads/canal";
import type { Senales } from "@/lib/ads/senales";
import type { EscalonEmbudo } from "@/lib/marketing/tipos";

/**
 * EL EMBUDO QUE SE ADAPTA A LO QUE EL NEGOCIO PUEDE VER.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA: el embudo tenía seis escalones fijos y los cuatro últimos salían
 * de conversaciones de WhatsApp. Un negocio que pauta y no trae la conversación
 * a Respondo veía dos escalones con datos y cuatro en cero — y un embudo que
 * termina en cero no se lee como «esto no aplica», se lee como «acá no vende
 * nadie».
 *
 * LA REGLA NUEVA: **un escalón existe solo si se puede medir.** No hay ceros de
 * relleno ni etapas «próximamente». El embudo de un negocio solo-ads tiene tres
 * escalones honestos y se ve completo; el de Impresora Color tiene seis y
 * también. Ninguno de los dos miente.
 *
 * ⚠️ Y NO SE INVENTAN ETAPAS. Si la plataforma no reporta resultados, el embudo
 * llega hasta los clics y ahí termina: no se rellena con una estimación ni con
 * una etapa «visitas al sitio» que no estamos midiendo.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type EntradaEmbudo = {
  impresiones: number | null;
  clics: number | null;
  /** Lo que reporta la plataforma publicitaria, con su tipo. */
  resultados: number | null;
  tipoResultado: TipoResultado | null;
  /** Lo que sabemos nosotros. Solo con señal de conversaciones. */
  conversaciones: number;
  calificados: number;
  avanzados: number;
  ventas: number;
};

const tasa = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : (a / b) * 100);

/**
 * Arma el embudo con los escalones que correspondan.
 *
 * ⭐ LA TASA SE CALCULA CONTRA EL ESCALÓN ANTERIOR **QUE EXISTE**, no contra
 * uno fijo. Si no hay escalón de resultados, «conversaciones» se compara contra
 * clics; si lo hay, contra resultados. Calcular siempre contra el mismo índice
 * daba porcentajes absurdos (o «—») en cuanto el embudo cambiaba de largo.
 */
export function armarEmbudoAdaptativo(v: EntradaEmbudo, senales: Senales): EscalonEmbudo[] {
  const escalones: EscalonEmbudo[] = [];
  let anterior: number | null = null;

  const agregar = (e: Omit<EscalonEmbudo, "tasa">) => {
    escalones.push({ ...e, tasa: tasa(e.valor, anterior) });
    if (e.valor !== null) anterior = e.valor;
  };

  if (senales.ads) {
    agregar({
      clave: "impresiones",
      etiqueta: "Impresiones",
      valor: v.impresiones,
      definicion: "Veces que se mostró un anuncio. Lo reporta la plataforma.",
    });
    agregar({
      clave: "clics",
      etiqueta: "Clics",
      valor: v.clics,
      definicion: "Personas que apretaron el anuncio. Lo reporta la plataforma.",
    });
  }

  if (senales.conversiones && v.resultados !== null) {
    /**
     * El nombre del escalón ES el tipo de resultado, no la palabra «resultados».
     * «Conversiones del sitio» y «Conversaciones iniciadas» son cosas distintas
     * y llamarlas igual invita a compararlas entre negocios.
     */
    agregar({
      clave: "resultados",
      etiqueta: ETIQUETA_RESULTADO[v.tipoResultado ?? "desconocido"],
      valor: v.resultados,
      definicion:
        v.tipoResultado === "mensajes"
          ? "Conversaciones que la plataforma dice haber iniciado. Es su cuenta, no la nuestra."
          : "Conversiones que declara la plataforma publicitaria con la medición configurada en la cuenta.",
    });
  }

  if (senales.conversaciones) {
    agregar({
      clave: "conversaciones",
      etiqueta: "Conversaciones",
      valor: v.conversaciones,
      definicion: "Personas que escribieron después del clic. Las contamos nosotros, una por chat.",
    });
    agregar({
      clave: "calificados",
      etiqueta: "Calificados",
      valor: v.calificados,
      definicion:
        "Conversaciones que avanzaron a «interesado» o más en el embudo, o que cotizaron, reservaron o compraron.",
    });
    agregar({
      clave: "avanzados",
      etiqueta: "Cotizaron o reservaron",
      valor: v.avanzados,
      definicion: "Se envió una cotización o se tomó una hora. Contado una vez por persona.",
    });
  }

  if (senales.ingresos || (senales.conversaciones && v.ventas > 0)) {
    agregar({
      clave: "ventas",
      etiqueta: "Ventas",
      valor: v.ventas,
      definicion: "Venta confirmada o cobro pagado por el enlace.",
    });
  }

  return escalones;
}

/**
 * El titular del embudo: qué mide cada mitad.
 *
 * Reemplaza al claim que la Fase 4 ya había corregido una vez («Meta ve hasta
 * acá / Respondo ve desde acá», que era falso). Ahora además tiene que ser
 * cierto para un negocio sin conversaciones, donde no hay segunda mitad.
 */
export function tituloEmbudo(senales: Senales): { izquierda: string; derecha: string | null; bajada: string } {
  if (!senales.conversaciones) {
    return {
      izquierda: "LO QUE HACE EL ANUNCIO",
      derecha: null,
      bajada: senales.conversiones
        ? "Tu cuenta publicitaria mide la entrega del aviso y las conversiones que tiene configuradas."
        : "Tu cuenta publicitaria mide la entrega del aviso. Todavía no reporta conversiones.",
    };
  }
  return {
    izquierda: "LO QUE HACE EL ANUNCIO",
    derecha: "LO QUE HACE EL CLIENTE",
    bajada: "Tu cuenta publicitaria mide la entrega del aviso; Respondo sigue a la persona hasta la venta.",
  };
}
