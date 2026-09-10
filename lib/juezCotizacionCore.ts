/**
 * EL JUEZ: ¿ESTA COTIZACIÓN DE VERDAD QUEDÓ ABIERTA? — reglas puras, sin base
 * ni red.
 *
 * EL AGUJERO QUE TAPA (9-sep-2026)
 * --------------------------------
 * Marcelo preguntó lo correcto: «¿es capaz Beto de leer y entender las
 * conversaciones?». La respuesta era **no**. `generadorCotizacionCore.ts`
 * decide con METADATOS del contacto —la etiqueta `cotizacion`, quién habló
 * último, cuántos días pasaron— y nunca abre el hilo. Eso alcanza para
 * descartar el 99%, pero no distingue estos cuatro casos, todos reales en
 * Impresora Color:
 *
 *   · Se pidió una cotización que **nunca se envió** (no hay nada que retomar).
 *   · Se cerró **en el mesón**: vino, pagó y retiró; el chat quedó con el
 *     negocio hablando último y la etiqueta puesta.
 *   · El cliente dijo «muy caro» y Cecilia respondió «ok» — es un NO.
 *   · La etiqueta es de julio y **nunca se borra**: las etiquetas son
 *     acumulativas, así que un `cotizacion` viejo sigue ahí para siempre.
 *
 * Cada uno de esos es una plantilla de MARKETING de ~$85 pagada para quedar
 * mal. Por eso el juez lee el hilo y responde UNA pregunta cerrada.
 *
 * LO QUE EL JUEZ NO ES
 * --------------------
 * **El juez no reemplaza la reja, la refina.** Corre DESPUÉS de
 * `decidirCotizacion` y solo puede QUITAR candidatos, nunca agregarlos. Si la
 * reja dijo que no, el modelo ni se entera: no se gasta la llamada.
 *
 * Y su opinión no es la última palabra: acá se aplica la misma regla que en
 * `reingresoDecision.ts` — el modelo *propone* y este código *dispone*. Si la
 * respuesta no dice `abierta: true` de forma inequívoca, no se envía.
 * **Fail-closed**: ante una respuesta rara, el error barato es no mandar.
 *
 * ⚠️ ESTE ARCHIVO NO IMPORTA NADA A PROPÓSITO — sin `@/lib/db` ni Next,
 * `node --test` puede cargarlo. Igual que `generadorCotizacionCore.ts`,
 * `reingresoDecision.ts` y `parserMeta.ts`.
 */

/** Un mensaje del hilo, ya normalizado por quien llama. */
export type MensajeHilo = {
  /** "cliente" | "empleado" | "humano" — tal como viene en ed_mensajes.rol. */
  rol: string;
  texto: string;
  creadoEn?: string | null;
};

/**
 * Lo que el juez dice de la conversación.
 *
 * `abierta: null` es un estado de verdad y no un detalle: significa «no se pudo
 * determinar» (el modelo devolvió basura, o falló). Se distingue de `false`
 * porque en la página de aprobación no es lo mismo «el juez dice que ya se
 * cerró» que «el juez no pudo leerlo».
 */
export type VeredictoJuez = {
  abierta: boolean | null;
  /** Qué se cotizó, en palabras del hilo. Vacío si no se pudo determinar. */
  cotizado: string;
  motivo: string;
};

/**
 * ⚠️ EL FALLBACK TIENE QUE CALZAR EN LA FRASE DE LA PLANTILLA.
 *
 * El cuerpo aprobado en Meta dice: «por la cotización de {{3}} que nos
 * pediste». Con «tu cotización» ahí adentro sale «por la cotización de tu
 * cotización que nos pediste». Por eso se conserva la fórmula que ya usaba
 * `generadorCotizacion.ts`, que es la única que arma una oración: «por la
 * cotización de **lo que nos consultaste** que nos pediste».
 *
 * Igual es un premio de consuelo. El punto entero del juez es que este valor
 * casi nunca se use, y en su lugar diga «500 tarjetas de presentación».
 */
export const COTIZADO_FALLBACK = "lo que nos consultaste";

/** Tope de la variable. Meta corta feo y una frase larga se ve a máquina. */
export const COTIZADO_MAX = 60;

/** Cuántos mensajes del hilo se le muestran al juez. */
export const MENSAJES_HILO = 20;

/**
 * Mínimo de mensajes para que la pregunta tenga sentido.
 *
 * Con un solo mensaje no hay conversación que juzgar: no se puede haber
 * enviado una cotización y quedado sin respuesta. Fail-closed.
 */
export const MENSAJES_MINIMOS = 2;

