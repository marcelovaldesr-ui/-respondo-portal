/**
 * DETECTAR EN LA CONVERSACIÓN QUE LA VENTA SE CERRÓ — la parte pura.
 *
 * EL PROBLEMA (2-sep-2026)
 * ------------------------
 * `ed_resultados` tiene el tipo `venta_confirmada` desde la migración 201 y en
 * producción NADIE lo escribía: el motor de chat solo registra agendamientos y
 * clientes molestos. Así que "ganado" en el embudo solo ocurría por agenda o a
 * mano, y una cotización que el cliente pagó seguía apareciendo como
 * "Cotización" para siempre.
 *
 * Y el cierre casi nunca pasa mientras el asistente habla: pasa en modo
 * humano, cuando la persona del negocio ya cotizó y el cliente manda el
 * comprobante. Ahí el motor no corre. Por eso esto es un detector aparte, que
 * mira la conversación completa desde afuera (lib/cierreVentas.ts, en el cron).
 *
 * TRES ESTADOS, Y POR QUÉ EL DEL MEDIO IMPORTA
 * --------------------------------------------
 *  - pagado: hay evidencia de pago (comprobante, "ya transferí", el negocio
 *    acusa recibo del abono). La venta se cerró.
 *  - aprobado_sin_pago: el cliente dijo que sí — aceptó el precio, pidió que
 *    lo hagan — pero no hay evidencia de pago. En negocios que piden abono
 *    para empezar (Impresora Color: 50%), esto es una tarea pendiente para la
 *    persona: pedir el abono. Y es justo lo que se le olvida.
 *  - abierto: nada de lo anterior.
 *
 * REGLA: el modelo PROPONE y este código DISPONE, igual que en el vigilante.
 * Además, para no pagar una llamada al modelo por cada "hola", solo se
 * consulta cuando hay una PISTA textual de cierre (`hayPistaDeCierre`).
 *
 * ⚠️ ESTE ARCHIVO NO IMPORTA NADA A PROPÓSITO: es puro y `node --test` lo
 * carga sin base ni Next (tests/cierre-decision.test.mjs).
 */

export type EstadoCierre = "pagado" | "aprobado_sin_pago" | "abierto";

export type PropuestaCierre = {
  estado: EstadoCierre;
  /** Cita corta de la conversación que sostiene la decisión. */
  evidencia: string;
};

export type MensajeCierre = {
  rol: "cliente" | "empleado" | "humano" | string;
  texto: string;
};

/**
 * Pistas de que ALGO se cerró o se aprobó. Deliberadamente amplias: su trabajo
 * es filtrar el 90% de conversaciones donde no pasa nada, no decidir. Decide
 * el modelo, y después la reja.
 *
 * Solo se miran mensajes del CLIENTE y de la PERSONA: lo que dice el asistente
 * ("para empezar se pide un abono") no es evidencia de nada.
 */
const PISTAS = [
  /comprobante/i,
  /transferen/i,
  /transfer[ií]/i,
  /\babon[oóé]/i,
  /\bpag(u[eé]|ado|o realizado|o listo|o hecho)\b/i,
  /dep[oó]sit/i,
  /\baprob(ado|amos|é|ada)\b/i,
  /\bconfirm(o|ado|amos|ada)\b/i,
  /\bacept(o|ado|amos|ada)\b/i,
  /\bh[aá]ga(n|m)os?lo\b/i,
  /\bdale\b/i,
  /\bvamos con\b/i,
  /\bprocede(r|mos)?\b/i,
  /\bde acuerdo\b/i,
  /\bme lo (haces|hacen)\b/i,
  /\bencarg(o|ado|amos)\b/i,
  /\bpedido (confirmado|listo)\b/i,
  /recib(í|ido|imos) (el|tu|su) (pago|abono|comprobante|transferencia)/i,
];

export function hayPistaDeCierre(mensajes: readonly MensajeCierre[]): boolean {
  return mensajes.some(
    (m) => m.rol !== "empleado" && PISTAS.some((r) => r.test(m.texto ?? "")),
  );
}

/**
 * Del texto crudo del modelo a una propuesta. Tolera cercas de markdown y
 * basura: cualquier cosa que no se entienda es "abierto", nunca una excepción
 * — misma disciplina que `interpretar` en reingresoDecision.ts.
 */
export function interpretarCierre(crudo: unknown): PropuestaCierre {
  let o: Record<string, unknown> = {};
  if (typeof crudo === "string") {
    const limpio = crudo.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      const parsed = JSON.parse(limpio);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) o = parsed;
    } catch {
      o = {};
    }
  } else if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
    o = crudo as Record<string, unknown>;
  }
  const estado = String(o.estado ?? "abierto");
  return {
    estado:
      estado === "pagado" || estado === "aprobado_sin_pago" ? estado : "abierto",
    evidencia: typeof o.evidencia === "string" ? o.evidencia.slice(0, 200) : "",
  };
}

