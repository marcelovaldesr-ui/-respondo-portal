/**
 * CUÁNDO Y HASTA DÓNDE PUEDE VOLVER TINO A UNA CONVERSACIÓN ABANDONADA.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Hoy, en `responderBot.ts`, hay una sola línea:
 *
 *     if (modo !== "bot") return { accion: "silencio" };
 *
 * Cuando alguien del equipo toca «Tomar el control», Tino se apaga en ese chat
 * **para siempre**. No hay vuelta por tiempo ni por inactividad. Si la persona
 * contesta dos mensajes y se olvida, esa conversación queda muerta y **nadie se
 * entera nunca**: ni el equipo, ni el dueño, ni el sistema.
 *
 * Un cliente que preguntó y nunca recibió respuesta no reclama. Se va.
 *
 * LAS DOS REGLAS QUE GOBIERNAN TODO ESTE ARCHIVO
 * ----------------------------------------------
 * **1 · Tino nunca manda un mensaje que no aporte.** O responde algo concreto, o
 * pregunta algo útil para avanzar. **Nunca avisa que sigue esperando.** Un
 * segundo «déjame confirmarlo» molesta MÁS que el silencio: le confirma al
 * cliente que lo tienen olvidado. Si no hay nada que aportar, se calla con el
 * cliente y se le avisa más fuerte al equipo.
 *
 * **2 · «Estar seguro» NO es opinión del modelo.** Preguntarle a un modelo si
 * está seguro es inútil: dice que sí demasiado seguido. Acá el modelo *propone*
 * y este código *dispone*: la respuesta se acepta solo si cae en una categoría
 * que el negocio habilitó explícitamente. Es determinista, se puede probar, y
 * crece cuando el negocio decide, no cuando el modelo se envalentona.
 *
 * ⚠️ ESTE ARCHIVO NO IMPORTA NADA A PROPÓSITO — sin `@/lib/db` ni Next,
 * `node --test` puede cargarlo. Igual que `parserMeta.ts`, `ritmoHumano.ts` y
 * `ventana24Regla.ts`.
 */

/**
 * Categorías que Tino PUEDE responder al reingresar, si el negocio las habilita.
 *
 * Criterio para que algo entre acá: el dato **no cambia** entre una hora y otra,
 * **no se negocia**, y **no depende de stock**. Si un vendedor pudiera haberlo
 * acordado distinto por teléfono, no va.
 */
