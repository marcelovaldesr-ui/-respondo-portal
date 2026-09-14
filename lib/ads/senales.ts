/**
 * LAS SEÑALES QUE TIENE ESTE NEGOCIO — el corazón de Marketing multicanal.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE (y por qué era estructural, no cosmético)
 *
 * Marketing se construyó alrededor de un supuesto que nunca se escribió:
 * **que Respondo es dueño de la conversación de WhatsApp**. El embudo, los
 * leads, el retorno, los hallazgos y hasta el asistente de campañas —con su
 * `destino: "whatsapp"` a fuego— salían de ahí.
 *
 * Con eso, un estudio jurídico que pauta en Meta y NO quiere bot veía un
 * producto que le muestra cinco escalones en cero y le pregunta por qué no
 * conectó WhatsApp. Y Respondo mismo, que todavía no tiene flujo atribuible,
 * no podía usar su propio Marketing para crecer. El supuesto no estaba
 * equivocado para Impresora Color: estaba equivocado como CIMIENTO.
 *
 * LA TESIS NUEVA, EN UNA LÍNEA: **Marketing funciona con las señales que hay,
 * y se vuelve más inteligente a medida que recibe más.** WhatsApp no es un
 * prerrequisito, es la última capa —la más valiosa y la que nadie más puede
 * dar— pero una capa.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ LO QUE ESTE ARCHIVO **NO** ES: un selector de modos. No hay «modo asesor»
 * ni «modo completo» que alguien elija en una pantalla. Las señales se DETECTAN
 * de datos reales (hay conexión publicitaria / la plataforma reporta
 * conversiones / hay conversaciones atribuidas / hay plata atribuida) y la UI
 * se adapta sola. Un negocio que mañana conecta WhatsApp gana la capa sin que
 * nadie cambie una configuración, y uno que desconecta la pierde sin que quede
 * una pantalla mintiendo.
 *
 * Puro y sin dependencias de ejecución: se prueba con Node pelado.
 */

/* ── Las cuatro señales ───────────────────────────────────────────────────── */

export type Senal =
  /** Hay al menos una cuenta publicitaria leyendo (Meta o Google). */
  | "ads"
  /** La plataforma publicitaria reporta resultados/conversiones que sabemos nombrar. */
  | "conversiones"
  /** Respondo es dueño de la conversación: se puede seguir a la PERSONA. */
  | "conversaciones"
  /** Hay plata atribuible a un anuncio (cobros por enlace en conversaciones atribuidas). */
  | "ingresos";

export type Senales = Record<Senal, boolean>;

export const SENALES: readonly Senal[] = ["ads", "conversiones", "conversaciones", "ingresos"] as const;

/**
 * La profundidad, para elegir QUÉ mostrar arriba de todo.
 *
 * Es una escalera, pero las señales no son estrictamente anidadas: un negocio
 * puede tener conversaciones atribuidas de una pauta vieja y no tener ninguna
 * cuenta conectada hoy. Por eso `profundidad` es «la señal más profunda que
 * está presente», no «cuántas van seguidas». Sirve para decidir el titular;
 * para decidir si una pantalla concreta se puede dibujar se miran las señales
 * una por una, que es lo que hace el resto del módulo.
 */
export type Profundidad = "ninguna" | Senal;

export const ETIQUETA_SENAL: Record<Senal, string> = {
  ads: "Publicidad",
  conversiones: "Conversiones de la plataforma",
  conversaciones: "Conversaciones propias",
  ingresos: "Ingresos atribuidos",
};

export function senalesVacias(): Senales {
  return { ads: false, conversiones: false, conversaciones: false, ingresos: false };
}

/**
 * Deriva las señales de hechos observables. Cada parámetro es un HECHO, no una
 * preferencia: de ahí que no exista ningún `forzar` ni `modo`.
 */
export function detectarSenales(hechos: {
  /** ¿Hay alguna conexión publicitaria viva (cualquier proveedor)? */
  hayCuentaPublicitaria: boolean;
  /** ¿Alguna fila del período trae un resultado con tipo conocido? */
  plataformaReportaResultados: boolean;
  /** ¿Hay conversaciones atribuidas a un anuncio? */
  hayConversacionesAtribuidas: boolean;
  /** ¿Hay cobros atribuidos a un anuncio? (no basta con tener enlace de pago) */
  hayIngresosAtribuidos: boolean;
}): Senales {
  return {
    ads: hechos.hayCuentaPublicitaria,
    conversiones: hechos.plataformaReportaResultados,
    conversaciones: hechos.hayConversacionesAtribuidas,
    ingresos: hechos.hayIngresosAtribuidos,
  };
}

export function profundidadDe(s: Senales): Profundidad {
  if (s.ingresos) return "ingresos";
  if (s.conversaciones) return "conversaciones";
  if (s.conversiones) return "conversiones";
  if (s.ads) return "ads";
  return "ninguna";
}

