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

/* ────────────────────────────────────────────────────────────────────────────
 * LA SITUACIÓN DEL NEGOCIO — lo que ya está interpretado
 *
 * Isabel arrancó leyendo mensajes crudos y un puñado de conteos. El problema no
 * era la cantidad de texto: era que TODO lo que el portal ya había interpretado
 * —el informe semanal, por qué se derivó una conversación, qué cierre se
 * detectó y con qué evidencia, qué cobro quedó pendiente— no le llegaba.
 *
 * Estos bloques son baratos (decenas de filas, no miles) y vienen ya
 * destilados, así que se le pasan SIEMPRE. La alternativa que se pensó primero
 * —un ruteador que decidiera qué bloques cargar según la pregunta— se descartó
 * al construirlo: pesan poco, y lo único que agregaba el ruteador era una forma
 * nueva de que Isabel no viera un dato que sí tenía a mano.
 * ──────────────────────────────────────────────────────────────────────────── */

export type SituacionNegocio = {
  /** Informes semanales ya generados (ed_insights). Inteligencia ya pagada. */
  informes: {
    periodo: string;
    resumen: string[];
    problemas: string[];
    oportunidades: string[];
  }[];
  /** Citas por delante, con nombre y servicio. */
  citas: { cuando: string; quien: string; servicio: string; estado: string }[];
  /** Cobros emitidos y sin pagar. */
  cobrosPendientes: { quien: string; monto: number; concepto: string; dias: number }[];
  /** Derivaciones abiertas: por qué se derivó y el resumen que dejó el asistente. */
  esperando: { quien: string; motivo: string; resumen: string; dias: number }[];
  /** Cierres que detectó el sistema, con la evidencia textual que los sostiene. */
  cierres: { quien: string; estado: string; evidencia: string; cuando: string }[];
  /** Resultados del período por tipo, con la plata asociada cuando la hay. */
  resultados: { tipo: string; total: number; valor: number }[];
  /** Clientes marcados como molestos. Va aparte: es lo que no puede pasarse por alto. */
  molestos: { quien: string; cuando: string; nota: string }[];
};

