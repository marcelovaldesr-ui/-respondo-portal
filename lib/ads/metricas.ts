import type { Monto } from "@/lib/ads/moneda";

/**
 * MÉTRICAS DE PAUTA — y, sobre todo, cuánto vale cada una.
 *
 * EL PROBLEMA QUE RESUELVE ESTE ARCHIVO
 * Un panel de publicidad miente de la forma más difícil de detectar: mostrando
 * un cero. «Gasto: $0» y «Costo por lead: $0» son visualmente idénticos a un
 * dato real, y llevan a la conclusión exactamente opuesta a la verdad — que es
 * que todavía no sabemos cuánto se gastó porque no hay conexión con Meta.
 *
 * Por eso acá ninguna métrica es un número suelto: cada una viaja con su
 * CERTEZA, y la pantalla está obligada a distinguirlas.
 *
 *   · `medida`        — la contamos nosotros en la base, o la trae la
 *                        plataforma. Es un hecho.
 *   · `derivada`      — sale de dividir dos medidas (CTR, costo por lead).
 *                        Vale exactamente lo que valen sus dos partes.
 *   · `parcial`       — sabemos un PISO, no el total. El caso real: solo vemos
 *                        la plata que pasó por el enlace de pago; una
 *                        transferencia al banco existe y no la vemos.
 *   · `no_disponible` — falta una conexión o una configuración. **Nunca se
 *                        muestra como 0.**
 *
 * ⚠️ Este archivo es puro y sin dependencias de ejecución (el único import es
 * de tipos, que TypeScript borra). Así se puede probar con Node pelado, que es
 * donde se cazan los errores de aritmética de un informe.
 */

export type Certeza = "medida" | "derivada" | "parcial" | "no_disponible";

export type Metrica = {
  clave: string;
  etiqueta: string;
  /** El número, cuando existe. `null` = no se puede calcular todavía. */
  valor: number | null;
  /** Cuando la métrica es plata, acá va con su moneda. */
  monto?: Monto | null;
  certeza: Certeza;
  /** Qué significa, en una línea. Se muestra al pasar el mouse. */
  ayuda: string;
  /** Por qué no está, cuando no está. Tiene que decir cómo conseguirla. */
  motivo?: string;
  /** Mismo cálculo en el período anterior, para comparar. */
  antes?: number | null;
  /** true = que suba es malo (los costos). Cambia el color de la variación. */
  menosEsMejor?: boolean;
};

export type GrupoMetricas = {
  clave: "publicidad" | "captacion" | "calidad" | "negocio";
  titulo: string;
  descripcion: string;
  metricas: Metrica[];
};

/** Lo que nos da la plataforma (Meta). Null = no hay conexión. */
export type DatosPlataforma = {
  impresiones: number;
  clics: number;
  gasto: Monto;
  /** Conversaciones que Meta dice haber iniciado. Nuestra cuenta es la buena. */
  conversacionesMeta?: number | null;
} | null;

/** Lo que sabemos nosotros, contado en nuestra propia base. */
export type DatosPropios = {
  conversaciones: number;
  cotizaciones: number;
  agendadas: number;
  ventas: number;
  /** Solo lo cobrado por enlace de pago. Es un piso, nunca el total. */
  cobrado: Monto;
};

const SIN_CONEXION =
  "Se ve cuando conectes tu cuenta publicitaria de Meta. Hasta entonces no podemos saberlo, y preferimos decirlo antes que mostrarte un cero.";

function tasa(numerador: number, denominador: number): number | null {
  if (!denominador) return null;
  return (numerador / denominador) * 100;
}

function porUnidad(total: Monto | undefined | null, cantidad: number): Monto | null {
  if (!total || !cantidad) return null;
  return { valor: total.valor / cantidad, moneda: total.moneda };
}

/**
 * Arma los cuatro grupos de métricas.
 *
 * El orden de los grupos ES la tesis del producto: la publicidad va PRIMERA
 * porque es lo que la persona ya conoce, y las de negocio van ÚLTIMAS porque
 * son las que solo nosotros podemos calcular. Se lee de arriba abajo como el
 * camino que hace una persona desde que ve el aviso hasta que paga.
 */
