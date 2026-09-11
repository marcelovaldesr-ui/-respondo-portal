import { metaAdsConfigurado, conexionDe } from "@/lib/ads/meta";
import { ERRORES, type CodigoErrorAds } from "@/lib/ads/proveedor";
import { db } from "@/lib/db";

/**
 * QUÉ PUEDE HACER ESTE NEGOCIO, EN UN SOLO LUGAR.
 *
 * EL PROBLEMA QUE RESUELVE: antes cada pantalla decidía por su cuenta si se
 * podía conectar Meta, y ninguna salvo Integraciones sabía que la app de Meta
 * puede no estar habilitada en la instalación. Resultado: el inicio ofrecía
 * «Conectar Meta» con un botón grande mientras Integraciones, tres clics más
 * allá, decía «No disponible en esta instalación». Eso frente a un cliente no
 * es un detalle: es la pantalla contradiciéndose sola.
 *
 * LA REGLA: la UI nunca ofrece una acción que el producto no puede ejecutar.
 * Si `puedeConectarMeta` es false, no existe ningún botón «Conectar Meta» en
 * ninguna parte, y el motivo de cada cifra ausente cambia —«no está habilitada
 * todavía no está activada» y no «conéctala», que sería mandarlo a una puerta cerrada.
 *
 * DOS EJES, Y NO HAY QUE CONFUNDIRLOS:
 *   · PUEDE  — la instalación lo soporta (variables de entorno, migraciones).
 *              No depende del negocio y el dueño no puede cambiarlo.
 *   · ESTÁ   — este negocio ya lo configuró. Sí depende del dueño.
 * «Conectar» solo se ofrece cuando PUEDE y no ESTÁ. Cuando no PUEDE, se
 * informa; nunca se invita.
 */
export type Capacidades = {
  /** La instalación tiene la app de Meta configurada (env completas). */
  puedeConectarMeta: boolean;
  /** Este negocio ya tiene una cuenta publicitaria leyendo. */
  metaConectada: boolean;
  /** Hay conexión guardada pero falta elegir la cuenta publicitaria. */
  metaFaltaElegirCuenta: boolean;
  /** Moneda en la que factura la cuenta publicitaria. null sin conexión. */
  monedaPublicidad: string | null;
  /** WhatsApp conectado: sin esto no hay atribución ni eventos de vuelta. */
  whatsappConectado: boolean;
  /** Se le pueden devolver conversiones a Meta (requiere WhatsApp + conjunto de datos). */
  puedeDevolverVentas: boolean;
  /** El negocio tiene enlace de pago: sin esto no hay ingresos ni retorno. */
  cobroPorEnlace: boolean;
  /** Hay motor de IA disponible en la instalación (texto e imagen). */
  puedeGenerarConIa: boolean;
  /** Las tablas de creatividades y borradores existen. */
  puedeGuardar: boolean;
  /** Respondo puede publicar campañas en Meta por API. Hoy: no, a propósito. */
  puedePublicarEnMeta: boolean;
};

/**
 * `PUEDE_PUBLICAR` vivía como constante local en un archivo de acciones y el
 * asistente dibujaba «No disponible» con texto fijo, sin leerla. Si algún día
 * se habilita, la pantalla seguiría diciendo que no. Ahora es una sola cosa.
 *
 * Publicar por API exige el permiso `ads_management` y la revisión de la
 * aplicación en Meta. No se pidió: Respondo es de solo lectura sobre la cuenta
 * publicitaria, y esa es una decisión de producto, no una limitación temporal.
 */
const PUEDE_PUBLICAR_EN_META = false;