export const CATEGORIAS = [
  "horario",
  "direccion",
  "medios_pago",
  "tiempos_despacho",
  "hace_servicio",
  /**
   * ⚠️ PRECIOS ESTÁ ACÁ PERO APAGADO POR DEFECTO, Y ES A PROPÓSITO.
   *
   * En Impresora Color el listado de precios cubre una fracción de lo que
   * venden y lo están completando. Con un catálogo parcial el riesgo no es que
   * el modelo invente de la nada: es que vea el precio de un producto parecido
   * y **infiera** el que falta. Eso es lo que rompe la confianza, y no te
   * enteras hasta que un cliente reclama por una cotización mal hecha.
   *
   * Se habilita con `reingreso_precios` cuando el catálogo esté completo. Es un
   * interruptor del negocio, no un cambio de código.
   */
  "precio",
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

/** Lo que el modelo propone hacer al releer la conversación abandonada. */
export type Propuesta = {
  /** "responder" trae respuesta; "preguntar" trae el dato que falta. */
  accion: "responder" | "preguntar" | "nada";
  categoria?: string;
  texto?: string;
};

export type Decision =
  | { accion: "responder"; texto: string; categoria: Categoria }
  | { accion: "preguntar"; texto: string }
  | { accion: "callar"; motivo: string };

/** Estado de la conversación, ya resuelto por quien llama. */
export type Situacion = {
  /** Minutos desde el último mensaje del cliente sin que nadie conteste. */
  minutosSinRespuesta: number;
  /** Umbral configurado por el negocio. */
  umbralMinutos: number;
  /** ¿El último mensaje es del cliente? Si no, no hay nada abandonado. */
  clienteEsperando: boolean;
  /** ¿Se puede mandar texto libre? En Cloud, fuera de las 24 h no se puede. */
  ventanaAbierta: boolean;
  /** ¿Ya reingresó antes en esta conversación? */
  yaReingreso: boolean;
  /** Interruptor por conversación: «acá Tino no vuelve a entrar». */
  bloqueado: boolean;
  /** Interruptor por cliente. Apagado = el vigilante es inerte. */
  activo: boolean;
};

/**
 * ¿Corresponde siquiera mirar esta conversación?
 *
 * Se separa de la decisión de QUÉ decir porque esto se resuelve **sin gastar una
 * llamada al modelo**, y el 99% de los chats se descartan acá.
 */
export function elegible(s: Situacion): { ok: boolean; motivo: string } {
  if (!s.activo) return { ok: false, motivo: "el cliente no tiene el reingreso activado" };
  if (s.bloqueado) return { ok: false, motivo: "conversación marcada para que Tino no entre" };
  if (!s.clienteEsperando) return { ok: false, motivo: "el último mensaje no es del cliente" };
  if (s.yaReingreso) {
    /**
     * UNA SOLA VEZ POR CONVERSACIÓN. Es la regla que evita lo que más molesta:
     * el asistente insistiendo con lo mismo. Si ya entró y sigue sin respuesta,
     * el problema es del equipo y se resuelve avisándole al equipo, no
     * escribiéndole otra vez al cliente.
     */
    return { ok: false, motivo: "ya reingresó una vez" };
  }
  if (s.minutosSinRespuesta < s.umbralMinutos) {
    return { ok: false, motivo: "todavía no pasa el tiempo de espera" };
  }
  if (!s.ventanaAbierta) {
    /**
     * Fuera de la ventana de 24 h solo salen plantillas aprobadas. Mandar una
     * plantilla de marketing para retomar un chat que el equipo dejó botado
     * costaría plata y se vería peor. Que lo retome una persona.
     */
    return { ok: false, motivo: "ventana de 24 h cerrada: solo saldría una plantilla" };
  }
  return { ok: true, motivo: "" };
}

/**
 * LA REJA. Toma lo que propuso el modelo y decide qué se manda de verdad.
 *
 * Acá es donde «responde solo si está seguro» deja de ser una promesa y pasa a
 * ser una regla: si la categoría no está habilitada, la respuesta **se descarta
 * entera**, por buena que se vea.
 */
export function filtrar(p: Propuesta, habilitadas: readonly string[]): Decision {
  const texto = (p.texto ?? "").trim();

  if (p.accion === "responder") {
    const cat = (p.categoria ?? "").trim() as Categoria;

    // Categoría inventada por el modelo: fuera. Si no la conocemos, no la
    // podemos haber habilitado.
    if (!CATEGORIAS.includes(cat)) {
      return { accion: "callar", motivo: `categoría desconocida: ${cat || "(vacía)"}` };
    }
    if (!habilitadas.includes(cat)) {
      return { accion: "callar", motivo: `categoría no habilitada: ${cat}` };
    }
    if (!texto) return { accion: "callar", motivo: "respuesta vacía" };

    return { accion: "responder", texto, categoria: cat };
  }

  if (p.accion === "preguntar") {
    if (!texto) return { accion: "callar", motivo: "pregunta vacía" };
    /**
     * Una pregunta no necesita lista blanca —no afirma nada del negocio, así que
     * no puede equivocarse en un precio— pero sí necesita APORTAR. Si el modelo
     * disfraza de pregunta un «¿sigues ahí?», es exactamente el mensaje vacío
     * que esta función existe para impedir.
     */
    if (esRelleno(texto)) {
      return { accion: "callar", motivo: "la pregunta no aporta: es un mensaje de relleno" };
    }
    return { accion: "preguntar", texto };
  }

  return { accion: "callar", motivo: "el modelo no propuso nada" };
}

/**
 * Detecta el mensaje que NO queremos mandar nunca: el que solo dice que seguimos
 * acá, que estamos revisando, o que no nos hemos olvidado.
 *
 * Marcelo lo dijo mejor que yo: «no sirve que vuelva a decirle al cliente que
 * aún están esperando». Un segundo aviso de que no hay novedades confirma el
 * abandono en vez de taparlo.
 */
/**
 * ⚠️ OJO CON `\b` Y LOS ACENTOS. El `\b` de JavaScript es ASCII: considera que
 * «í» NO es letra, así que `/ahí\b/` **no calza con «ahí»** — el borde se busca
 * entre «h» e «í» y no existe. Costó un test rojo descubrirlo.
 *
 * Por eso ningún patrón de acá termina en `\b` después de una vocal acentuada.
 */
const RELLENO = [
  /\bsigues?\s+(por\s+)?ah[ií]/i,
  /\bse?guimos?\s+(en\s+eso|revisando|viendo|trabajando)\b/i,
  /\bestamos\s+(revisando|viendo|consultando|en\s+eso)\b/i,
  /\bd[ée]jame\s+(confirmar|revisar|consultar|verificar)\b/i,
  /\bte\s+(confirmo|aviso|respondo)\s+(a\s+la\s+brevedad|pronto|apenas|en\s+cuanto)\b/i,
  /\bno\s+te\s+(hemos\s+)?olvidad/i,
  /\bgracias\s+por\s+(tu\s+)?(paciencia|esperar)\b/i,
  /\ba[uú]n\s+(estamos|seguimos)\b/i,
];

export function esRelleno(texto: string): boolean {
  return RELLENO.some((r) => r.test(texto));
}

/** Categorías habilitadas para un cliente, según sus interruptores. */
export function habilitadasPara(opts: { precios: boolean }): Categoria[] {
  const base: Categoria[] = [
    "horario",
    "direccion",
    "medios_pago",
    "tiempos_despacho",
    "hace_servicio",
  ];
  return opts.precios ? [...base, "precio"] : base;
}
