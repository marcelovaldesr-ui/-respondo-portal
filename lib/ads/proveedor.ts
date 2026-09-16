import type { Monto } from "@/lib/ads/moneda";

/**
 * EL CONTRATO CON UNA PLATAFORMA DE ANUNCIOS.
 *
 * POR QUÉ EXISTE ESTA CAPA
 * No es arquitectura por gusto: es para que la palabra «Meta» aparezca en UN
 * solo archivo. Cuando el día de mañana entre Google —que llama `customer` a
 * la cuenta, `campaign_budget` al presupuesto y devuelve micros en vez de
 * pesos— lo único que hay que escribir es otro adaptador. Si en cambio el
 * `act_` de Meta se hubiera colado en las pantallas y en las consultas, ese día
 * habría que reescribir la sección entera.
 *
 * ⚠️ Y hasta ahí llega la abstracción. No hay fábrica de proveedores, ni
 * registro dinámico, ni interfaces de una sola implementación repartidas en
 * cinco archivos: hoy hay UN proveedor. Sobrearquitectura acá es exactamente el
 * monstruo de ad-tech que no podemos mantener entre dos personas.
 */

/** Nunca se lanza una excepción hacia la UI: se devuelve el motivo. */
export type ResultadoAds<T> =
  | { ok: true; datos: T }
  | { ok: false; error: ErrorAds };

/**
 * Los errores que la pantalla tiene que saber distinguir, porque cada uno se
 * resuelve distinto. Un «algo salió mal» genérico deja al dueño sin nada que
 * hacer, que es la peor forma de fallar.
 */
export type CodigoErrorAds =
  | "sin_conexion" // nunca se conectó
  | "token_vencido" // hay que reconectar
  | "sin_permiso" // el token no tiene el alcance necesario
  | "nivel_acceso" // el proyecto de Cloud todavía no puede leer cuentas reales
  | "limite_api" // Meta pidió esperar
  | "cuenta_invalida" // la cuenta ya no existe o cambió
  | "red" // timeout / caída
  | "respuesta_rara" // vino algo que no cumple el contrato
  | "no_configurado"; // falta una variable de entorno nuestra

export type ErrorAds = {
  codigo: CodigoErrorAds;
  /** Lo que se le muestra a una persona. Sin jerga, y con qué hacer. */
  mensaje: string;
  /** Texto del botón, cuando hay una salida. */
  accion?: string;
  /** A dónde lleva ese botón. */
  href?: string;
  /** Detalle técnico para los logs. NUNCA se muestra ni lleva secretos. */
  detalle?: string;
};

export const ERRORES: Record<CodigoErrorAds, ErrorAds> = {
  sin_conexion: {
    codigo: "sin_conexion",
    mensaje: "Todavía no conectaste una cuenta publicitaria de Meta.",
    accion: "Conectar Meta",
    href: "/marketing/integraciones",
  },
  token_vencido: {
    codigo: "token_vencido",
    mensaje: "El permiso que nos diste en Meta venció. Hay que volver a autorizarlo.",
    accion: "Reconectar Meta",
    href: "/marketing/integraciones",
  },
  sin_permiso: {
    codigo: "sin_permiso",
    mensaje:
      "La conexión con Meta no tiene permiso para leer esta cuenta publicitaria. Suele pasar cuando el usuario que autorizó ya no administra la cuenta.",
    accion: "Revisar la conexión",
    href: "/marketing/integraciones",
  },
  /**
   * ⚠️ Código propio, y no `sin_permiso`, por una razón concreta.
   *
   * Cuando el proyecto de Google Cloud todavía está en nivel «Prueba», Google
   * rechaza cualquier consulta a una cuenta real. Eso se traducía a
   * `sin_permiso`, cuyo texto dice «falta permiso para leer esa cuenta
   * publicitaria en Meta» — y mandaba a revisar permisos de Meta que estaban
   * perfectos, por un problema que vive en otra consola y de otra plataforma.
   * La explicación correcta existía, pero viajaba en `detalle`, que nunca se
   * muestra. Un diagnóstico que el producto tiene y no dice es un diagnóstico
   * que no tiene.
   */
  nivel_acceso: {
    codigo: "nivel_acceso",
    mensaje:
      "El proyecto de Google Cloud todavía tiene nivel de acceso «Prueba», así que Google no deja leer cuentas reales. No es un problema de tu cuenta ni de los permisos que diste: se sube en la consola de Cloud, en «Google Ads API» → «Apply for access», y con el nivel Explorador basta.",
    accion: "Reintentar",
    href: "/marketing/integraciones",
  },
  limite_api: {
    codigo: "limite_api",
    mensaje:
      "Meta nos pidió esperar unos minutos antes de volver a consultar. Los datos que ves son los de la última sincronización.",
  },
  cuenta_invalida: {
    codigo: "cuenta_invalida",
    mensaje: "La cuenta publicitaria que teníamos guardada ya no está disponible en Meta.",
    accion: "Elegir otra cuenta",
    href: "/marketing/integraciones",
  },
  red: {
    codigo: "red",
    mensaje: "No pudimos comunicarnos con Meta. Suele ser pasajero: reintenta en un momento.",
  },
  respuesta_rara: {
    codigo: "respuesta_rara",
    mensaje: "Meta respondió algo que no supimos interpretar. Ya quedó registrado para revisarlo.",
  },
  no_configurado: {
    codigo: "no_configurado",
    mensaje: "La lectura de tu cuenta publicitaria todavía no está activada. La activamos nosotros; escríbenos.",
  },
};

export function fallo<T>(codigo: CodigoErrorAds, detalle?: string): ResultadoAds<T> {
  return { ok: false, error: { ...ERRORES[codigo], detalle } };
}

/* ── Tipos del dominio (nuestros, no de Meta) ─────────────────────────────── */

export type CuentaPublicitaria = {
  id: string;
  nombre: string;
  moneda: string;
  zonaHoraria: string;
  /** 1 = activa en Meta. Se guarda tal cual para poder avisar si se apaga. */
  activa: boolean;
};

/** Métricas de UN anuncio en un período. Vocabulario nuestro, no de la API. */
export type RendimientoAnuncio = {
  anuncioId: string;
  anuncioNombre: string;
  campanaId: string;
  campanaNombre: string;
  conjuntoId: string;
  conjuntoNombre: string;
  impresiones: number;
  clics: number;
  gasto: Monto;
  /** Estado en Meta: sirve para no recomendar pausar algo ya pausado. */
  estado?: string;
  /** AAAA-MM-DD, solo cuando se pidió el desglose por día. */
  dia?: string;
};

export type ProveedorAds = {
  /** Cómo se llama, para los mensajes. */
  nombre: string;
  /** Las cuentas publicitarias a las que llegamos con la conexión guardada. */
  cuentas(clienteId: string): Promise<ResultadoAds<CuentaPublicitaria[]>>;
  /**
   * Rendimiento por anuncio en un rango de fechas (AAAA-MM-DD, inclusive).
   * Con `porDia` devuelve una fila por anuncio y por día, con `dia` cargado.
   */
  rendimiento(
    clienteId: string,
    rango: { desde: string; hasta: string },
    opciones?: { porDia?: boolean },
  ): Promise<ResultadoAds<RendimientoAnuncio[]>>;
};