/** Una situación vacía. Sirve de valor por defecto y para las pruebas. */
export function situacionVacia(): SituacionNegocio {
  return {
    informes: [],
    citas: [],
    cobrosPendientes: [],
    esperando: [],
    cierres: [],
    resultados: [],
    molestos: [],
  };
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * La situación en texto plano.
 *
 * Cada bloque se omite ENTERO cuando está vacío, en vez de escribir «Citas:
 * ninguna». Un encabezado sin contenido invita al modelo a comentar sobre la
 * nada; que el bloque no exista es información más limpia que un cero.
 */
export function situacionEnTexto(s: SituacionNegocio): string {
  const partes: string[] = [];

  if (s.esperando.length) {
    partes.push(
      "DERIVACIONES ABIERTAS (nadie las ha atendido):\n" +
        s.esperando
          .map(
            (e) =>
              `· ${e.quien} — hace ${e.dias} ${e.dias === 1 ? "día" : "días"}, motivo «${e.motivo}». ${e.resumen}`,
          )
          .join("\n"),
    );
  }

  if (s.molestos.length) {
    partes.push(
      "CLIENTES MARCADOS COMO MOLESTOS:\n" +
        s.molestos.map((m) => `· ${m.quien} (${m.cuando}) ${m.nota}`.trim()).join("\n"),
    );
  }

  if (s.citas.length) {
    partes.push(
      "PRÓXIMAS CITAS:\n" +
        s.citas.map((c) => `· ${c.cuando} — ${c.quien}, ${c.servicio} (${c.estado})`).join("\n"),
    );
  }

  if (s.cobrosPendientes.length) {
    const total = s.cobrosPendientes.reduce((t, c) => t + c.monto, 0);
    partes.push(
      `COBROS EMITIDOS SIN PAGAR (${pesos(total)} en total):\n` +
        s.cobrosPendientes
          .map(
            (c) =>
              `· ${c.quien} — ${pesos(c.monto)} por ${c.concepto}, emitido hace ${c.dias} ${c.dias === 1 ? "día" : "días"}`,
          )
          .join("\n"),
    );
  }

  if (s.cierres.length) {
    partes.push(
      "CIERRES DETECTADOS (con la frase que los sostiene):\n" +
        s.cierres
          .map((c) => `· ${c.quien} (${c.cuando}) ${c.estado}: «${c.evidencia}»`)
          .join("\n"),
    );
  }

  if (s.resultados.length) {
    partes.push(
      "RESULTADOS DEL PERÍODO:\n" +
        s.resultados
          .map((r) => `· ${r.tipo}: ${r.total}${r.valor > 0 ? ` (${pesos(r.valor)})` : ""}`)
          .join("\n"),
    );
  }

  for (const i of s.informes) {
    const lineas = [
      `INFORME DE LA SEMANA ${i.periodo} (ya analizado por el sistema):`,
      ...i.resumen.map((x) => `· ${x}`),
      ...i.problemas.map((x) => `· problema: ${x}`),
      ...i.oportunidades.map((x) => `· oportunidad: ${x}`),
    ];
    partes.push(lineas.join("\n"));
  }

  return partes.join("\n\n");
}

/**
 * RANKEO DE CONVERSACIONES POR RELEVANCIA.
 *
 * Antes se tomaban «los primeros 10 chats que aparecieran» al buscar cada
 * palabra. Eso premiaba a la palabra que se buscó primero, no a la conversación
 * que más tiene que ver con la pregunta.
 *
 * Ahora manda en cuántos TÉRMINOS distintos aparece el chat: si alguien
 * pregunta «¿qué pasó con la cotización de los pendones?», la conversación que
 * habla de cotización Y de pendones vale más que diez que solo dicen
 * «cotización». A igual cantidad de términos, gana la que apareció más arriba
 * (las listas vienen ordenadas de más reciente a más antigua).
 *
 * @param apariciones una lista de chats por término buscado, ya ordenada.
 */
export function rankearChats(apariciones: string[][], tope = 12): string[] {
  const terminos = new Map<string, number>();
  const mejorPosicion = new Map<string, number>();

  for (const lista of apariciones) {
    const vistosEnEsteTermino = new Set<string>();
    lista.forEach((chat, i) => {
      if (!chat || vistosEnEsteTermino.has(chat)) return;
      vistosEnEsteTermino.add(chat);
      terminos.set(chat, (terminos.get(chat) ?? 0) + 1);
      const previa = mejorPosicion.get(chat);
      if (previa === undefined || i < previa) mejorPosicion.set(chat, i);
    });
  }

  return [...terminos.keys()]
    .sort((a, b) => {
      const dif = (terminos.get(b) ?? 0) - (terminos.get(a) ?? 0);
      if (dif !== 0) return dif;
      return (mejorPosicion.get(a) ?? 0) - (mejorPosicion.get(b) ?? 0);
    })
    .slice(0, tope);
}

/**
 * MEMORIA DE LA CONVERSACIÓN.
 *
 * Sin esto, cada pregunta arrancaba de cero: preguntar «¿y qué le respondimos?»
 * después de hablar de Ana no significaba nada, porque Isabel no tenía idea de
 * quién era «le». Es lo que más rompe la sensación de estar hablando con
 * alguien — más que cualquier ajuste de tono.
 *
 * Se pasan pocos turnos y recortados a propósito: lo que hace falta es que
 * entienda a qué se refiere el pronombre, no que arrastre la sesión entera.
 */
export type TurnoIsabel = { pregunta: string; respuesta: string };

export function hiloEnTexto(turnos: TurnoIsabel[], tope = 3): string {
  return turnos
    .slice(0, tope)
    // Vienen del más nuevo al más viejo; el modelo lee mejor en orden.
    .reverse()
    .map((t) => {
      const p = String(t?.pregunta ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const r = String(t?.respuesta ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!p && !r) return "";
      return `EL DUEÑO: ${p}\nTÚ: ${r}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Términos del hilo que sirven para buscar cuando la pregunta actual no trae
 * ninguno propio. «¿Y qué le respondimos?» no tiene con qué buscar; la pregunta
 * anterior —«¿qué pidió Ana Pérez?»— sí.
 */
export function clavesDelHilo(turnos: TurnoIsabel[]): string[] {
  const previa = turnos[0]?.pregunta ?? "";
  return palabrasClave(previa, 3);
}

export type RespuestaIsabel = {
  respuesta: string;
  /** Hechos concretos en los que se apoya. Vacío si no se apoyó en nada. */
  apoyos: string[];
  /** `no_se` es una respuesta válida y esperada, no una falla. */
  seguridad: "alta" | "media" | "no_se";
};

const PROMPT = `Eres Isabel y trabajas en {{negocio}} ({{rubro}}). Tu pega es que el dueño no tenga que acordarse de todo ni ir a buscar nada.

QUIÉN ERES
No hablas con los clientes del negocio: hablas con el DUEÑO. Revisaste las conversaciones, la agenda, los cobros y lo que el negocio tiene cargado, así que cuando te pregunta algo ya lo tienes visto. Eres parte del equipo, no un buscador con cara de persona.

CÓMO HABLAS
Chileno neutro, directo, frases cortas. Como una colega que conoce el negocio. Nada de «según los datos», «estimado usuario» ni palabras de consultor.

HOY ES: {{hoy}}

═══ DOS SITUACIONES, DOS MANERAS ═══

A) TE HABLAN A TI. Un saludo, «cómo estás», «qué puedes hacer», «gracias», una prueba.
   Contesta como persona, en una o dos líneas, y engancha con algo útil de lo que estás
   viendo ahora mismo. Acá NO corresponde decir que no puedes saberlo: te están hablando a
   ti, no preguntando por el negocio. Seguridad: "alta".
   Ejemplo de tono: «Bien, mirando lo de esta semana. Hay dos personas esperando respuesta
   desde el lunes, ¿parto por ahí?»

B) TE PREGUNTAN POR EL NEGOCIO. Ahí eres rigurosa: todo lo que afirmes sale de lo que
   tienes más abajo. Las cifras, del PANORAMA. Los hechos, de LA SITUACIÓN o de las
   conversaciones. Si no está, lo dices derecho y explicas en una frase qué haría falta.
   Inventar acá le cuesta plata a alguien.

TU CRITERIO SÍ VALE
Que los hechos salgan de los datos no significa que no puedas pensar. Puedes recomendar,
priorizar y decir qué harías tú, siempre que se note qué es un hecho y qué es tu opinión
(«yo partiría por…», «me llama la atención que…»). Una empleada que solo repite cifras no
sirve de mucho.

INICIATIVA
Si algo de lo que ves tiene que ver con la pregunta —alguien esperando hace días, un cobro
viejo sin pagar, un cliente molesto— dilo aunque no te lo hayan preguntado. Y si la
pregunta es vaga, no pidas que te la aclaren: elige lo más importante que ves y parte por
ahí.

DE QUÉ VENÍAN HABLANDO (lo último que se dijeron; si la pregunta se apoya en esto, úsalo):
{{hilo}}

PANORAMA (cifras exactas, ya calculadas: úsalas tal cual, no las recalcules):
{{panorama}}

LA SITUACIÓN AHORA (esto ya lo analizó el sistema; es tan válido como las conversaciones):
{{situacion}}

LO QUE EL NEGOCIO TIENE CARGADO:
{{fichas}}

CONVERSACIONES RELEVANTES:
{{conversaciones}}

LO QUE TE ESTÁN DICIENDO AHORA:
{{pregunta}}

REGLAS QUE NO SE ROMPEN
1. Para contar, las cifras del PANORAMA. Nunca sumes conversaciones a ojo.
2. LA SITUACIÓN manda sobre las conversaciones cuando se contradicen: son hechos ya
   verificados, y una conversación puede ser anterior a ese hecho.
3. Cuando cites algo que dijo un cliente, entre comillas y con la fecha.
4. Máximo 6 frases. Si hay que enumerar, va en los apoyos.
5. No repitas la pregunta ni empieces con «según los datos».

Responde SOLO con este JSON, sin texto alrededor:
{
  "respuesta": "lo que le dices al dueño, máximo 6 frases",
  "apoyos": ["hechos concretos: citas con fecha, cifras, nombres. Máximo 5. Vacío si estabas conversando y no había nada que citar"],
  "seguridad": "alta si la respuesta es sólida (incluye siempre el caso A), media si es parcial, no_se si te preguntaron por el negocio y el dato no está"
}`;

/** Arma el prompt. Separado para poder mirar exactamente qué se le manda. */
export function armarPrompt(e: {
  negocio: string;
  rubro: string;
  hoy: string;
  panorama: string;
  situacion?: string;
  /** Los últimos turnos de la conversación con Isabel. Ver `hiloEnTexto`. */
  hilo?: string;
  fichas: string;
  conversaciones: string;
  pregunta: string;
}): string {
  return PROMPT.replace("{{negocio}}", e.negocio || "el negocio")
    .replace("{{rubro}}", e.rubro || "sin rubro definido")
    .replace("{{hoy}}", e.hoy)
    .replace("{{panorama}}", e.panorama || "sin datos")
    .replace("{{situacion}}", e.situacion || "(sin novedades: nada pendiente ni detectado)")
    .replace("{{hilo}}", e.hilo || "(es la primera pregunta de esta conversación)")
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
