/**
 * QUÉ ES CADA COSA QUE EL NEGOCIO NOS CONTÓ, PARA EFECTOS DE MARKETING.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EL ERROR QUE ESTE ARCHIVO EXISTE PARA NO VOLVER A COMETER
 *
 * `ed_conocimiento` se llenó para que los empleados IA puedan CONTESTAR. Sus
 * categorías —servicios, precios, politicas, faq, vocabulario— son categorías
 * OPERATIVAS: agrupan «cosas que un cliente podría preguntar». No son
 * categorías comerciales.
 *
 * La versión anterior del Estudio leía esa categoría como si lo fuera:
 *
 *     const CATS = /servicio|producto|precio|catalogo|oferta|promo/i;
 *     fichas.filter(f => CATS.test(f.categoria) || CATS.test(f.titulo) || …)
 *
 * Con los datos reales de Respondo eso produce, EN ESTE ORDEN (las fichas
 * llegan ordenadas por categoría y después por título, y se cortan en 6 para
 * los chips):
 *
 *     1. «Cupos y qué cuenta como una conversación»   ← carpeta `precios`
 *     2. «Precios»
 *     3. «Agenda y reservas online»                   ← carpeta `servicios`
 *     4. «Avisos de pedido y conexión con el sistema del negocio»
 *     5. «Cobrar dentro de la conversación»
 *     6. «El panel: qué ve y qué controla el dueño»
 *
 * …que es EXACTAMENTE la lista de «productos» que el Estudio ofreció en
 * producción. No era un modelo alucinando: era un `filter` con una expresión
 * regular sobre el nombre de una carpeta.
 *
 * Y el filtro estaba INVERTIDO respecto de lo que sirve para vender: dejaba
 * fuera «La prueba de 14 días y la instalación» (carpeta `politicas`) que es
 * LA OFERTA REAL, «Resultados de implementaciones reales» (`casos`) que es LA
 * PRUEBA, y cortaba «Cómo escribimos en Respondo» (`vocabulario`) que es LA
 * VOZ DE LA MARCA. Descartaba las tres cosas que un publicista habría mirado
 * primero y promovía la letra chica del plan.
 *
 * ⭐ DOS REGLAS QUE SE PAGARON CARO
 *
 * 1. La carpeta donde vive una ficha NO dice qué papel juega en marketing.
 * 2. **Manda el TÍTULO, no el cuerpo.** El primer intento de este archivo
 *    puntuaba contra el texto completo y fue peor que el original: el cuerpo
 *    de «Qué imprimimos» dice «incluido gratis» en una cláusula secundaria, y
 *    eso lo convertía en OFERTA; el de «Qué es Respondo» menciona «Proveedor
 *    Técnico» y lo convertía en PRUEBA. Un cuerpo largo menciona todo. El
 *    título es lo que el negocio eligió para nombrar ese contenido, y por eso
 *    es la señal fiable. El cuerpo solo desempata.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** El papel que una ficha juega en la construcción del contexto comercial. */
export type RolMarketing =
  /** Quiénes somos, en una línea. Alimenta la propuesta de valor. */
  | "identidad"
  /** Un catálogo: adentro hay varios productos/servicios nombrables. */
  | "catalogo"
  /** Una capacidad del producto. Es lo que HACE, no lo que se compra. */
  | "capacidad"
  /** Una propuesta comercial real: prueba, pack, descuento, garantía. */
  | "oferta"
  /** Evidencia: casos, cifras observadas, años, certificaciones. */
  | "prueba"
  /** A quién le vendemos: rubros, perfiles, situaciones de uso. */
  | "audiencia"
  /** El dolor que resolvemos. Materia prima de los ángulos. */
  | "problema"
  /** Cómo escribe esta marca. Alimenta la voz, nunca el argumento. */
  | "voz"
  /** Precios utilizables en un anuncio. */
  | "precio"
  /** Mecánica de cobro, cupos, letra chica. NI producto NI oferta. */
  | "mecanica"
  /** Pregunta frecuente. Sirve para detectar objeciones, nunca como producto. */
  | "faq"
  /** Política, horario, guion interno. Contexto, no argumento. */
  | "operacion";

export type FichaConocimiento = { categoria: string; titulo: string; contenido: string };

