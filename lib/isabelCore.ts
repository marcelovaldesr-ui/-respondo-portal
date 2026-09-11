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

/**
 * Cómo viene esto comparado con el período anterior.
 *
 * Es la pregunta que un dueño hace de verdad: no «cuántas ventas tuve», sino
 * «¿vamos mejor o peor que el mes pasado?». Sin esto, Isabel podía decir «14
 * ventas» sin tener idea de si eso era bueno o malo.
 */
export type Comparacion = { ahora: number; antes: number };

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
  /** Mismo largo de período, corrido hacia atrás. Ausente si no se pudo leer. */
  comparacion?: {
    conversaciones: Comparacion;
    ventas: Comparacion;
    cobrado: Comparacion;
  };
};

/**
 * Redacta una variación de forma honesta.
 *
 * ⭐ EL PORCENTAJE SOLO APARECE CUANDO SIGNIFICA ALGO. Pasar de 2 ventas a 3 no
 * es «+50%», es una venta más — y decirlo en porcentaje sobre números chicos es
 * la forma más fácil de que un informe mienta sin equivocarse en la aritmética.
 * Bajo 10 casos en el período anterior se muestran las cifras y nada más.
 */
export function variacion(c: Comparacion | undefined, unidad = ""): string {
  if (!c) return "";
  const { ahora, antes } = c;
  const suf = unidad ? ` ${unidad}` : "";
  if (antes === 0) return `${ahora}${suf} (antes ninguno)`;
  if (antes < 10) return `${ahora}${suf} (antes ${antes})`;
  const pct = Math.round(((ahora - antes) / antes) * 100);
  const signo = pct > 0 ? "+" : "";
  return `${ahora}${suf} (antes ${antes}, ${signo}${pct}%)`;
}