export function armarMetricas(entrada: {
  plataforma: DatosPlataforma;
  propios: DatosPropios;
  anteriores?: { plataforma: DatosPlataforma; propios: DatosPropios } | null;
}): GrupoMetricas[] {
  const { plataforma, propios, anteriores } = entrada;
  const antesP = anteriores?.propios;
  const antesPlat = anteriores?.plataforma;

  /**
   * Las métricas que solo existen con conexión a Meta. Sin conexión NO valen 0:
   * valen `no_disponible` con el motivo escrito. `certeza` se pasa a mano
   * porque no todas son iguales — impresiones y clics los mide Meta, el CTR
   * sale de dividirlos y por lo tanto es `derivada`.
   */
  const conMeta = (
    m: Omit<Metrica, "certeza" | "motivo">,
    valor: number | null,
    certeza: Extract<Certeza, "medida" | "derivada"> = "medida",
  ): Metrica =>
    plataforma
      ? { ...m, valor, certeza }
      : { ...m, valor: null, monto: null, certeza: "no_disponible", motivo: SIN_CONEXION };

  const publicidad: GrupoMetricas = {
    clave: "publicidad",
    titulo: "Publicidad",
    descripcion: "Lo que ya ves en el Administrador de Anuncios de Meta",
    metricas: [
      conMeta(
        {
          clave: "impresiones",
          etiqueta: "Impresiones",
          valor: null,
          ayuda: "Cuántas veces se mostró tu anuncio.",
          antes: antesPlat?.impresiones ?? null,
        },
        plataforma?.impresiones ?? null,
      ),
      conMeta(
        {
          clave: "clics",
          etiqueta: "Clics",
          valor: null,
          ayuda: "Cuántas personas apretaron el anuncio.",
          antes: antesPlat?.clics ?? null,
        },
        plataforma?.clics ?? null,
      ),
      conMeta(
        {
          clave: "ctr",
          etiqueta: "CTR",
          valor: null,
          ayuda: "De cada 100 personas que lo vieron, cuántas apretaron.",
        },
        plataforma ? tasa(plataforma.clics, plataforma.impresiones) : null,
        "derivada",
      ),
      plataforma
        ? {
            clave: "gasto",
            etiqueta: "Invertido",
            valor: plataforma.gasto.valor,
            monto: plataforma.gasto,
            certeza: "medida",
            ayuda: "Lo que le pagaste a Meta en este período.",
            antes: antesPlat?.gasto.valor ?? null,
            menosEsMejor: false,
          }
        : {
            clave: "gasto",
            etiqueta: "Invertido",
            valor: null,
            monto: null,
            certeza: "no_disponible",
            ayuda: "Lo que le pagaste a Meta en este período.",
            motivo: SIN_CONEXION,
          },
    ],
  };

  /**
   * ⭐ ACÁ EMPIEZA LO QUE META NO SABE.
   * A partir de este grupo, las cifras salen de nuestras conversaciones. Se
   * pueden mostrar SIEMPRE, con o sin conexión publicitaria — y por eso Pauta
   * sirve desde el primer día, antes de conectar nada.
   */
  const captacion: GrupoMetricas = {
    clave: "captacion",
    titulo: "Lo que llegó",
    descripcion: "Contado en tus propias conversaciones, no en lo que reporta Meta",
    metricas: [
      {
        clave: "conversaciones",
        etiqueta: "Conversaciones",
        valor: propios.conversaciones,
        certeza: "medida",
        ayuda: "Personas que escribieron después de apretar un anuncio.",
        antes: antesP?.conversaciones ?? null,
      },
      {
        clave: "costo_conversacion",
        etiqueta: "Costo por conversación",
        valor: plataforma ? porUnidad(plataforma.gasto, propios.conversaciones)?.valor ?? null : null,
        monto: plataforma ? porUnidad(plataforma.gasto, propios.conversaciones) : null,
        certeza: plataforma ? "derivada" : "no_disponible",
        ayuda: "Cuánto te costó cada persona que escribió.",
        motivo: plataforma ? undefined : SIN_CONEXION,
        menosEsMejor: true,
      },
    ],
  };

  const calidad: GrupoMetricas = {
    clave: "calidad",
    titulo: "Qué pasó con esa gente",
    descripcion: "El camino desde que escribieron hasta que cerraron",
    metricas: [
      {
        clave: "cotizaciones",
        etiqueta: "Cotizaciones",
        valor: propios.cotizaciones,
        certeza: "medida",
        ayuda: "Conversaciones donde se llegó a dar un precio.",
        antes: antesP?.cotizaciones ?? null,
      },
      {
        clave: "agendadas",
        etiqueta: "Agendaron hora",
        valor: propios.agendadas,
        certeza: "medida",
        ayuda: "Conversaciones que terminaron con una hora tomada.",
        antes: antesP?.agendadas ?? null,
      },
      {
        clave: "ventas",
        etiqueta: "Ventas cerradas",
        valor: propios.ventas,
        certeza: "medida",
        ayuda: "Conversaciones marcadas como venta.",
        antes: antesP?.ventas ?? null,
      },
      {
        clave: "conversion",
        etiqueta: "De conversación a venta",
        valor: tasa(propios.ventas, propios.conversaciones),
        certeza: "derivada",
        ayuda: "De cada 100 que escribieron por un anuncio, cuántas compraron.",
        antes:
          antesP && antesP.conversaciones ? tasa(antesP.ventas, antesP.conversaciones) : null,
      },
    ],
  };

  /**
   * El grupo de negocio es el único donde una cifra puede ser PARCIAL sin ser
   * falsa: vemos lo que se pagó por el enlace, no lo que entró por
   * transferencia ni por el mesón. Decirlo es lo que separa un dato de una
   * promesa.
   */
  const mismaMoneda =
    plataforma && plataforma.gasto.moneda.toUpperCase() === propios.cobrado.moneda.toUpperCase();

  const negocio: GrupoMetricas = {
    clave: "negocio",
    titulo: "En plata",
    descripcion: "Lo único que decide si conviene seguir invirtiendo",
    metricas: [
      {
        clave: "costo_venta",
        etiqueta: "Costo por venta",
        valor: plataforma ? porUnidad(plataforma.gasto, propios.ventas)?.valor ?? null : null,
        monto: plataforma ? porUnidad(plataforma.gasto, propios.ventas) : null,
        certeza: plataforma ? "derivada" : "no_disponible",
        ayuda: "Cuánto costó en publicidad cada venta cerrada.",
        motivo: plataforma ? undefined : SIN_CONEXION,
        menosEsMejor: true,
      },
      {
        clave: "cobrado",
        etiqueta: "Cobrado",
        valor: propios.cobrado.valor,
        monto: propios.cobrado,
        certeza: "parcial",
        ayuda:
          "Lo que se pagó por el enlace de pago en conversaciones que vinieron de un anuncio.",
        motivo:
          "Es un piso, no el total: una venta cobrada por transferencia o en el local no pasa por acá.",
        antes: antesP?.cobrado.valor ?? null,
      },
      {
        clave: "roas",
        etiqueta: "Retorno",
        valor:
          plataforma && mismaMoneda && plataforma.gasto.valor > 0
            ? propios.cobrado.valor / plataforma.gasto.valor
            : null,
        certeza: !plataforma
          ? "no_disponible"
          : !mismaMoneda
            ? "no_disponible"
            : "parcial",
        ayuda: "Por cada peso invertido, cuántos volvieron por el enlace de pago.",
        motivo: !plataforma
          ? SIN_CONEXION
          : !mismaMoneda
            ? `Tu cuenta publicitaria factura en ${plataforma.gasto.moneda} y tus cobros están en ${propios.cobrado.moneda}. No mezclamos monedas: el número saldría mal.`
            : "Cuenta solo lo cobrado por enlace de pago, así que el retorno real es mayor.",
      },
    ],
  };

  return [publicidad, captacion, calidad, negocio];
}

/**
 * La variación entre dos períodos, con la misma honestidad que en el resto del
 * producto: **el porcentaje solo aparece si el período anterior tiene volumen
 * suficiente**. De 2 a 3 no es «+50%», es uno más.
 */
export function variacion(
  ahora: number | null | undefined,
  antes: number | null | undefined,
): { texto: string; signo: 1 | 0 | -1 } | null {
  if (ahora === null || ahora === undefined) return null;
  if (antes === null || antes === undefined) return null;
  if (antes === 0) return null;

  const signo: 1 | 0 | -1 = ahora > antes ? 1 : ahora < antes ? -1 : 0;
  if (antes < 10) {
    return { texto: `antes ${new Intl.NumberFormat("es-CL").format(Math.round(antes))}`, signo };
  }
  const pct = Math.round(((ahora - antes) / antes) * 100);
  return { texto: `${pct > 0 ? "+" : ""}${pct}%`, signo };
}

/** Cuántas métricas de un grupo se pueden mostrar de verdad. */
export function disponibles(g: GrupoMetricas): number {
  return g.metricas.filter((m) => m.certeza !== "no_disponible").length;
}