export type FichaClasificada = FichaConocimiento & {
  rol: RolMarketing;
  /** Alta cuando la señal es inequívoca; baja cuando se resolvió por descarte. */
  confianza: "alta" | "media" | "baja";
  /** Por qué quedó en ese papel. Se muestra en el contexto revisable. */
  motivo: string;
};

/* ── Señales, casi todas sobre el TÍTULO ──────────────────────────────────── */

const VOZ_T = /\b(c[óo]mo escribimos|c[óo]mo hablamos|tono|voz de la marca|modismos|vocabulario|c[óo]mo nombran|estilo de escritura)\b/i;
const MECANICA_T = /\b(cupos?|excedentes?|costos? de|cuenta como|c[óo]mo se (cobra|factura)|facturaci[óo]n|l[íi]mite mensual|renovaci[óo]n)\b/i;
const OFERTA_T = /\b(prueba de \d+|prueba gratis|gratis|sin costo|descuento|promoci[óo]n|oferta|pack|combo|2x1|garant[íi]a|instalaci[óo]n incluida|primera (sesi[óo]n|consulta|hora))\b/i;
const PRUEBA_T = /\b(resultados?|casos?|testimoni|rese[ñn]as?|proveedor t[ée]cnico|certificad|acreditad|premios?|desde \d{4}|experiencia)\b/i;
const PROBLEMA_T = /\b(el problema|qu[ée] resolvemos|el dolor|por qu[ée] se pierde|se pierden? ventas)\b/i;
const AUDIENCIA_T = /\b(rubros?|para qui[ée]n|a qui[ée]n|segmentos?|perfil de cliente|tipos? de (negocio|cliente))\b/i;
const CATALOGO_T = /\b(qu[ée] (vende|vendemos|hacemos|imprimimos|ofrecemos|fabricamos)|cat[áa]logo|listado de productos|nuestros (productos|servicios))\b/i;
const IDENTIDAD_T = /\b(qu[ée] es |qui[ée]nes somos|sobre nosotros|nuestra empresa|acerca de)\b/i;
const OPERACION_T =
  /\b(horarios?|ubicaci[óo]n|direcci[óo]n|contacto|sucursales|transferencia|abono|despacho|retiro|devoluciones|c[óo]mo cotizar|c[óo]mo se cierra|c[óo]mo trabajar|qu[ée] datos pedir|qu[ée] preguntar|qu[ée] se puede responder|qu[ée] necesita .* para partir|aprendizajes|motivos de postventa|pol[íi]ticas?)\b/i;
const CAPACIDAD_T =
  /\b(agenda|reservas?|cobrar|cobros?|pagos?|panel|bandeja|reportes?|m[ée]tricas|integraci[óo]n|conexi[óo]n con|avisos?|recordatorios?|seguimiento|derivaci[óo]n|canales?|l[íi]mites|automatiza)\b/i;

const DINERO = /\$\s?\d|\b\d{1,3}\.\d{3}\b|\bUF\s?\d/;
/** Un catálogo enumera: comas encadenadas, o varias líneas «Nombre — …». */
const ENUMERA_COMAS = /(,[^,]{3,40}){3,}/;
const ENUMERA_GUION = /(^|\n)\s*[^\n]{2,30}\s+[—–-]\s+/g;

const CAT_OPERATIVAS = ["horarios", "cotizacion", "postventa", "politicas"];

function enumera(c: string): boolean {
  if (ENUMERA_COMAS.test(c)) return true;
  ENUMERA_GUION.lastIndex = 0;
  return (c.match(ENUMERA_GUION) ?? []).length >= 3;
}

/**
 * Una pregunta nunca es un producto.
 *
 * Distingue la pregunta de verdad del ENCABEZADO que empieza con palabra
 * interrogativa: «Cómo se cierra: la llamada de 30 minutos» no es una pregunta,
 * es un título de sección con dos puntos.
 */
export function esPregunta(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (/[?¿]/.test(t)) return true;
  if (t.includes(":")) return false;
  return /^(qu[ée]|c[óo]mo|cu[áa]ndo|cu[áa]nto|d[óo]nde|por qu[ée]|qui[ée]n|cu[áa]l|se puede|puedo|hay)\b/i.test(t);
}

