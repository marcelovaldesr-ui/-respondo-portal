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
    href: "/pauta/conexion",
  },
  token_vencido: {
    codigo: "token_vencido",
    mensaje: "El permiso que nos diste en Meta venció. Hay que volver a autorizarlo.",
    accion: "Reconectar Meta",
    href: "/pauta/conexion",
  },
  sin_permiso: {
    codigo: "sin_permiso",
    mensaje:
      "La conexión con Meta no tiene permiso para leer esta cuenta publicitaria. Suele pasar cuando el usuario que autorizó ya no administra la cuenta.",
    accion: "Revisar la conexión",
    href: "/pauta/conexion",
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
    href: "/pauta/conexion",
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
    mensaje: "La conexión con Meta todavía no está habilitada en esta instalación de Respondo.",
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
};

export type ProveedorAds = {
  /** Cómo se llama, para los mensajes. */
  nombre: string;
  /** Las cuentas publicitarias a las que llegamos con la conexión guardada. */
  cuentas(clienteId: string): Promise<ResultadoAds<CuentaPublicitaria[]>>;
  /** Rendimiento por anuncio en un rango de fechas (AAAA-MM-DD, inclusive). */
  rendimiento(
    clienteId: string,
    rango: { desde: string; hasta: string },
  ): Promise<ResultadoAds<RendimientoAnuncio[]>>;
};