/** La instalación tiene motor de IA. Igual que Meta: es de la instalación. */
export function iaConfigurada(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Capacidades de la demostración: todo encendido menos publicar. */
export function capacidadesDemo(): Capacidades {
  return {
    puedeConectarMeta: true,
    metaConectada: true,
    metaFaltaElegirCuenta: false,
    monedaPublicidad: "CLP",
    whatsappConectado: true,
    puedeDevolverVentas: true,
    cobroPorEnlace: true,
    puedeGenerarConIa: iaConfigurada(),
    puedeGuardar: true,
    puedePublicarEnMeta: PUEDE_PUBLICAR_EN_META,
  };
}

/**
 * Las capacidades reales del negocio. Una sola consulta al cliente y una
 * lectura de la conexión: barato, y todas las pantallas lo comparten.
 *
 * `metaConectada` acá significa «hay una cuenta elegida y la conexión está
 * viva», NO «la última llamada a Meta salió bien». Son cosas distintas: que
 * Meta esté caída un minuto no es que el negocio no tenga cuenta conectada, y
 * confundirlas hacía que un 429 pasajero se mostrara como «conecta tu cuenta».
 */
export async function capacidadesDe(clienteId: string): Promise<Capacidades> {
  const puedeConectarMeta = metaAdsConfigurado();

  const [conexion, cliente] = await Promise.all([
    puedeConectarMeta ? conexionDe(clienteId) : Promise.resolve(null),
    leerCliente(clienteId),
  ]);

  const metaConectada = Boolean(conexion && conexion.cuentaId && conexion.estado === "conectada");

  return {
    puedeConectarMeta,
    metaConectada,
    metaFaltaElegirCuenta: Boolean(conexion && !conexion.cuentaId),
    monedaPublicidad: metaConectada ? (conexion?.moneda ?? null) : null,
    whatsappConectado: Boolean(cliente.wabaId),
    puedeDevolverVentas: Boolean(cliente.wabaId && cliente.datasetId),
    cobroPorEnlace: Boolean(cliente.pagoLink),
    puedeGenerarConIa: iaConfigurada(),
    puedeGuardar: true, // lo ajusta `cargarMarketing` según existan las tablas
    puedePublicarEnMeta: PUEDE_PUBLICAR_EN_META,
  };
}

/**
 * Nunca lanza: si la columna o la migración no están, el módulo tiene que
 * poder decir «falta configurar» en vez de caerse entero.
 */
async function leerCliente(clienteId: string): Promise<{
  wabaId: string | null;
  datasetId: string | null;
  pagoLink: string | null;
}> {
  try {
    const { data } = await db()
      .from("ed_clientes")
      .select("waba_id, ads_dataset_id, pago_link_base")
      .eq("id", clienteId)
      .maybeSingle();
    return {
      wabaId: (data?.waba_id as string | null) ?? null,
      datasetId: (data?.ads_dataset_id as string | null) ?? null,
      pagoLink: (data?.pago_link_base as string | null) ?? null,
    };
  } catch {
    return { wabaId: null, datasetId: null, pagoLink: null };
  }
}

/**
 * POR QUÉ FALTA UNA CIFRA DE PUBLICIDAD, en palabras del dueño.
 *
 * Un solo texto para todo el módulo. Antes había cinco variantes distintas
 * («Requiere Meta», «Requiere la cuenta conectada», «Se ve cuando conectes tu
 * cuenta publicitaria de Meta»…) y todas asumían que conectarla era posible.
 */
export function motivoSinPublicidad(
  c: Pick<Capacidades, "puedeConectarMeta" | "metaConectada" | "metaFaltaElegirCuenta">,
  codigo?: CodigoErrorAds | null,
): string {
  /**
   * ⚠️ NO decir «tu plan». `puedeConectarMeta` depende de tres variables de
   * entorno de la instalación, no de lo que el negocio haya contratado. Culpar
   * al plan sería inventarle al dueño una causa comercial —y hacerle creer que
   * pagando más se arregla— cuando en realidad es un paso nuestro.
   */
  if (!c.puedeConectarMeta) return "La lectura de tu cuenta publicitaria todavía no está activada. La activamos nosotros; escríbenos.";
  if (c.metaFaltaElegirCuenta) return "Falta elegir cuál de tus cuentas publicitarias mirar, en Integraciones.";
  if (!c.metaConectada) return "Se ve cuando conectes tu cuenta publicitaria en Integraciones.";
  /**
   * La cuenta SÍ está conectada: entonces el motivo no es «conéctala». Un
   * límite de consultas o una caída pasajera tienen su propio texto, ya escrito
   * para una persona en el catálogo del proveedor.
   */
  if (codigo) return ERRORES[codigo].mensaje;
  return "Tu cuenta publicitaria no reportó gasto en este período.";
}
