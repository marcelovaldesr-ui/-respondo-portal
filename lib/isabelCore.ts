/**
 * ISABEL — la que sabe lo que pasa en el negocio. Núcleo puro, sin base ni red.
 *
 * QUÉ ES ISABEL Y QUÉ NO ES
 * Isabel NO habla con los clientes finales. Es la única del roster que trabaja
 * hacia adentro: el dueño le pregunta algo sobre su propio negocio —«¿alguien
 * reclamó esta semana?», «¿qué es lo que más me piden?», «¿le respondimos al
 * señor que preguntó por los pendones?»— y ella contesta leyendo lo que
 * realmente pasó: las fichas del negocio y el historial completo de mensajes.
 *
 * Eso la hace el empleado de MENOR riesgo del roster y el de mayor valor por
 * hora construida: si se equivoca, se equivoca frente al dueño, que puede
 * corregirla — no frente a un cliente.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE APARTE
 * Todo lo que decide QUÉ mirar y CÓMO se le habla al modelo vive acá, sin
 * Supabase y sin fetch, para poder probarlo. La parte que consulta la base está
 * en lib/isabel.ts. La lección es la del informe semanal: los errores caros no
 * están en la llamada al modelo, están en qué se le mandó.
 */

/**
 * Palabras que no distinguen nada en una pregunta en español. Sin esta lista,
 * buscar «¿qué me piden más?» en el historial devuelve todos los mensajes que
 * contienen «que», o sea todos.
 */
const VACIAS = new Set([
  "a","al","algo","alguien","algun","alguna","algunas","alguno","algunos","ante","antes","aqui",
  "asi","aun","bien","cada","como","con","cual","cuales","cuando","cuanto","cuantos","de","del",
  "desde","donde","dos","el","ella","ellas","ellos","en","entre","era","eran","es","esa","esas",
  "ese","eso","esos","esta","estan","estas","este","esto","estos","estoy","fue","fueron","ha",
  "haber","habia","hace","hacen","hacer","hasta","hay","la","las","le","les","lo","los","mas",
  "me","mi","mis","mucho","muchos","muy","nada","ni","no","nos","nuestra","nuestro","o","otra",
  "otras","otro","otros","para","pero","poco","por","porque","pues","que","quien","quienes","se",
  "segun","ser","si","sido","sin","sobre","solo","son","su","sus","tambien","tan","tanto","te",
  "tener","tengo","tiene","tienen","todo","todos","tu","tus","un","una","unas","uno","unos","ver",
  "y","ya","yo",
]);