/**
 * El papel de una ficha.
 *
 * El orden es la decisión: lo inequívoco primero, la carpeta al final y solo
 * como desempate. Cada rama dice por qué, porque ese motivo se le muestra a la
 * persona en el contexto revisable y tiene que poder discutirse.
 */
export function clasificarFicha(f: FichaConocimiento): FichaClasificada {
  const t = (f.titulo ?? "").trim();
  const c = f.contenido ?? "";
  const cat = (f.categoria ?? "").toLowerCase();

  const con = (rol: RolMarketing, confianza: FichaClasificada["confianza"], motivo: string): FichaClasificada => ({
    ...f,
    rol,
    confianza,
    motivo,
  });

  // 1. La voz se reconoce sola, y tiene que salir primero: su cuerpo está
  //    lleno de ejemplos de producto que confundirían a todo lo demás.
  if (cat === "vocabulario" || VOZ_T.test(t)) return con("voz", "alta", "describe cómo escribe la marca");

  // 2. Pregunta explícita.
  if (cat === "faq" || /[?¿]/.test(t)) return con("faq", "alta", "es una pregunta frecuente");

  // 3. Mecánica de cobro. Acá cae «Cupos y qué cuenta como una conversación»,
  //    que es lo que antes encabezaba la lista de productos.
  if (MECANICA_T.test(t)) return con("mecanica", "alta", "explica cómo se cobra, no qué se vende");

  // 4. Oferta: una propuesta concreta en el título, no la palabra «precio».
  if (OFERTA_T.test(t)) return con("oferta", "alta", "anuncia una propuesta comercial concreta");

  // 5. Prueba.
  if (PRUEBA_T.test(t)) return con("prueba", "alta", "aporta evidencia verificable");

  // 6. Precios utilizables: la carpeta de precios más dinero en el cuerpo.
  if (DINERO.test(c) && (cat === "precios" || /\b(precios?|tarifas?|valores|lista)\b/i.test(t))) {
    return con("precio", "alta", "trae precios concretos");
  }

  // 7-8. Encuadre y público.
  if (PROBLEMA_T.test(t)) return con("problema", "alta", "describe el dolor del cliente");
  if (AUDIENCIA_T.test(t)) return con("audiencia", "alta", "describe a quién le vende");

  // 9. Catálogo declarado en el título («Qué imprimimos», «Qué es X y qué vende»).
  //    Va ANTES de identidad a propósito: si el título dice las dos cosas, lo
  //    que sirve para vender es el catálogo.
  if (CATALOGO_T.test(t)) return con("catalogo", "alta", "el título anuncia lo que el negocio vende");

  // 10. Identidad.
  if (IDENTIDAD_T.test(t)) return con("identidad", "alta", "presenta al negocio");

  // 11. Operación DECLARADA en el título: guiones internos, horarios, direcciones.
  if (OPERACION_T.test(t)) return con("operacion", "alta", "es información operativa o un guion interno");

  // 12. Capacidad: lo que el producto HACE.
  //
  //     ⚠️ Va ANTES del descarte por carpeta a propósito. «Los límites los pone
  //     el cliente» vive en `politicas` porque así lo archivó quien lo escribió,
  //     pero es un diferenciador que cualquier publicista usaría. Una señal
  //     explícita en el título le gana siempre a la carpeta, que es la señal
  //     más débil que tenemos.
  if (CAPACIDAD_T.test(t)) return con("capacidad", "alta", "describe una funcionalidad");

  // 13. Carpeta operativa, sin señal en el título.
  if (CAT_OPERATIVAS.includes(cat)) return con("operacion", "media", "está archivada como información operativa");

  // 14. El cuerpo enumera y vive en servicios: es el catálogo aunque el título
  //     no lo diga (así entran «Los cuatro empleados IA y qué hace cada uno»).
  if ((cat === "servicios" || cat === "productos") && enumera(c)) {
    return con("catalogo", "media", "el cuerpo enumera varios productos o servicios");
  }

  // 15. Pregunta blanda (empieza como pregunta, sin signo).
  if (esPregunta(t)) return con("faq", "media", "está redactado como pregunta");

  // 16. Sin señal: la carpeta decide, con confianza baja para que quien
  //     revise sepa que esto se resolvió por descarte y no por evidencia.
  if (cat === "servicios" || cat === "productos") return con("capacidad", "baja", "está en la carpeta de servicios");
  return con("operacion", "baja", "no se pudo determinar");
}