/**
 * LA REJA. Un "pagado" o "aprobado" sin evidencia citada no vale: es la forma
 * más barata de exigirle al modelo que se apoye en la conversación y no en su
 * intuición. La evidencia tiene que ser texto que EXISTA en la conversación
 * (se compara sin tildes ni mayúsculas, y basta con una parte).
 */
export function decidirCierre(
  p: PropuestaCierre,
  mensajes: readonly MensajeCierre[],
): PropuestaCierre {
  if (p.estado === "abierto") return { estado: "abierto", evidencia: "" };
  if (!p.evidencia.trim()) return { estado: "abierto", evidencia: "sin evidencia" };
  const ev = normalizar(p.evidencia);
  /**
   * Evidencia que no dice nada (visto en pruebas reales, 2-sep-2026):
   *  - «15»: un número suelto que aparece en cualquier parte.
   *  - «[el cliente envió una imagen]»: el marcador de un adjunto SIN nombre
   *    ni descripción. Una foto cualquiera no es un comprobante; si lo fuera,
   *    el nombre del archivo o la descripción lo dirían.
   */
  if (ev.split(" ").filter(Boolean).length < 2 || ev.length < 6) {
    return { estado: "abierto", evidencia: "evidencia demasiado corta" };
  }
  if (esMarcadorDeAdjunto(ev)) {
    return { estado: "abierto", evidencia: "un adjunto sin nombre no es evidencia" };
  }
  const enConversacion = mensajes.some((m) => {
    const t = normalizar(m.texto ?? "");
    if (!t) return false;
    // Basta con que un trozo razonable de la evidencia esté en algún mensaje
    // (el modelo suele recortar o parafrasear los extremos).
    return t.includes(ev) || ev.includes(t) || comparteTrozo(ev, t);
  });
  if (!enConversacion) return { estado: "abierto", evidencia: "evidencia no está en la conversación" };
  return p;
}

/** «el cliente envió una imagen / un archivo / un audio…» sin nada más. */
function esMarcadorDeAdjunto(evNormalizada: string): boolean {
  return /^(el (cliente|equipo) (envio|compartio) (una|un) (imagen|archivo|audio|video|sticker|documento|contacto)( sin texto)?)$/.test(
    evNormalizada,
  );
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Comparten una secuencia de 3+ palabras? (o 2 si la evidencia es corta) */
function comparteTrozo(ev: string, t: string): boolean {
  const palabras = ev.split(" ").filter(Boolean);
  const n = palabras.length >= 3 ? 3 : 2;
  if (palabras.length < n) return false;
  for (let i = 0; i + n <= palabras.length; i++) {
    if (t.includes(palabras.slice(i, i + n).join(" "))) return true;
  }
  return false;
}

/** Instrucciones para el modelo. Sin conocimiento del negocio: solo la conversación. */
export function promptCierre(p: {
  negocio: string;
  rubro: string | null;
  mensajes: readonly MensajeCierre[];
}): string {
  const conversacion = p.mensajes
    .map((m) => {
      if (m.rol === "cliente") return `Cliente: ${m.texto}`;
      if (m.rol === "humano") return `Persona del negocio: ${m.texto}`;
      return `Asistente automático: ${m.texto}`;
    })
    .join("\n");

  return `Eres un analista de ventas. Lees una conversación de WhatsApp entre un cliente y ${p.negocio}${
    p.rubro ? ` (${p.rubro})` : ""
  } y decides en qué estado quedó la venta. Solo con lo que dice la conversación: nada de suponer.

Responde SOLO con este JSON:
{"estado":"pagado"|"aprobado_sin_pago"|"abierto","evidencia":"<cita corta y literal de la conversación>"}

"pagado": hay evidencia de que el cliente PAGÓ o ABONÓ: dice que transfirió o pagó, manda un comprobante o una transferencia (un archivo o imagen cuyo nombre o descripción lo indique), o la persona del negocio acusa recibo del pago/abono.

"aprobado_sin_pago": el cliente ACEPTÓ seguir adelante con un pedido o cotización concreta —aprobó el precio, dijo que lo hagan, confirmó el encargo— pero NO hay evidencia de pago todavía. Un "gracias", un "lo veo" o una pregunta más NO es aprobación.

"abierto": cualquier otra cosa. Ante la duda, "abierto".

Reglas:
1. La evidencia tiene que ser una cita literal y corta (máx. 20 palabras) de un mensaje del cliente o de la persona del negocio. Lo que dice el asistente automático no es evidencia.
2. Si hay pago Y aprobación, es "pagado".
3. Un comprobante de un pedido anterior, ya entregado, no cuenta: mira si el pago corresponde a lo que se está hablando ahora.
4. Si la persona del negocio dice que el pago NO llegó o que falta, NO es "pagado".
5. Una imagen o archivo SIN nombre ni descripción no es evidencia de pago. Solo cuenta si el nombre del archivo o su descripción hablan de comprobante, transferencia, pago o abono, o si alguien lo confirma con palabras.
6. La evidencia tiene que ser una frase con sentido, no un número suelto ni una palabra aislada.

Conversación (de más antigua a más reciente):
${conversacion}

SOLO el JSON.`;
}
