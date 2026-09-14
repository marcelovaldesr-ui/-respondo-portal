import { conexionDe, metaAdsConfigurado, rendimientoMetaMulti } from "@/lib/ads/meta";
import { conexionGoogleDe, googleAdsConfigurado, rendimientoGoogle } from "@/lib/ads/google";
import { ERRORES, type CodigoErrorAds } from "@/lib/ads/proveedor";
import { NIVELES_DE, NOMBRE_PROVEEDOR, PROVEEDORES, type FilaRendimiento, type Nivel, type Proveedor } from "@/lib/ads/canal";

/**
 * EL REGISTRO DE CANALES — quién está conectado y cómo se le pregunta a todos.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE GOBIERNA ESTE ARCHIVO: **una plataforma caída no puede tumbar
 * Marketing.** Google y Meta se consultan en paralelo y cada una falla por su
 * cuenta. Si Google devuelve 429 y Meta responde, la pantalla muestra Meta y
 * dice qué pasó con Google — no un error global ni, peor, un cero.
 *
 * Es el mismo criterio que ya aplicaba `cargarMarketing` con Meta: «si Meta se
 * cae, las cifras propias aparecen igual». Acá se extiende a N proveedores.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type EstadoCanal = {
  proveedor: Proveedor;
  nombre: string;
  /** La instalación tiene credenciales para este proveedor. */
  disponible: boolean;
  /** Este negocio tiene una conexión guardada y viva. */
  conectado: boolean;
  /** Falta elegir cuál cuenta publicitaria leer. */
  faltaElegirCuenta: boolean;
  cuentaNombre: string | null;
  moneda: string | null;
  /** Niveles que este proveedor puede entregar. */
  niveles: readonly Nivel[];
};

/**
 * En qué pie está cada canal para este negocio.
 *
 * Dos consultas, en paralelo, y ninguna lanza: una integración sin configurar
 * es un estado normal del producto, no un error.
 */
export async function estadoDeCanales(clienteId: string): Promise<EstadoCanal[]> {
  const [meta, google] = await Promise.all([
    metaAdsConfigurado() ? conexionDe(clienteId) : Promise.resolve(null),
    googleAdsConfigurado() ? conexionGoogleDe(clienteId) : Promise.resolve(null),
  ]);

  return [
    {
      proveedor: "meta",
      nombre: NOMBRE_PROVEEDOR.meta,
      disponible: metaAdsConfigurado(),
      conectado: Boolean(meta && meta.cuentaId && meta.estado === "conectada"),
      faltaElegirCuenta: Boolean(meta && !meta.cuentaId),
      cuentaNombre: meta?.cuentaNombre ?? null,
      moneda: meta?.moneda ?? null,
      niveles: NIVELES_DE.meta,
    },
    {
      proveedor: "google",
      nombre: NOMBRE_PROVEEDOR.google,
      disponible: googleAdsConfigurado(),
      conectado: Boolean(google && google.cuentaId && google.estado === "conectada"),
      faltaElegirCuenta: Boolean(google && !google.cuentaId),
      cuentaNombre: google?.cuentaNombre ?? null,
      moneda: google?.moneda ?? null,
      niveles: NIVELES_DE.google,
    },
  ];
}

export type FallaCanal = {
  proveedor: Proveedor;
  codigo: CodigoErrorAds;
  mensaje: string;
  accion?: string;
  href?: string;
};

export type RendimientoMulticanal = {
  filas: FilaRendimiento[];
  /** Los que respondieron con datos (aunque fueran cero filas). */
  respondieron: Proveedor[];
  /** Los que fallaron, con el motivo ya escrito para una persona. */
  fallas: FallaCanal[];
  /** Los que este negocio tiene conectados, respondan o no. */
  conectados: Proveedor[];
};