export function clasificarFichas(fichas: FichaConocimiento[]): FichaClasificada[] {
  return (fichas ?? []).map(clasificarFicha);
}

/** Los papeles de los que SÍ se pueden sacar cosas que se venden. */
export const ROLES_VENDIBLES: readonly RolMarketing[] = ["catalogo", "capacidad", "precio", "identidad"];

/* ── El filtro de basura comercial ───────────────────────────────────────── */

export type Veredicto = { sirve: true } | { sirve: false; motivo: string };

/** Formas que jamás son el nombre de algo que se vende. */
const NO_ES_NOMBRE: { re: RegExp; m: string }[] = [
  { re: /\b(pol[íi]tica|t[ée]rminos|condiciones|reglamento|instructivo|manual|preguntas frecuentes|faq)\b/i, m: "es un documento, no un producto" },
  { re: /\b(horarios?|ubicaci[óo]n|contacto|sucursales)\b/i, m: "es información operativa" },
  { re: /\b(cupos?|excedentes?|cuenta como|facturaci[óo]n)\b/i, m: "es mecánica de cobro" },
  { re: /^(c[óo]mo|qu[ée]|cu[áa]ndo|d[óo]nde|por qu[ée]|cu[áa]nto)\b/i, m: "está redactado como explicación" },
  { re: /\s(y qu[ée]|y c[óo]mo)\s/i, m: "es una frase, no el nombre de un producto" },
  { re: /:/, m: "es un encabezado de sección" },
  { re: /\.{3}|…$/, m: "está cortado" },
  { re: /^[^\p{L}\d]/u, m: "no empieza por una palabra" },
];

/**
 * ¿Este texto puede aparecer como «Producto o servicio»?
 *
 * La prueba que hay que pasar es la del mostrador: **¿un cliente pediría esto
 * por su nombre?** «Un pendón roller», sí. «Cupos y qué cuenta como una
 * conversación», no — eso se pregunta, no se pide.
 */
export function candidatoComercial(texto: string): Veredicto {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3) return { sirve: false, motivo: "está vacío" };
  if (t.length > 60) return { sirve: false, motivo: "es demasiado largo para ser el nombre de un producto" };
  if (esPregunta(t) || /[?¿]/.test(t)) return { sirve: false, motivo: "es una pregunta" };
  if (/\.\s/.test(t)) return { sirve: false, motivo: "son varias oraciones" };
  if (t.split(" ").length > 8) return { sirve: false, motivo: "es una frase, no un nombre" };
  for (const { re, m } of NO_ES_NOMBRE) if (re.test(t)) return { sirve: false, motivo: m };
  return { sirve: true };
}

/**
 * ¿Este texto describe una OFERTA, y no simplemente lo primero que había
 * escrito a mano?
 *
 * En la versión anterior, hacer clic en un chip copiaba los primeros 90
 * caracteres del cuerpo de la ficha al campo «Oferta o gancho». Con la ficha
 * de cupos eso escribía ahí «Cada plan trae un cupo mensual de conversaciones.
 * Una conversación es todo el contacto con una misma persona…», que no es una
 * oferta: es el reglamento.
 *
 * Una oferta PROPONE algo: una prueba, un precio, un plazo, una condición.
 * Un gancho, en cambio, es una entrada creativa — y no va en este campo.
 */
export function esOfertaDeVerdad(texto: string): Veredicto {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { sirve: false, motivo: "no hay oferta declarada" };
  if (MECANICA_T.test(t)) return { sirve: false, motivo: "es mecánica de cobro, no una oferta" };
  if (/[?¿]/.test(t)) return { sirve: false, motivo: "es una pregunta" };
  const propone = OFERTA_T.test(t) || DINERO.test(t) || /\b(\d+\s*(d[íi]as?|horas?|semanas?)|envío|despacho|entrega)\b/i.test(t);
  if (!propone) return { sirve: false, motivo: "no propone nada concreto (prueba, precio, plazo o condición)" };
  return { sirve: true };
}
