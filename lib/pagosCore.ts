/**
 * COBRAR DENTRO DE LA CONVERSACIÓN — reglas puras, sin red ni base de datos.
 *
 * POR QUÉ ES LA APUESTA (26-ago-2026)
 * -----------------------------------
 * Es la función que convirtió a Vita en «el equipo que opera tu centro» y le
 * permitió cobrar $199.990–$699.990: la conversación no termina en «te paso los
 * datos de transferencia», termina en plata. En nuestro plan de plataforma está
 * como Ola 1.
 *
 * Y el caso de Impresora lo confirma con datos: en 2.529 mensajes de Cecilia
 * hay 90 menciones de transferencia — dicta los datos de la cuenta A MANO cada
 * vez, y después persigue el comprobante. Este módulo convierte eso en un
 * mensaje con link y un registro con estado.
 *
 * QUÉ ES Y QUÉ NO ES (v1)
 * -----------------------
 * ES: un registro de cobros por conversación + el mensaje con el enlace de pago
 * del negocio + la marca de pagado. El enlace es el que el negocio ya tiene
 * (Mercado Pago, Flow, Getnet…): cada uno permite crear un link fijo o por
 * monto sin API.
 *
 * NO ES: una pasarela. No procesamos tarjetas ni movemos plata — el dinero va
 * directo del cliente final al negocio por SU proveedor. Eso nos deja fuera de
 * regulación financiera y de PCI, y es deliberado. La conciliación automática
 * con la API del proveedor es la v2, cuando un cliente la pida.
 *
 * ⚠️ SIN IMPORTS A PROPÓSITO — `node --test` lo carga directo. Mismo patrón que
 * `parserMeta.ts`, `ventana24Regla.ts` y `generadorCotizacionCore.ts`.
 */

/**
 * Tope por cobro: $10.000.000.
 *
 * No es un límite comercial, es un cinturón contra errores de tipeo: un cero de
 * más convierte $500.000 en $5.000.000 y un cliente final recibiendo ese monto
 * pierde la confianza al instante. Quien de verdad cobre más de diez millones
 * por WhatsApp puede pedir que se lo subamos.
 */
export const MONTO_MAX = 10_000_000;
export const MONTO_MIN = 1_000;

export type EstadoPago = "pendiente" | "pagado" | "anulado";

/** Lo que se necesita para crear un cobro. */
export type SolicitudCobro = {
  monto: number;
  concepto: string;
  /** Enlace de pago del negocio. Sin él, la función no existe para ese cliente. */
  linkBase: string | null | undefined;
};

export type CobroValidado =
  | { ok: true; monto: number; concepto: string }
  | { ok: false; error: string };

export function validarCobro(s: SolicitudCobro): CobroValidado {
  if (!s.linkBase || !s.linkBase.trim()) {
    return {
      ok: false,
      error:
        "Este negocio no tiene configurado su enlace de pago. Se configura una vez en Información.",
    };
  }
  // El enlace tiene que ser https de verdad: uno malo mandaría al cliente final
  // a cualquier parte con la plata en la mano.
  try {
    const u = new URL(s.linkBase.trim());
    if (u.protocol !== "https:") return { ok: false, error: "El enlace de pago debe ser https." };
  } catch {
    return { ok: false, error: "El enlace de pago no es una URL válida." };
  }

  const monto = Math.round(Number(s.monto));
  if (!Number.isFinite(monto)) return { ok: false, error: "El monto no es un número." };
  if (monto < MONTO_MIN) {
    return { ok: false, error: `El monto mínimo es $${MONTO_MIN.toLocaleString("es-CL")}.` };
  }
  if (monto > MONTO_MAX) {
    return {
      ok: false,
      error: `El monto supera el máximo de $${MONTO_MAX.toLocaleString("es-CL")}. Si es real, avísanos y lo subimos.`,
    };
  }

  const concepto = (s.concepto ?? "").trim().replace(/\s+/g, " ");
  if (!concepto) return { ok: false, error: "Falta decir por qué es el cobro." };
  if (concepto.length > 120) {
    return { ok: false, error: "El concepto es muy largo (máximo 120 caracteres)." };
  }

  return { ok: true, monto, concepto };
}

/**
 * Referencia corta y legible del cobro: P-XXXXXX.
 *
 * Es lo que une el mensaje de WhatsApp, la fila en la base y —cuando el negocio
 * mira su Mercado Pago— la transferencia que llegó. Sin una referencia, casar
 * «me llegaron $25.000» con «¿de quién?» vuelve a ser trabajo manual, que es
 * justo lo que esto elimina.
 *
 * Sin letras confusas (0/O, 1/I/L) porque la gente la DICTA por teléfono.
 */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generarReferencia(aleatorio: () => number = Math.random): string {
  let r = "";
  for (let i = 0; i < 6; i++) r += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
  return `P-${r}`;
}

export function formatearMonto(monto: number): string {
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
}

/**
 * El mensaje que recibe el cliente final.
 *
 * Decisiones de texto, todas a propósito:
 *  - El MONTO va primero y en la misma línea que el concepto: es lo único que
 *    la persona necesita para decidir.
 *  - La referencia va al final y se pide en el comprobante — es lo que permite
 *    conciliar sin preguntar «¿me mandaste tú los $25.000?».
 *  - Sin presión ni urgencia. El que cobra es el negocio, no un bot de cobranza.
 *  - El enlace va SOLO, en su propia línea: WhatsApp lo convierte en tarjeta y
 *    los enlaces incrustados en una frase se tocan menos.
 */
export function mensajeDeCobro(p: {
  concepto: string;
  monto: number;
  referencia: string;
  linkBase: string;
  nombreNegocio: string;
}): string {
  return (
    `Detalle de tu pago en ${p.nombreNegocio}:\n` +
    `${p.concepto} — ${formatearMonto(p.monto)}\n\n` +
    `Puedes pagar en este enlace:\n` +
    `${p.linkBase.trim()}\n\n` +
    `Al pagar, indica la referencia ${p.referencia} o respóndenos con el comprobante por acá mismo.`
  );
}

/**
 * Transiciones de estado permitidas.
 *
 * `pagado` es terminal a propósito: des-pagar algo no es una corrección, es un
 * evento contable que debe quedar como anulación + cobro nuevo, no como un
 * flip-flop del mismo registro. Si se permitiera pagado→pendiente, el total
 * cobrado del mes podría cambiar hacia atrás sin rastro.
 */
export function puedeCambiar(desde: EstadoPago, hacia: EstadoPago): boolean {
  if (desde === hacia) return false;
  if (desde === "pendiente") return hacia === "pagado" || hacia === "anulado";
  return false; // pagado y anulado son terminales
}