/* ── Qué se puede afirmar con lo que hay ──────────────────────────────────── */

/**
 * Las PREGUNTAS del producto, y qué señal exige cada una.
 *
 * Esta tabla es la que impide la peor falla de un panel multicanal: contestar
 * con seguridad algo que no se puede saber. Si un estudio jurídico sin WhatsApp
 * pregunta «¿qué campaña me trae mejores clientes?», la respuesta honesta no es
 * un ranking por costo por resultado —eso responde otra pregunta—, es decir que
 * esa señal no llega y ofrecer la que sí: cuál consigue resultados más barato.
 */
export type Pregunta =
  | "cuanto_gaste"
  | "que_campana_rinde"
  | "que_termino_busca_la_gente"
  | "cuantos_resultados"
  | "quienes_son_las_personas"
  | "calidad_del_lead"
  | "cuanto_vendi"
  | "que_campana_trae_compradores";

export const SENAL_QUE_EXIGE: Record<Pregunta, Senal> = {
  cuanto_gaste: "ads",
  que_campana_rinde: "ads",
  que_termino_busca_la_gente: "ads",
  cuantos_resultados: "conversiones",
  quienes_son_las_personas: "conversaciones",
  calidad_del_lead: "conversaciones",
  cuanto_vendi: "ingresos",
  que_campana_trae_compradores: "ingresos",
};

export function sePuedeResponder(s: Senales, p: Pregunta): boolean {
  return s[SENAL_QUE_EXIGE[p]];
}

/**
 * Por qué no se puede responder, **en el idioma del dueño y sin culparlo**.
 *
 * Cada texto dice tres cosas en este orden: qué no sabemos, por qué, y qué sí
 * podemos ofrecerle en cambio. Un «no disponible» a secas manda a la persona a
 * buscar un botón que no existe.
 */
export function motivoFaltante(s: Senal): string {
  switch (s) {
    case "ads":
      return "Todavía no hay una cuenta publicitaria conectada, así que no sabemos cuánto se invirtió ni cómo viene cada campaña.";
    case "conversiones":
      return "Tu cuenta publicitaria no está reportando conversiones para este período. Se ven igual el gasto, los clics y el alcance.";
    case "conversaciones":
      return "Respondo no recibe las conversaciones de este negocio, así que podemos decir qué anuncio consigue resultados más barato, pero no qué le pasó después a cada persona.";
    case "ingresos":
      return "No hay ventas cobradas asociadas a un anuncio, así que no podemos calcular el retorno en plata.";
  }
}

/* ── Lo que la navegación tiene que saber ─────────────────────────────────── */

/**
 * Qué secciones tienen sentido con estas señales.
 *
 * ⭐ Una sección que no aplica NO se muestra vacía: se saca del riel. «Personas»
 * sin conversaciones no es una lista vacía que se va a llenar sola, es una
 * pantalla que nunca va a tener nada — y dejarla ahí le enseña al dueño que el
 * producto tiene partes muertas.
 *
 * `atribucion` se queda SIEMPRE que haya publicidad, porque con solo ads sigue
 * teniendo qué mostrar: impresiones → clics → resultado. Lo que cambia es de
 * cuántos escalones es el embudo, no si existe.
 */
export type Seccion =
  | "inicio"
  | "campanas"
  /** Palabras clave y términos: solo existe con Google conectado. */
  | "busqueda"
  | "atribucion"
  | "personas"
  | "creatividades"
  | "arquitecto"
  | "copiloto"
  | "integraciones";

export function seccionesVisibles(s: Senales): Record<Seccion, boolean> {
  return {
    inicio: true,
    campanas: true,
    /**
     * Depende del PROVEEDOR, no de la señal: Meta no tiene términos de
     * búsqueda. Quien llama la ajusta con los canales conectados; acá se
     * devuelve false para que nunca aparezca por omisión.
     */
    busqueda: false,
    atribucion: s.ads || s.conversaciones,
    personas: s.conversaciones,
    creatividades: true,
    arquitecto: true,
    copiloto: true,
    integraciones: true,
  };
}

/**
 * Un resumen de una línea de lo que el producto puede hacer hoy por este
 * negocio. Se usa en el prompt del copiloto y en la puesta en marcha.
 */
export function resumenDeSenales(s: Senales): string {
  const tiene: string[] = [];
  if (s.ads) tiene.push("gasto y rendimiento de la cuenta publicitaria");
  if (s.conversiones) tiene.push("resultados que reporta la plataforma");
  if (s.conversaciones) tiene.push("las conversaciones de cada persona que llegó");
  if (s.ingresos) tiene.push("la plata cobrada de esas conversaciones");
  if (!tiene.length) return "Todavía no hay ninguna señal conectada.";
  return `Hoy se puede ver: ${tiene.join("; ")}.`;
}
