import { metaAdsConfigurado, conexionDe } from "@/lib/ads/meta";
import { googleAdsConfigurado } from "@/lib/ads/google";
import { estadoDeCanales } from "@/lib/ads/canales";
import { ERRORES, type CodigoErrorAds } from "@/lib/ads/proveedor";
import type { EstadoCanalPanorama } from "@/lib/marketing/tipos";
import type { VarianteDemo } from "@/lib/marketing/demo";
import { db } from "@/lib/db";
import { monedaConocida, normalizarMoneda } from "@/lib/ads/moneda";

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
  /**
   * La moneda en que facturan las cuentas publicitarias conectadas.
   *
   * ⚠️ `null` significa «no se sabe», y tiene DOS causas que no hay que
   * confundir: no hay ninguna cuenta conectada, o hay varias y facturan en
   * monedas distintas. En los dos casos la respuesta correcta es la misma —no
   * hay una moneda del negocio que usar— y en ninguno se rellena con «CLP».
   * Antes esto miraba solo Meta: un negocio con solo Google Ads conectado se
   * quedaba sin moneda aunque su cuenta la declarara.
   */
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

  /* ── Fase 6: el segundo canal ─────────────────────────────────────────── */
  /** La instalación tiene credenciales de Google Ads (proyecto Cloud propio). */
  puedeConectarGoogle: boolean;
  /** Este negocio ya tiene una cuenta de Google Ads leyendo. */
  googleConectada: boolean;
  /**
   * El estado de TODOS los canales, que es lo que miran las pantallas.
   *
   * Existe para que ninguna pantalla vuelva a preguntar «¿y Google?» con un
   * `if` propio: fue exactamente el problema que resolvió esta misma clase en
   * la Fase 4 cuando el único canal era Meta, y agregar el segundo con `if`
   * sueltos lo habría reabierto multiplicado por dos.
   */
  canales: EstadoCanalPanorama[];
  /** ¿Hay al menos una plataforma publicitaria leyendo? */
  hayCanalConectado: boolean;
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

/**
 * Capacidades de la demostración, SEGÚN LA VARIANTE.
 *
 * ⚠️ Antes devolvía todo encendido, y eso hacía que la demo mintiera sobre el
 * producto: en la variante «solo Meta» —un estudio jurídico sin bot— el
 * Arquitecto ofrecía WhatsApp como destino, que es justamente lo que ese
 * negocio NO tiene. Lo encontró la navegación real, no el typecheck.
 *
 * La regla de la demo es que muestre lo que producción puede mostrar; una
 * capacidad de más es tan falsa como una cifra de más.
 */