/** Minúsculas y sin acentos. Mismo criterio que `ed_sin_acentos` en la base. */
export function sinAcentos(t: string): string {
  return String(t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Términos con los que vale la pena buscar en el historial.
 *
 * Se quedan las palabras de 4 letras o más que no sean de relleno, más los
 * números largos (un folio, un monto, un teléfono: cuando alguien pregunta por
 * «el presupuesto 5292», ese número ES la búsqueda).
 */
export function palabrasClave(pregunta: string, tope = 4): string[] {
  const vistas = new Set<string>();
  const claves: string[] = [];

  /**
   * Se devuelve la palabra TAL COMO la escribió el dueño, con acentos y todo.
   * El descarte sí se hace sobre la versión sin acentos, para que «qué» caiga
   * en la lista de vacías igual que «que».
   *
   * ⚠️ Importa para quien lea esto después: `ilike` en Postgres SÍ distingue
   * acentos, así que buscar «cotizacion» no encuentra «cotización». Por eso la
   * búsqueda (lib/isabel.ts) prueba las dos formas cuando difieren.
   */
  for (const bruto of String(pregunta ?? "").split(/[^\p{L}\p{N}]+/u)) {
    const p = bruto.trim();
    if (!p) continue;
    const plano = sinAcentos(p);
    const esNumero = /^\d{3,}$/.test(plano);
    if (!esNumero && (plano.length < 4 || VACIAS.has(plano))) continue;
    if (vistas.has(plano)) continue;
    vistas.add(plano);
    claves.push(p);
    if (claves.length >= tope) break;
  }
  return claves;
}

export type MensajeIsabel = {
  chatId: string;
  rol: string;
  texto: string;
  creadoEn: string;
  /** Nombre del contacto, si se conoce. */
  nombre?: string | null;
};

/** Cómo se nombra cada quién dentro del texto que lee el modelo. */
export function quien(rol: string): "CLIENTE" | "ASISTENTE" | "EQUIPO" {
  if (rol === "cliente") return "CLIENTE";
  if (rol === "empleado") return "ASISTENTE";
  return "EQUIPO";
}

/**
 * Convierte mensajes sueltos en conversaciones legibles, recortadas para que
 * quepan en el contexto del modelo sin perder de qué se hablaba.
 *
 * El recorte es por conversación y no global a propósito: media conversación
 * de cada una sirve más que una entera y nueve cortadas al medio.
 */
export function armarConversaciones(
  mensajes: MensajeIsabel[],
  opciones?: { maxChats?: number; maxMensajes?: number; maxChars?: number },
): string {
  const maxChats = opciones?.maxChats ?? 12;
  const maxMensajes = opciones?.maxMensajes ?? 12;
  const maxChars = opciones?.maxChars ?? 260;

  const porChat = new Map<string, MensajeIsabel[]>();
  for (const m of mensajes) {
    if (!m?.chatId) continue;
    const arr = porChat.get(m.chatId) ?? [];
    arr.push(m);
    porChat.set(m.chatId, arr);
  }

  return [...porChat.entries()]
    .map(([chat, msgs]) => {
      const ordenados = [...msgs].sort((a, b) => (a.creadoEn < b.creadoEn ? -1 : 1));
      return { chat, msgs: ordenados, ultimo: ordenados[ordenados.length - 1]?.creadoEn ?? "" };
    })
    // Lo más reciente primero: casi siempre es lo que se está preguntando.
    .sort((a, b) => (a.ultimo < b.ultimo ? 1 : -1))
    .slice(0, maxChats)
    .map(({ chat, msgs }) => {
      const nombre = msgs.find((m) => m.nombre)?.nombre ?? "";
      const cabecera = `--- ${nombre || "Contacto"} (…${chat.slice(-4)}) ---`;
      const lineas = msgs.slice(-maxMensajes).map((m) => {
        const fecha = String(m.creadoEn ?? "").slice(0, 10);
        const texto = String(m.texto ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maxChars);
        return `  [${fecha}] ${quien(m.rol)}: ${texto}`;
      });
      return `${cabecera}\n${lineas.join("\n")}`;
    })
    .join("\n\n");
}

export type PanoramaNegocio = {
  dias: number;
  conversaciones: number;
  mensajes: number;
  esperando: number;
  citasProximas: number;
  cobrosPendientes: number;
  cobradoMes: number;
  porEtapa: { etapa: string; total: number }[];
  porEtiqueta: { etiqueta: string; total: number }[];
};

/** El panorama en texto plano, que es como el modelo lo lee mejor. */
export function panoramaEnTexto(p: PanoramaNegocio): string {
  const etapas = p.porEtapa.length
    ? p.porEtapa.map((e) => `${e.etapa}: ${e.total}`).join(" · ")
    : "sin datos";
  const etiquetas = p.porEtiqueta.length
    ? p.porEtiqueta.map((e) => `${e.etiqueta}: ${e.total}`).join(" · ")
    : "sin datos";
  return [
    `Últimos ${p.dias} días: ${p.conversaciones} conversaciones, ${p.mensajes} mensajes.`,
    `Derivadas sin atender ahora mismo: ${p.esperando}.`,
    `Citas agendadas de aquí en adelante: ${p.citasProximas}.`,
    `Cobros pendientes: ${p.cobrosPendientes}. Cobrado en el mes: $${Math.round(p.cobradoMes).toLocaleString("es-CL")}.`,
    `Embudo: ${etapas}.`,
    `Etiquetas más frecuentes: ${etiquetas}.`,
  ].join("\n");
}

export type RespuestaIsabel = {
  respuesta: string;
  /** Hechos concretos en los que se apoya. Vacío si no se apoyó en nada. */
  apoyos: string[];
  /** `no_se` es una respuesta válida y esperada, no una falla. */
  seguridad: "alta" | "media" | "no_se";
};

const PROMPT = `Eres Isabel, la asistente interna de un negocio chileno. NO hablas con los clientes del negocio: hablas con el DUEÑO, que te pregunta cosas sobre su propio negocio.

Tienes a la vista lo que el negocio tiene cargado y las conversaciones reales con sus clientes. Tu trabajo es contestar la pregunta con lo que efectivamente pasó.

NEGOCIO: {{negocio}} ({{rubro}})
HOY ES: {{hoy}}

PANORAMA (cifras exactas, ya calculadas: úsalas tal cual, no las recalcules):
{{panorama}}

LO QUE EL NEGOCIO TIENE CARGADO:
{{fichas}}

CONVERSACIONES RELEVANTES:
{{conversaciones}}

PREGUNTA DEL DUEÑO:
{{pregunta}}

REGLAS
1. Responde SOLO con lo que está arriba. Si la respuesta no está, dilo derecho: "con lo que tengo cargado no puedo saberlo" y explica en una frase qué haría falta. Inventar acá le hace perder plata a alguien.
2. Nada de rodeos ni de lenguaje de consultor. Habla como quien conoce el negocio: frases cortas, en chileno neutro.
3. Cuando cites algo que dijo un cliente, cítalo entre comillas y di cuándo fue.
4. Si te preguntan por cifras, usa las del PANORAMA. No sumes conversaciones a ojo.
5. Máximo 6 frases en la respuesta. Si hay que enumerar, que sea en los apoyos.
6. No repitas la pregunta ni empieces con "según los datos".

Responde SOLO con este JSON, sin texto alrededor:
{
  "respuesta": "la respuesta al dueño, máximo 6 frases",
  "apoyos": ["hechos concretos: citas con fecha, cifras, nombres. Máximo 5. Vacío si no te apoyaste en nada"],
  "seguridad": "alta si la respuesta sale clara de los datos, media si es parcial, no_se si no está"
}`;

/** Arma el prompt. Separado para poder mirar exactamente qué se le manda. */
export function armarPrompt(e: {
  negocio: string;
  rubro: string;
  hoy: string;
  panorama: string;
  fichas: string;
  conversaciones: string;
  pregunta: string;
}): string {
  return PROMPT.replace("{{negocio}}", e.negocio || "el negocio")
    .replace("{{rubro}}", e.rubro || "sin rubro definido")
    .replace("{{hoy}}", e.hoy)
    .replace("{{panorama}}", e.panorama || "sin datos")
    .replace("{{fichas}}", e.fichas || "(no hay fichas cargadas)")
    .replace("{{conversaciones}}", e.conversaciones || "(no se encontraron conversaciones relacionadas)")
    .replace("{{pregunta}}", e.pregunta);
}

/**
 * Normaliza lo que devolvió el modelo.
 *
 * Misma lección que en insights.ts: el modelo a veces manda un texto donde se
 * pidió una lista, o al revés. Descartar una respuesta buena por la forma sería
 * el peor de los dos errores posibles.
 */
export function normalizarRespuesta(crudo: string): RespuestaIsabel | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    // El modelo contestó en prosa. Si trae texto, vale como respuesta.
    const texto = String(crudo ?? "").trim();
    if (!texto || texto.length > 4000) return null;
    return { respuesta: texto.slice(0, 1500), apoyos: [], seguridad: "media" };
  }

  const respuesta = Array.isArray(p.respuesta)
    ? p.respuesta.map((x) => String(x)).join(" ")
    : String(p.respuesta ?? "").trim();
  if (!respuesta) return null;

  const apoyos = Array.isArray(p.apoyos)
    ? p.apoyos
        .map((x) => String(x).replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const s = String(p.seguridad ?? "").toLowerCase();
  const seguridad: RespuestaIsabel["seguridad"] =
    s === "alta" || s === "no_se" ? s : s === "media" ? "media" : "media";

  return { respuesta: respuesta.slice(0, 1500), apoyos, seguridad };
}

/**
 * Preguntas de arranque. La pantalla en blanco es el peor enemigo de una
 * herramienta así: quien no sabe qué preguntar, no pregunta y no vuelve.
 */
export const SUGERENCIAS = [
  "¿Qué es lo que más me preguntaron esta semana?",
  "¿Alguien reclamó o quedó molesto?",
  "¿Qué cotizaciones quedaron sin respuesta?",
  "¿Hay algo que el asistente no supo contestar?",
  "¿Qué clientes vienen esta semana?",
] as const;

/** Tope de largo de la pregunta. Más que esto no es una pregunta, es un texto. */
export const MAX_PREGUNTA = 400;

/** Valida la pregunta antes de gastar una llamada al modelo. */
export function validarPregunta(pregunta: string): { ok: true; texto: string } | { ok: false; motivo: string } {
  const texto = String(pregunta ?? "").replace(/\s+/g, " ").trim();
  if (texto.length < 3) return { ok: false, motivo: "Escribe la pregunta y te la contesto." };
  if (texto.length > MAX_PREGUNTA) {
    return { ok: false, motivo: `La pregunta es muy larga (máximo ${MAX_PREGUNTA} caracteres).` };
  }
  return { ok: true, texto };
}