/**
 * Pide el rendimiento a TODOS los canales conectados, en paralelo.
 *
 * `niveles` es por proveedor: pedirle términos de búsqueda a Meta no tiene
 * sentido y pedirle frecuencia a Google tampoco. Cada proveedor recibe solo los
 * niveles que declara en `NIVELES_DE`, así que quien llama puede pedir el
 * conjunto grande sin preguntarse quién soporta qué.
 */
export async function rendimientoMulticanal(
  clienteId: string,
  rango: { desde: string; hasta: string },
  niveles: Nivel[] = ["campana"],
): Promise<RendimientoMulticanal> {
  const estados = await estadoDeCanales(clienteId);
  const conectados = estados.filter((e) => e.conectado).map((e) => e.proveedor);

  const pedidos = conectados.map(async (proveedor) => {
    const suyos = niveles.filter((n) => NIVELES_DE[proveedor].includes(n));
    if (!suyos.length) return { proveedor, filas: [] as FilaRendimiento[], falla: null as FallaCanal | null };

    const r =
      proveedor === "meta"
        ? await rendimientoMetaMulti(clienteId, rango, suyos)
        : await rendimientoGoogle(clienteId, rango, suyos);

    if (!r.ok) {
      /**
       * Diagnosticable sin pedirle una captura a nadie, y sin filtrar nada:
       * negocio, proveedor, clase de error y detalle acotado. Nunca el token.
       */
      console.error(
        JSON.stringify({
          evento: "marketing.canal_falla",
          proveedor,
          cliente: clienteId,
          clase: r.error.codigo,
          detalle: (r.error.detalle ?? "").slice(0, 300),
        }),
      );
      return {
        proveedor,
        filas: [] as FilaRendimiento[],
        falla: {
          proveedor,
          codigo: r.error.codigo,
          // El mensaje del catálogo nombra a Meta; acá puede ser Google.
          mensaje: mensajeDeFalla(proveedor, r.error.codigo),
          accion: r.error.accion,
          href: r.error.href,
        } satisfies FallaCanal,
      };
    }
    return { proveedor, filas: r.datos, falla: null as FallaCanal | null };
  });

  const resultados = await Promise.all(pedidos);

  return {
    filas: resultados.flatMap((r) => r.filas),
    respondieron: resultados.filter((r) => !r.falla).map((r) => r.proveedor),
    fallas: resultados.map((r) => r.falla).filter((f): f is FallaCanal => Boolean(f)),
    conectados,
  };
}

/**
 * El mensaje de error, con el nombre del proveedor correcto.
 *
 * El catálogo de `proveedor.ts` se escribió cuando Meta era el único y dice
 * «Meta» en el texto. Decirle a alguien «reconecta Meta» cuando lo que venció
 * fue Google lo manda a la pantalla equivocada, así que acá se sustituye.
 */
export function mensajeDeFalla(proveedor: Proveedor, codigo: CodigoErrorAds): string {
  const base = ERRORES[codigo].mensaje;
  if (proveedor === "meta") return base;
  return base
    .replace(/cuenta publicitaria de Meta/g, "cuenta de Google Ads")
    .replace(/\bMeta\b/g, "Google");
}

/** Los niveles que vale la pena pedir cuando se quiere el panorama completo. */
export const NIVELES_PANORAMA: Nivel[] = ["campana", "grupo", "conjunto", "anuncio"];

/** Todo lo que Google puede dar para el análisis de búsqueda. */
export const NIVELES_BUSQUEDA: Nivel[] = ["campana", "grupo", "anuncio", "palabra", "termino"];

/** ¿Este negocio tiene más de un canal conectado? Decide si la UI compara. */
export function hayVariosCanales(estados: EstadoCanal[]): boolean {
  return estados.filter((e) => e.conectado).length > 1;
}

/** Canales que la instalación soporta, para la pantalla de integraciones. */
export function canalesDisponibles(): Proveedor[] {
  return PROVEEDORES.filter((p) => (p === "meta" ? metaAdsConfigurado() : googleAdsConfigurado()));
}