/** El panorama en texto plano, que es como el modelo lo lee mejor. */
export function panoramaEnTexto(p: PanoramaNegocio): string {
  const etapas = p.porEtapa.length
    ? p.porEtapa.map((e) => `${e.etapa}: ${e.total}`).join(" · ")
    : "sin datos";
  const etiquetas = p.porEtiqueta.length
    ? p.porEtiqueta.map((e) => `${e.etiqueta}: ${e.total}`).join(" · ")
    : "sin datos";
  const comp = p.comparacion;
  const lineaComparacion = comp
    ? [
        `COMPARADO CON LOS ${p.dias} DÍAS ANTERIORES:`,
        `· Conversaciones: ${variacion(comp.conversaciones)}`,
        `· Ventas cerradas: ${variacion(comp.ventas)}`,
        `· Cobrado por enlace de pago: $${Math.round(comp.cobrado.ahora).toLocaleString("es-CL")} (antes $${Math.round(comp.cobrado.antes).toLocaleString("es-CL")})`,
      ].join("\n")
    : "";

  return [
    `Últimos ${p.dias} días: ${p.conversaciones} conversaciones, ${p.mensajes} mensajes.`,
    `Derivadas sin atender ahora mismo: ${p.esperando}.`,
    `Citas agendadas de aquí en adelante: ${p.citasProximas}.`,
    `Cobros pendientes: ${p.cobrosPendientes}. Cobrado en el mes: $${Math.round(p.cobradoMes).toLocaleString("es-CL")}.`,
    `Embudo: ${etapas}.`,
    `Etiquetas más frecuentes: ${etiquetas}.`,
    lineaComparacion,
  ]
    .filter(Boolean)
    .join("\n");
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
  /**
   * Totales REALES de cobros pendientes (Fase 0). La lista de arriba trae solo
   * los más antiguos; antes el "en total" se sumaba sobre esa lista recortada.
   */
  cobrosPendientesTotal?: { cantidad: number; monto: number };
  /** Derivaciones abiertas: por qué se derivó y el resumen que dejó el asistente. */
  esperando: { quien: string; motivo: string; resumen: string; dias: number }[];
  /** Cierres que detectó el sistema, con la evidencia textual que los sostiene. */
  cierres: { quien: string; estado: string; evidencia: string; cuando: string }[];
  /** Resultados del período por tipo, con la plata asociada cuando la hay. */
  resultados: { tipo: string; total: number; valor: number }[];
  /** Clientes marcados como molestos. Va aparte: es lo que no puede pasarse por alto. */
  molestos: { quien: string; cuando: string; nota: string }[];
  /**
   * Ficha completa de las personas que la pregunta nombra.
   *
   * «¿Qué pasa con Ana Pérez?» no se responde bien buscando «Ana» entre los
   * mensajes: lo que hace falta es lo que el negocio SABE de ella —en qué etapa
   * está, cuándo vino por última vez, qué le cobraron, qué tiene agendado—.
   * Eso vive repartido en cuatro tablas y ningún mensaje lo dice.
   */
  contactos: {
    quien: string;
    etapa: string;
    etiquetas: string[];
    ultimaAtencion: string;
    ultimoMensaje: string;
    datos: string;
    pagos: string;
    citas: string;
  }[];
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
    contactos: [],
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

  /**
   * Las fichas van PRIMERO. Si el dueño nombró a alguien, lo que el negocio
   * sabe de esa persona importa más que el panorama general — y lo que va
   * primero es lo que el modelo pondera más.
   */
  for (const c of s.contactos) {
    const lineas = [
      `FICHA DE ${c.quien.toUpperCase()}:`,
      `· Etapa en el embudo: ${c.etapa}`,
      c.etiquetas.length ? `· Etiquetas: ${c.etiquetas.join(", ")}` : "",
      c.ultimaAtencion ? `· Última atención: ${c.ultimaAtencion}` : "",
      c.ultimoMensaje ? `· Último mensaje: ${c.ultimoMensaje}` : "",
      c.datos ? `· Lo que el negocio anotó: ${c.datos}` : "",
      c.pagos ? `· Cobros: ${c.pagos}` : "",
      c.citas ? `· Citas: ${c.citas}` : "",
    ].filter(Boolean);
    partes.push(lineas.join("\n"));
  }

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
    const listado = s.cobrosPendientes.reduce((t, c) => t + c.monto, 0);
    const tot = s.cobrosPendientesTotal;
    const encabezado =
      tot && tot.cantidad > s.cobrosPendientes.length
        ? `${tot.cantidad} cobros, ${pesos(tot.monto)} en total; abajo los ${s.cobrosPendientes.length} más antiguos`
        : `${pesos(tot?.monto ?? listado)} en total`;
    partes.push(
      `COBROS EMITIDOS SIN PAGAR (${encabezado}):\n` +
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

/* ────────────────────────────────────────────────────────────────────────────
 * CORRECCIONES Y MEMORIA DE LARGO PLAZO
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lo que el dueño ya le corrigió. Manda por sobre cualquier otra fuente. */
export type CorreccionIsabel = { pregunta: string; respuestaCorrecta: string };

export function correccionesEnTexto(cs: CorreccionIsabel[]): string {
  if (!cs.length) return "";
  return cs
    .slice(0, 20)
    .map(
      (c) =>
        `· Cuando te preguntan «${String(c.pregunta).replace(/\s+/g, " ").trim().slice(0, 160)}» → ${String(c.respuestaCorrecta).replace(/\s+/g, " ").trim().slice(0, 400)}`,
    )
    .join("\n");
}

/**
 * Un hecho durable observado en las conversaciones. `veces` es lo que separa
 * una anécdota de un patrón, y por eso viaja hasta el prompt: el modelo tiene
 * que poder decir «esto pasa siempre» o «pasó una vez» con fundamento.
 */
export type HechoSabido = {
  tipo: "piden" | "objecion" | "falla" | "precio" | "costumbre";
  clave: string;
  texto: string;
  veces: number;
};

export const TIPOS_SABER = ["piden", "objecion", "falla", "precio", "costumbre"] as const;

const ROTULO_SABER: Record<HechoSabido["tipo"], string> = {
  piden: "LO QUE LA GENTE PIDE (y cómo lo llama)",
  objecion: "LO QUE FRENA LA COMPRA",
  falla: "LO QUE EL ASISTENTE NO SUPO CONTESTAR",
  precio: "PRECIOS QUE SE DIJERON EN CONVERSACIONES",
  costumbre: "CÓMO OPERA ESTE NEGOCIO EN LA PRÁCTICA",
};

/**
 * El saber acumulado, agrupado por tipo y ordenado por cuántas veces se
 * observó. Los hechos vistos UNA sola vez se marcan como tales en vez de
 * omitirse: a veces la anécdota es justo lo que el dueño está buscando, pero
 * tiene que quedar claro que es una.
 */
export function saberEnTexto(hechos: HechoSabido[]): string {
  if (!hechos.length) return "";
  const partes: string[] = [];

  for (const tipo of TIPOS_SABER) {
    const delTipo = hechos
      .filter((h) => h.tipo === tipo)
      .sort((a, b) => b.veces - a.veces)
      .slice(0, 8);
    if (!delTipo.length) continue;
    partes.push(
      `${ROTULO_SABER[tipo]}:\n` +
        delTipo
          .map(
            (h) =>
              `· ${h.texto}${h.veces > 1 ? ` (observado ${h.veces} veces)` : " (visto una sola vez)"}`,
          )
          .join("\n"),
    );
  }

  return partes.join("\n\n");
}

/**
 * Normaliza lo que devuelve el modelo en el destilado nocturno.
 *
 * Es la puerta de entrada a una tabla que se acumula para siempre, así que es
 * estricta a propósito: un tipo inventado, una clave vacía o un texto de dos
 * caracteres entran una vez y se quedan años. Lo que no calza se descarta en
 * silencio — perder un hecho dudoso cuesta menos que ensuciar la memoria.
 */
export function normalizarHechos(crudo: string): HechoSabido[] {
  let p: unknown;
  try {
    p = JSON.parse(crudo);
  } catch {
    return [];
  }
  const lista = Array.isArray(p) ? p : (p as { hechos?: unknown })?.hechos;
  if (!Array.isArray(lista)) return [];

  const vistos = new Set<string>();
  const fuera: HechoSabido[] = [];

  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") continue;
    const h = bruto as Record<string, unknown>;

    const tipo = String(h.tipo ?? "").trim().toLowerCase() as HechoSabido["tipo"];
    if (!TIPOS_SABER.includes(tipo)) continue;

    // La clave es la llave de fusión: sin acentos y sin espacios de sobra, o el
    // mismo hecho se duplicaría por escribirse distinto una noche.
    const clave = sinAcentos(String(h.clave ?? ""))
      .replace(/[^a-z0-9ñ ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    if (clave.length < 3) continue;

    const texto = String(h.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (texto.length < 10) continue;

    const id = `${tipo}|${clave}`;
    if (vistos.has(id)) continue;
    vistos.add(id);

    fuera.push({ tipo, clave, texto, veces: 1 });
    if (fuera.length >= 20) break;
  }

  return fuera;
}

const PROMPT_DESTILADO = `Eres quien le arma la memoria a Isabel, la asistente interna de {{negocio}} ({{rubro}}).

Abajo van las conversaciones REALES de un día entre este negocio y sus clientes. Tu trabajo NO es resumir el día: es sacar los HECHOS DURABLES que van a seguir siendo ciertos dentro de tres meses.

QUÉ ES UN HECHO DURABLE
SÍ: «la gente llama "pendones" a los lienzos de PVC» · «casi todos preguntan si hacen envío a regiones» · «el precio que más se cotiza para 500 flyers es $30.000» · «cuando piden urgente, es para el mismo día» · «el asistente no sabe si trabajan los sábados».
NO: «Ana pidió 500 flyers el martes» (eso es un evento, no un hecho) · «hubo 12 conversaciones» (eso es una cifra) · «el cliente quedó contento» (eso pasa y se va).

REGLAS
1. Si el día no da para ningún hecho durable, devuelve la lista vacía. Inventar un patrón donde hubo tres mensajes ensucia la memoria para siempre.
2. La "clave" es una etiqueta corta (2 a 4 palabras, minúsculas, sin acentos) que se va a usar para reconocer el MISMO hecho en otras noches. Elígela pensando en eso: "envio regiones", no "consulta sobre si envian a regiones".
3. El "texto" va en las palabras que usa la gente del negocio, no en lenguaje de informe.
4. Máximo 8 hechos. Prefiere pocos y sólidos.

NEGOCIO: {{negocio}} ({{rubro}})
DÍA: {{dia}}

CONVERSACIONES:
{{conversaciones}}

Responde SOLO con este JSON, sin texto alrededor:
{"hechos": [{"tipo": "piden|objecion|falla|precio|costumbre", "clave": "etiqueta corta sin acentos", "texto": "el hecho en una frase"}]}`;

export function armarPromptDestilado(e: {
  negocio: string;
  rubro: string;
  dia: string;
  conversaciones: string;
}): string {
  return PROMPT_DESTILADO.replace(/\{\{negocio\}\}/g, e.negocio || "el negocio")
    .replace(/\{\{rubro\}\}/g, e.rubro || "sin rubro definido")
    .replace("{{dia}}", e.dia)
    .replace("{{conversaciones}}", e.conversaciones);
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

⚠️ LO QUE EL DUEÑO YA TE CORRIGIÓ (esto MANDA por sobre todo lo demás, incluidas las cifras y las conversaciones. Si algo de abajo lo contradice, gana esto y no lo discutes):
{{correcciones}}

LO QUE YA SABES DE ESTE NEGOCIO (destilado de meses de conversaciones; «observado N veces» es cuántas noches distintas volvió a aparecer, así que un 1 es una anécdota y un 12 es un patrón):
{{saber}}

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
  /** Correcciones del dueño. Ganan por sobre cualquier dato. */
  correcciones?: string;
  /** Memoria de largo plazo destilada de las conversaciones. */
  saber?: string;
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
    .replace("{{correcciones}}", e.correcciones || "(todavía no te ha corregido nada)")
    .replace("{{saber}}", e.saber || "(todavía no has destilado nada; recién estás conociendo el negocio)")
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
 * ⭐ PREGUNTAS SUGERIDAS SEGÚN LO QUE DE VERDAD ESTÁ PASANDO.
 *
 * Las cinco sugerencias fijas de abajo son el respaldo. Cuando hay algo real
 * —dos personas esperando desde el lunes, un cobro de hace tres semanas sin
 * pagar— la sugerencia deja de ser un ejemplo y pasa a ser un aviso: quien
 * entra a la pantalla ve el problema antes de saber que tenía que preguntarlo.
 *
 * Es la diferencia entre una herramienta que se usa cuando uno se acuerda y una
 * que se abre porque siempre tiene algo que decir.
 */
export function sugerenciasSegunSituacion(s: SituacionNegocio): string[] {
  const fuera: string[] = [];

  if (s.esperando.length) {
    const dias = Math.max(...s.esperando.map((e) => e.dias));
    fuera.push(
      s.esperando.length === 1
        ? `¿Qué pasa con ${s.esperando[0].quien}, que lleva ${dias} ${dias === 1 ? "día" : "días"} esperando?`
        : `¿Quiénes son los ${s.esperando.length} que están esperando respuesta?`,
    );
  }

  if (s.molestos.length) {
    fuera.push("¿Qué pasó con los clientes que quedaron molestos?");
  }

  const viejos = s.cobrosPendientes.filter((c) => c.dias >= 7);
  if (viejos.length) {
    fuera.push(`¿Qué hago con los ${viejos.length} cobros que llevan más de una semana sin pagarse?`);
  }

  if (s.citas.length) {
    fuera.push("¿Quiénes vienen esta semana y a qué?");
  }

  if (s.informes.length && s.informes[0].problemas.length) {
    fuera.push("¿Qué se perdió esta semana y por qué?");
  }

  return fuera.slice(0, 4);
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
