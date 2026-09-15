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
/**
 * Mecánica INEQUÍVOCA: expresiones que solo aparecen en la letra chica de un
 * plan. Ninguna de estas nombra jamás algo que un cliente pida por su nombre.
 */
const MECANICA_T = /\b(cupos?|excedentes?|costos? de|cuenta como|c[óo]mo se (cobra|factura)|l[íi]mite mensual|renovaci[óo]n)\b/i;
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

/* ── Proceso o cosa: lo decide la FORMA del título ────────────────────────
 *
 * ⚠️ EL DEFECTO QUE ESTO ARREGLA: `facturaci[óo]n` estaba suelta dentro de
 * MECANICA_T, así que a una empresa que VENDE software de facturación se le
 * clasificaba su producto principal como «mecánica de cobro» y quedaba vetado
 * para siempre: «Software de Facturación Electrónica» caía en el mismo saco
 * que «Cómo funciona la facturación».
 *
 * La palabra sola no puede decidir, porque nombra las dos cosas. Lo que decide
 * es la FORMA en que está redactado el título:
 *
 *   PROCESO  «cómo funciona la facturación», «cuándo se emite la boleta», «la
 *            facturación de los excedentes» → se explica, no se compra.
 *   COSA     «Software de facturación electrónica», «Plataforma de cobranza»
 *            → un sintagma nominal que nombra una entidad.
 *
 * Y si no hay ninguna de las dos formas, no se veta por la sola palabra: eso
 * era exactamente el defecto. Nada de esto mira marcas ni clientes: mira
 * sintaxis.
 * ───────────────────────────────────────────────────────────────────────── */

/** Sustantivos que nombran a la vez un proceso del negocio y el dominio de un producto. */
const DOMINIO_COBRO_FUENTE = "facturaci[óo]n|cobranzas?|cobros?|boletas?|facturas?|emisi[óo]n";
const DOMINIO_COBRO = new RegExp(`\\b(?:${DOMINIO_COBRO_FUENTE})\\b`, "i");

/** El título ABRE como una explicación: lo que sigue es un procedimiento. */
const ABRE_EXPLICACION = /^\s*[¿]?\s*(c[óo]mo|cu[áa]ndo|cu[áa]nto|qu[ée] pasa|por qu[ée]|en qu[ée]|d[óo]nde|qui[ée]n|cu[áa]l)\b/i;

/** Impersonal con «se»: la marca gramatical de que se describe un proceso, no una cosa. */
const VERBO_IMPERSONAL =
  /\bse\s+(cobra|cobran|factura|facturan|emite|emiten|renueva|renuevan|paga|pagan|calcula|calculan|descuenta|descuentan|vence|vencen|acumula|acumulan)\b/i;

/** Artículo + sustantivo + preposición: «la facturación DE los excedentes» es el proceso. */
const MARCO_DEL_PROCESO = new RegExp(`\\b(?:el|la|los|las)\\s+(?:${DOMINIO_COBRO_FUENTE})\\s+(?:de|del|por|en)\\b`, "i");

/**
 * Sustantivos con que cualquier rubro encabeza el nombre de lo que vende.
 *
 * Se exigen ADELANTE, como cabeza del sintagma: así «Software de facturación»
 * nombra un producto y «Avisos de pedido y conexión con el sistema del
 * negocio» sigue siendo una capacidad y no un producto llamado «sistema».
 */
const NUCLEO_PRODUCTO =
  /^\s*(?:(?:el|la|los|las|un|una|unos|unas|nuestro|nuestra|nuestros|nuestras)\s+)?(software|sistemas?|plataformas?|aplicaci[óo]n|app|servicios?|m[óo]dulos?|erp|crm|portal|programa|soluci[óo]n|herramientas?|suite|licencias?)\b/i;

/** ¿Está redactado como la explicación de un procedimiento? */
function esFormaDeProceso(t: string): boolean {
  return ABRE_EXPLICACION.test(t) || VERBO_IMPERSONAL.test(t) || MARCO_DEL_PROCESO.test(t);
}

/**
 * La palabra del dominio escrita en mayúscula SIN ser la primera del título es
 * un nombre propio, no un proceso: «Software de Facturación Electrónica».
 */
function dominioComoNombrePropio(t: string): boolean {
  const re = new RegExp(`\\b(?:${DOMINIO_COBRO_FUENTE})\\b`, "gi");
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const inicial = m[0][0];
    if (m.index > 0 && inicial === inicial.toUpperCase() && inicial !== inicial.toLowerCase()) return true;
  }
  return false;
}

/**
 * ¿El título NOMBRA una cosa que se compra?
 *
 * La forma de explicación manda sobre todo lo demás: «Cómo funciona el
 * software de facturación» sigue siendo una explicación aunque adentro
 * aparezca un sustantivo de producto.
 */
function nombraUnaCosa(t: string): boolean {
  if (esFormaDeProceso(t)) return false;
  return NUCLEO_PRODUCTO.test(t) || dominioComoNombrePropio(t);
}

/**
 * ¿Este título es mecánica de cobro?
 *
 * Fuente única para el clasificador y para el filtro del mostrador: los dos
 * vetaban «facturación» por su cuenta, y arreglar uno solo habría dejado al
 * producto bien clasificado pero igual descartado como nombre.
 */
export function esMecanicaDeCobro(titulo: string): boolean {
  const t = (titulo ?? "").trim();
  // Un título que NOMBRA una cosa nunca es mecánica, aunque use su vocabulario:
  // «Plataforma de cobranza» y «Sistema de renovación» son lo que se vende.
  if (nombraUnaCosa(t)) return false;
  if (MECANICA_T.test(t)) return true;
  if (!DOMINIO_COBRO.test(t)) return false;
  return esFormaDeProceso(t);
}

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
  //    que es lo que antes encabezaba la lista de productos. Y acá NO cae
  //    «Software de facturación electrónica», que antes sí caía por traer la
  //    palabra «facturación» sin que nadie mirara la forma del título.
  if (esMecanicaDeCobro(t)) return con("mecanica", "alta", "explica cómo se cobra, no qué se vende");

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

  // 12b. Un sintagma nominal encabezado por un sustantivo de producto NOMBRA
  //      algo que se compra: «Software de facturación electrónica», «Plataforma
  //      de cobranza automática». Va después de las señales explícitas y antes
  //      de cualquier descarte por carpeta, porque es evidencia del título.
  if (nombraUnaCosa(t) && !esPregunta(t)) {
    return con("catalogo", "media", "el título nombra un producto o servicio que se vende");
  }

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
  { re: /\b(cupos?|excedentes?|cuenta como)\b/i, m: "es mecánica de cobro" },
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
  // La palabra «facturación» estaba en la lista de arriba y vetaba el producto
  // de quien vende software de facturación. Acá se pregunta por la FORMA: se
  // descarta «la facturación de los excedentes», no «Software de Facturación
  // Electrónica».
  if (esMecanicaDeCobro(t)) return { sirve: false, motivo: "es mecánica de cobro" };
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
