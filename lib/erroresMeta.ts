/**
 * TRADUCIR EL ERROR DE UN ENVÍO A ALGO QUE UNA PERSONA PUEDA ACTUAR — puro,
 * sin imports de `@/`, para probarlo con `node --test`.
 *
 * POR QUÉ EXISTE (auditoría 3-sep-2026)
 * -------------------------------------
 * `enviarTexto`, `enviarMediaMeta`, `enviarPlantilla` y los envíos por WAHA
 * devuelven el error CRUDO del proveedor: `HTTP 400: {"error":{"message":
 * "(#131047) Re-engagement message", ...}}`. Ese texto llegaba tal cual a la
 * pantalla de Cecilia. Solo la ruta de plantillas traducía tres códigos, y las
 * otras cuatro rutas (responder, adjunto, cobro, externo) no traducían nada.
 *
 * Un error que no dice qué hacer es un mensaje que la persona reintenta tres
 * veces y después manda desde el teléfono. Acá vive UNA sola tabla de
 * traducciones; todos los caminos de salida la usan.
 *
 * Los strings crudos NO se cambian en whatsapp.ts/waha.ts a propósito: otros
 * módulos los reconocen por igualdad exacta (`obsoleto:llego_mensaje_nuevo`,
 * `waha_pertenece_a_otro_cliente`). Esto es solo la capa de presentación.
 */

