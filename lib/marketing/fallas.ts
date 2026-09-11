/**
 * QUÉ LE DECIMOS AL DUEÑO CUANDO ALGO EXTERNO FALLA — y qué guardamos nosotros.
 *
 * EL PROBLEMA QUE RESUELVE: los errores de terceros llegaban crudos a la
 * pantalla. Un cliente que apretaba «Generar imagen» un día cargado podía leer
 * «gemini-2.5-flash: HTTP 503», y uno con la migración pendiente,
 * «new row violates row-level security policy for table "ed_mk_creatividades"».
 * Eso no es transparencia: es ruido que no se puede accionar, y además publica
 * cómo está hecho el producto por dentro.
 *
 * LA REGLA, la misma que `lib/ads/proveedor.ts` ya aplicaba para Meta:
 *   · A la persona → qué pasó y qué puede hacer, en su idioma.
 *   · Al log       → el detalle técnico, con negocio y operación, para poder
 *                    diagnosticarlo sin pedirle una captura a nadie.
 * Nunca al revés, y nunca las dos cosas mezcladas en el mismo string.
 */

export type Proveedor = "ia" | "almacen" | "imagen";

type Clase = "sin_motor" | "lento" | "ocupado" | "rechazado" | "incompleto" | "sin_espacio" | "desconocido";

const TEXTO: Record<Clase, string> = {
  sin_motor: "La redacción y las imágenes con IA no están habilitadas en tu plan.",
  lento: "El generador se demoró más de la cuenta. Vuelve a intentar: tu texto no se perdió.",
  ocupado: "El generador está saturado en este momento. Espera unos segundos y reintenta.",
  rechazado: "El generador no quiso escribir eso. Prueba describiendo el producto de otra forma.",
  incompleto: "Salió un anuncio a medias. Vuelve a intentar.",
  sin_espacio: "No se pudo guardar. Reintenta en un momento; si sigue igual, avísanos.",
  desconocido: "No se pudo completar. Vuelve a intentar en un momento.",
};

/** Clasifica sin exponer: mira el texto crudo pero devuelve una categoría nuestra. */
function clasificar(crudo: string): Clase {
  const t = crudo.toLowerCase();
  if (t.includes("gemini_api_key") || t.includes("api key") || t.includes("api_key")) return "sin_motor";
  if (t.includes("abort") || t.includes("timeout") || t.includes("tiempo de función")) return "lento";
  if (t.includes("429") || t.includes("quota") || t.includes("rate") || t.includes("503") || t.includes("overloaded")) return "ocupado";
  if (t.includes("safety") || t.includes("blocked") || t.includes("policy") || t.includes("prohibited")) return "rechazado";
  if (t.includes("vacía") || t.includes("empty") || t.includes("incompleto")) return "incompleto";
  if (t.includes("row-level") || t.includes("does not exist") || t.includes("relation") || t.includes("bucket")) return "sin_espacio";
  return "desconocido";
}

/**
 * Traduce una falla externa a texto para la persona, y deja el detalle en el
 * log del servidor. Devuelve SOLO el texto seguro.
 *
 * `clienteId` va al log para poder cruzar un reporte con lo que pasó; nunca
 * viaja el prompt, el token ni el contenido de la conversación.
 */
export function traducirFalla(args: {
  proveedor: Proveedor;
  operacion: string;
  clienteId: string;
  crudo: unknown;
}): string {
  const crudo = args.crudo instanceof Error ? args.crudo.message : String(args.crudo ?? "");
  const clase = clasificar(crudo);
  console.error(
    JSON.stringify({
      evento: "marketing.falla",
      proveedor: args.proveedor,
      operacion: args.operacion,
      cliente: args.clienteId,
      clase,
      // Acotado: un mensaje de tercero puede traer un cuerpo entero.
      detalle: crudo.slice(0, 400),
    }),
  );
  return TEXTO[clase];
}

/** El mismo texto, sin log, para casos que ya se registraron aguas arriba. */
export function textoDeFalla(clase: Clase): string {
  return TEXTO[clase];
}