/**
 * DEL TEXTO CRUDO DEL MODELO A UN VEREDICTO.
 *
 * ⚠️ `generarJSON` DEVUELVE UN **STRING**, NO UN OBJETO. Es el mismo error que
 * dejó al vigilante de reingresos decidiendo «callar» en 94 de 94
 * conversaciones durante días (2-sep-2026): le pasaban el string a una función
 * que leía `.abierta` de un string —undefined— y todo caía al lado seguro sin
 * que nadie se enterara, porque fallar en silencio se ve igual que funcionar.
 *
 * Acá el lado seguro es `abierta: null`, que en modo aprobación se muestra
 * como «el juez no pudo leerlo» en vez de desaparecer. Un fail-closed que se
 * VE es la única forma de que este bug no vuelva a durar días.
 *
 * Tolerante a lo que suele venir: cercas de markdown (```json), un objeto ya
 * parseado, texto alrededor del JSON, y `true`/`false` como string.
 */
export function interpretar(crudo: unknown): VeredictoJuez {
  const vacio: VeredictoJuez = { abierta: null, cotizado: "", motivo: "" };

  let o: Record<string, unknown> = {};
  if (typeof crudo === "string") {
    const limpio = crudo
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(limpio);
    } catch {
      /**
       * Último intento: el modelo a veces envuelve el JSON en una frase. Se
       * rescata el primer objeto {...} y se prueba de nuevo. Si tampoco, queda
       * en null y el candidato no se envía.
       */
      const m = limpio.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      o = parsed as Record<string, unknown>;
    } else {
      return { ...vacio, motivo: "respuesta ilegible del juez" };
    }
  } else if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
    o = crudo as Record<string, unknown>;
  } else {
    return { ...vacio, motivo: "respuesta ilegible del juez" };
  }

  return {
    abierta: aBooleano(o.abierta),
    cotizado: normalizarCotizado(o.cotizado),
    motivo: typeof o.motivo === "string" ? o.motivo.trim().slice(0, 200) : "",
  };
}

/**
 * true/false SOLO si son inequívocos. Cualquier otra cosa —"quizás", 1, null,
 * ausente— es «no se pudo determinar», que no envía.
 */
function aBooleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "sí" || s === "si") return true;
    if (s === "false" || s === "no") return false;
  }
  return null;
}

/**
 * Deja `cotizado` listo para entrar como {{3}} de la plantilla.
 *
 * Tres cosas: los parámetros de Meta no admiten saltos ni tabs (igual que
 * `limpiarParam`); el modelo tiende a devolver «la cotización de 500 tarjetas»
 * y eso duplicaría la frase de la plantilla; y hay un tope de largo porque una
 * variable de 200 caracteres se lee como generada por una máquina.
 */