/** Código numérico de Meta dentro del error crudo, si lo hay. */
export function codigoDeErrorMeta(crudo: string | null | undefined): number | null {
  if (!crudo) return null;
  // Formato JSON del Graph API: {"error":{"code":131047,...}}
  const json = crudo.match(/"code"\s*:\s*(\d{2,7})/);
  if (json) return Number(json[1]);
  // Formato en el mensaje: "(#131047) Re-engagement message"
  const paren = crudo.match(/\(#(\d{2,7})\)/);
  if (paren) return Number(paren[1]);
  // Formato de los ACKs guardados en estado_envio_detalle: "131047: ..."
  const prefijo = crudo.match(/^(\d{2,7}):/);
  if (prefijo) return Number(prefijo[1]);
  return null;
}

/**
 * Traducciones por código. Escritas para quien atiende, no para quien
 * programa: dicen QUÉ HACER. Fuente: códigos de error de la Cloud API.
 */
const POR_CODIGO: Record<number, string> = {
  131047:
    "WhatsApp no aceptó el mensaje: pasaron más de 24 h desde el último mensaje del cliente. " +
    "Retoma la conversación con una plantilla.",
  131026:
    "Este número no puede recibir mensajes: no tiene WhatsApp, bloqueó al negocio o no aceptó " +
    "los términos nuevos de WhatsApp.",
  131021: "No se puede enviar un mensaje al propio número del negocio.",
  131030:
    "Este número no está en la lista de prueba de WhatsApp. Mientras el número del negocio esté " +
    "en modo de pruebas, solo puede escribir a los números autorizados en Meta.",
  131049:
    "WhatsApp decidió no entregar este mensaje para no saturar al cliente (límite de mensajes " +
    "de marketing por persona). Intenta más tarde o con un mensaje de servicio.",
  131053: "WhatsApp no pudo procesar el archivo. Prueba con otro formato o uno más liviano.",
  131056:
    "WhatsApp está limitando los envíos a este cliente: se le escribió demasiadas veces seguidas. " +
    "Espera unos minutos.",
  130429: "WhatsApp está limitando los envíos de este número por ahora. Espera unos minutos e intenta de nuevo.",
  80007: "WhatsApp está limitando los envíos de este número por ahora. Espera unos minutos e intenta de nuevo.",
  131048:
    "WhatsApp restringió los envíos de este número por reportes de spam. Revisa la calidad del " +
    "número en Meta antes de seguir enviando.",
  131031:
    "El número de WhatsApp del negocio está restringido o suspendido por Meta. Hay que revisarlo " +
    "en el administrador de WhatsApp Business.",
  133010: "El número del negocio no está registrado en la API de WhatsApp. Hay que volver a conectarlo.",
  132001: "Esa plantilla todavía no está aprobada en el WhatsApp de este negocio.",
  132000: "Los datos de la plantilla no calzan con la versión aprobada.",
  132012: "Los datos de la plantilla no calzan con la versión aprobada.",
  132015: "Esa plantilla está pausada por Meta por baja calidad. Usa otra.",
  132016: "Esa plantilla fue deshabilitada por Meta. Usa otra.",
  190: "La conexión con WhatsApp venció. Hay que volver a conectar el número desde Configuración.",
  368: "Meta bloqueó temporalmente esta acción por una infracción de políticas. Revisa el estado del número.",
  4: "Meta está limitando las llamadas de la aplicación por ahora. Intenta en unos minutos.",
  10: "La aplicación no tiene permiso para enviar desde este número. Hay que volver a conectar WhatsApp.",
  200: "La aplicación no tiene permiso para enviar desde este número. Hay que volver a conectar WhatsApp.",
  100:
    "WhatsApp rechazó los datos del mensaje. Si el error se repite, el número puede haber perdido la " +
    "conexión: revísalo en Configuración.",
};

/** Errores que no vienen de Meta pero también llegan a la persona. */
const INTERNOS: { prueba: (s: string) => boolean; texto: string }[] = [
  {
    prueba: (s) => s === "waha_pertenece_a_otro_cliente",
    texto:
      "Este negocio no tiene un WhatsApp propio conectado por este canal: el mensaje NO salió. " +
      "Conecta el número desde Configuración.",
  },
  {
    prueba: (s) => /^Falta (WAHA_API|META_|WHATSAPP_)/.test(s),
    texto: "El canal de WhatsApp no está configurado. Avisa a soporte.",
  },
  {
    prueba: (s) => /abort|timed? ?out|timeout/i.test(s),
    texto: "WhatsApp tardó demasiado en responder y el mensaje no salió. Intenta de nuevo.",
  },
  {
    prueba: (s) => /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(s),
    texto: "No se pudo conectar con WhatsApp. Revisa la conexión e intenta de nuevo.",
  },
  {
    prueba: (s) => /^HTTP 401\b/.test(s),
    texto: "La conexión con WhatsApp venció. Hay que volver a conectar el número desde Configuración.",
  },
  {
    prueba: (s) => /^HTTP 5\d\d\b/.test(s),
    texto: "WhatsApp tuvo un problema momentáneo. Intenta de nuevo en un momento.",
  },
];

/**
 * Explica un error de envío. `contexto` cambia solo el respaldo genérico
 * ("el mensaje", "el archivo", "la plantilla", "el cobro").
 */
export function explicarErrorMeta(
  crudo: string | null | undefined,
  contexto: "mensaje" | "archivo" | "plantilla" | "cobro" = "mensaje",
): string {
  const s = (crudo ?? "").trim();
  const codigo = codigoDeErrorMeta(s);
  if (codigo !== null && POR_CODIGO[codigo]) return POR_CODIGO[codigo];
  for (const r of INTERNOS) if (s && r.prueba(s)) return r.texto;

  const que =
    contexto === "archivo"
      ? "el archivo"
      : contexto === "plantilla"
        ? "la plantilla"
        : contexto === "cobro"
          ? "el cobro"
          : "el mensaje";
  const detalle = detalleCorto(s);
  return `WhatsApp no aceptó ${que}${detalle ? ` (${detalle})` : ""}. Intenta de nuevo o escríbele desde el teléfono.`;
}

/** Un trocito legible del crudo para no perder la pista, sin volcar el JSON. */
function detalleCorto(s: string): string {
  if (!s) return "";
  const msg = s.match(/"message"\s*:\s*"([^"]{1,120})"/);
  if (msg) return msg[1].replace(/^\(#\d+\)\s*/, "");
  const http = s.match(/^HTTP (\d{3})/);
  if (http) return `error ${http[1]}`;
  return s.length <= 80 ? s : "";
}

/** ¿Es el error de "fuera de la ventana de 24 h"? (para ofrecer la plantilla) */
export function esErrorDeVentana(crudo: string | null | undefined): boolean {
  return codigoDeErrorMeta(crudo) === 131047;
}