export function capacidadesDemo(variante: VarianteDemo = "completo"): Capacidades {
  const completo = variante === "completo";
  return {
    puedeConectarMeta: true,
    metaConectada: variante !== "google",
    metaFaltaElegirCuenta: false,
    monedaPublicidad: "CLP",
    whatsappConectado: completo,
    puedeDevolverVentas: completo,
    cobroPorEnlace: completo,
    puedeGenerarConIa: iaConfigurada(),
    puedeGuardar: true,
    puedePublicarEnMeta: PUEDE_PUBLICAR_EN_META,
    puedeConectarGoogle: true,
    googleConectada: variante !== "meta",
    canales: [
      { proveedor: "meta", nombre: "Meta", disponible: true, conectado: true, faltaElegirCuenta: false, cuentaNombre: "Gráfica Andina", moneda: "CLP" },
      { proveedor: "google", nombre: "Google Ads", disponible: true, conectado: true, faltaElegirCuenta: false, cuentaNombre: "Gráfica Andina", moneda: "CLP" },
    ],
    hayCanalConectado: true,
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

  const [conexion, cliente, canales] = await Promise.all([
    puedeConectarMeta ? conexionDe(clienteId) : Promise.resolve(null),
    leerCliente(clienteId),
    estadoDeCanales(clienteId),
  ]);

  const metaConectada = Boolean(conexion && conexion.cuentaId && conexion.estado === "conectada");
  const google = canales.find((c) => c.proveedor === "google");

  return {
    puedeConectarMeta,
    metaConectada,
    metaFaltaElegirCuenta: Boolean(conexion && !conexion.cuentaId),
    monedaPublicidad: monedaUnica(canales.filter((c) => c.conectado).map((c) => c.moneda)),
    whatsappConectado: Boolean(cliente.wabaId),
    puedeDevolverVentas: Boolean(cliente.wabaId && cliente.datasetId),
    cobroPorEnlace: Boolean(cliente.pagoLink),
    puedeGenerarConIa: iaConfigurada(),
    puedeGuardar: true, // lo ajusta `cargarMarketing` según existan las tablas
    puedePublicarEnMeta: PUEDE_PUBLICAR_EN_META,
    puedeConectarGoogle: googleAdsConfigurado(),
    googleConectada: Boolean(google?.conectado),
    canales: canales.map((c) => ({
      proveedor: c.proveedor,
      nombre: c.nombre,
      disponible: c.disponible,
      conectado: c.conectado,
      faltaElegirCuenta: c.faltaElegirCuenta,
      cuentaNombre: c.cuentaNombre,
      moneda: c.moneda,
    })),
    hayCanalConectado: canales.some((c) => c.conectado),
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
  c: Pick<
    Capacidades,
    | "puedeConectarMeta"
    | "puedeConectarGoogle"
    | "metaConectada"
    | "metaFaltaElegirCuenta"
    | "hayCanalConectado"
    | "canales"
  >,
  codigo?: CodigoErrorAds | null,
): string {
  /**
   * ⚠️ NO decir «tu plan». `puedeConectarMeta` depende de tres variables de
   * entorno de la instalación, no de lo que el negocio haya contratado. Culpar
   * al plan sería inventarle al dueño una causa comercial —y hacerle creer que
   * pagando más se arregla— cuando en realidad es un paso nuestro.
   */
  if (!c.puedeConectarMeta && !c.puedeConectarGoogle) {
    return "La lectura de tu cuenta publicitaria todavía no está activada. La activamos nosotros; escríbenos.";
  }

  /**
   * Se miran TODOS los canales y no solo Meta: preguntando `metaConectada`,
   * un negocio con Google leyendo y gastando leía «conéctala» debajo de su
   * propio gasto. Quien ya conectó algo nunca recibe una invitación a conectar.
   */
  if (!c.hayCanalConectado) {
    const aMedias = c.canales.find((x) => x.faltaElegirCuenta) ?? null;
    if (aMedias) return `Falta elegir cuál de tus cuentas de ${aMedias.nombre} mirar, en Integraciones.`;
    if (c.metaFaltaElegirCuenta) return "Falta elegir cuál de tus cuentas publicitarias mirar, en Integraciones.";
    return "Se ve cuando conectes tu cuenta publicitaria en Integraciones.";
  }

  /**
   * Hay cuenta conectada: el motivo no es «conéctala». `codigo` sale de la
   * lectura de Meta, así que solo se cuenta cuando Meta es una de las cuentas
   * conectadas; a quien solo tiene Google, un «sin conexión» de Meta le
   * explicaría una falla que no es la suya.
   */
  if (codigo && c.metaConectada) return ERRORES[codigo].mensaje;
  return "Tu cuenta publicitaria no reportó gasto en este período.";
}

/**
 * Una sola moneda, o ninguna.
 *
 * Con dos cuentas en monedas distintas NO hay «la moneda del negocio»: sumar o
 * comparar sus cifras exigiría un tipo de cambio que no tenemos. Devolver null
 * es lo que hace que las pantallas muestren cada canal por separado en vez de
 * un total que no significa nada.
 */
function monedaUnica(monedas: (string | null | undefined)[]): string | null {
  const validas = new Set(monedas.map((m) => normalizarMoneda(m)).filter((m) => monedaConocida(m)));
  return validas.size === 1 ? [...validas][0] : null;
}