export function normalizarCotizado(v: unknown): string {
  let s = String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // "la cotización de X" / "cotización de X" / "el presupuesto de X" → "X"
  s = s.replace(/^(la|el|una|un)?\s*(cotizaci[óo]n|presupuesto)\s+(de|por|para)\s+/i, "");
  /**
   * Comillas y puntuación de sobra, en una pasada cada punta. Iban en dos
   * reemplazos y «dos pendones»,  se quedaba con el » colgando: al quitar
   * primero las comillas, la coma final tapaba el cierre. Un test lo cazó.
   */
  s = s.replace(/^[\s"'«»]+/, "").replace(/[\s"'«».,;]+$/, "");

  if (s.length > COTIZADO_MAX) {
    s = s.slice(0, COTIZADO_MAX).replace(/\s+\S*$/, "").trim();
    /**
     * ⚠️ CORTAR POR LARGO DEJA BASURA AL FINAL, Y SE VE EN EL MENSAJE.
     *
     * En la simulación del 9-sep salieron dos así: «10 cuentos con tapa dura,
     * papel brillante, 24 páginas, a» y «anillado de 700 páginas a color y
     * anillado de 70 páginas a». Dentro de la frase de la plantilla quedaban
     * como «por la cotización de … 24 páginas, a que nos pediste»: se lee como
     * un mensaje roto, que es peor que uno genérico.
     *
     * Primero se corta en la última coma si con eso queda algo sustancial —una
     * enumeración truncada se entiende mejor sin la última parte a medias— y
     * después se sueltan las palabras de enganche que quedaron colgando.
     */
    const coma = s.lastIndexOf(",");
    if (coma >= 20) s = s.slice(0, coma);
    s = s.replace(/[\s,;]+(?:a|de|del|y|e|o|u|en|con|para|por|la|el|los|las|un|una|al|sin|sobre)$/i, "");
    s = s.replace(/[\s,;]+$/, "");
  }

  /**
   * Un "cotizado" de una o dos letras no es un producto: es ruido del modelo.
   * Mejor la fórmula neutra que «la cotización de x que nos pediste».
   */
  return s.length < 3 ? "" : s;
}

/** Lo que se hace con el veredicto. `cotizado` ya viene listo para la plantilla. */
export type DecisionJuez = {
  enviar: boolean;
  motivo: string;
  cotizado: string;
};

/**
 * LA REJA DEL JUEZ. Fail-closed y sin matices: solo `abierta === true` pasa.
 *
 * Que el juez NO pueda determinarlo se trata igual que un no. Es plata: ante la
 * duda, no se manda.
 */
export function decidirConJuez(v: VeredictoJuez): DecisionJuez {
  const cotizado = v.cotizado || COTIZADO_FALLBACK;

  if (v.abierta === true) {
    return { enviar: true, motivo: v.motivo || "cotización enviada y sin respuesta", cotizado };
  }
  if (v.abierta === false) {
    return { enviar: false, motivo: v.motivo || "el juez dice que ya no está abierta", cotizado };
  }
  return { enviar: false, motivo: v.motivo || "el juez no pudo determinarlo", cotizado };
}

/**
 * El hilo, en el formato más barato que el modelo entiende bien.
 *
 * ⚠️ VAN LOS MENSAJES DE **TODOS** LOS EMPLEADOS, NO SOLO LOS DE BETO. Leer
 * únicamente el hilo de Beto fue un bug real (auditoría 27-ago): en Impresora
 * casi todo lo contesta Tino o una persona, así que el hilo de Beto está vacío
 * y el juez habría fallado sobre la nada.
 *
 * "humano" se distingue de "empleado" a propósito: si Cecilia escribió último,
 * el juez tiene que poder ver que fue una PERSONA y no el asistente.
 */
export function formatearHilo(mensajes: readonly MensajeHilo[]): string {
  return mensajes
    .map((m) => {
      const quien =
        m.rol === "cliente" ? "CLIENTE" : m.rol === "humano" ? "NEGOCIO (persona)" : "NEGOCIO (asistente)";
      const texto = (m.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return `${quien}: ${texto || "(adjunto sin texto)"}`;
    })
    .join("\n");
}

/**
 * La pregunta. Cerrada, en JSON, sin espacio para que el modelo opine de más.
 *
 * Se le pide `cotizado` en la MISMA llamada y no en otra porque la respuesta ya
 * exige haber leído el hilo: pedirlo aparte sería pagar dos veces por la misma
 * lectura. Ese campo es el que convierte «por la cotización de lo que nos
 * consultaste» en «por la cotización de 500 tarjetas de presentación».
 */
export function construirPrompt(p: {
  negocio: string;
  mensajes: readonly MensajeHilo[];
  diasEsperando: number;
}): string {
  return `Eres un auditor del negocio "${p.negocio}". Lee esta conversación de WhatsApp y responde UNA sola pregunta.

CONVERSACIÓN (los últimos mensajes, en orden; el último es el más reciente):
${formatearHilo(p.mensajes)}

Han pasado ${p.diasEsperando} días desde el último mensaje y nadie ha vuelto a escribir.

PREGUNTA: ¿hay una cotización o precio que el NEGOCIO alcanzó a enviar, que quedó SIN respuesta del cliente y SIN cerrarse?

Responde "abierta": false si ocurre CUALQUIERA de estas cosas:
- El negocio nunca llegó a enviar un precio, monto ni rango (solo pidieron datos, o quedó en "te cotizo").
- El cliente ya aceptó, pagó, abonó, retiró o se coordinó la entrega.
- El cliente dijo que no, que estaba caro, que lo dejaba para después o que compró en otro lado.
- Lo que se conversó no era una cotización (un reclamo, una consulta de horario, un saludo).
- La conversación se cerró en persona o por teléfono, o el negocio se despidió dando el tema por terminado.

Responde "abierta": true SOLO si el negocio envió un precio concreto y el cliente nunca respondió a ese precio.

Si tienes dudas, responde false.

Responde ÚNICAMENTE con este JSON, sin texto alrededor:
{"abierta": true|false, "cotizado": "qué se cotizó, en pocas palabras, máximo 60 caracteres", "motivo": "una frase corta explicando por qué"}

Para "cotizado" usa las palabras del cliente y NO incluyas la palabra "cotización": escribe "500 tarjetas de presentación", no "la cotización de 500 tarjetas". Si no se cotizó nada concreto, deja "cotizado" vacío.`;
}
