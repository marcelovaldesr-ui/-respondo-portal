/**
 * CLASIFICADOR DE PRODUCTO — de cómo habla el cliente al producto real.
 *
 * PARA QUÉ EXISTE
 * El asistente etiqueta por INTENCIÓN (cotización, reclamo, agendado — ver
 * `lib/etiquetas.ts`). Eso responde "¿qué está pasando en esta conversación?",
 * pero no responde "¿qué me están pidiendo más?". Esa segunda pregunta es la que
 * hace que un dueño decida qué stock tiene y en qué pauta plata, y es la que
 * alimenta la pantalla de reportes del sistema del cliente.
 *
 * DE DÓNDE SALE EL VOCABULARIO — ESTO IMPORTA
 * No se inventó. Sale de la ficha de conocimiento `categoria = 'vocabulario'`
 * que el asistente YA usa en producción para entender a los clientes reales
 * ("Cómo nombran los clientes los productos — modismos chilenos"). O sea: este
 * mapa venía validado contra conversaciones reales antes de existir como código.
 *
 * ⚠ REGLA DE MANTENCIÓN: si se corrige la ficha de vocabulario de un cliente,
 * hay que reflejarlo acá (y al revés). La ficha es la fuente de verdad para el
 * asistente; este archivo lo es para los reportes. Se mantienen a mano a
 * propósito: parsear la ficha en tiempo de ejecución sería frágil, porque es
 * texto libre escrito para un modelo, no un formato de datos.
 *
 * POR QUÉ DICCIONARIO Y NO IA
 * Determinista, gratis, auditable, y no agrega una dependencia que se pueda caer
 * en el camino de una conversación real. Cuando falla se ve por qué y se corrige
 * una línea; un clasificador con modelo habría que revalidarlo en cada versión.
 *
 * POR RUBRO, NO POR CLIENTE
 * Misma forma que `lib/plantillasRubro.ts`: la llave es `ed_clientes.rubro`, así
 * el siguiente cliente del mismo rubro lo hereda sin tocar código. Un rubro sin
 * diccionario devuelve null y no rompe nada.
 *
 * CALIBRADO CONTRA DATOS REALES (11-ago-2026)
 * Se corrió sobre 1.000 mensajes de cliente y 94 conversaciones reales de
 * Impresora Color. Resultado: 40% de las conversaciones quedan con producto
 * identificado. Ese número parece bajo hasta que se mira el resto: son hilos que
 * NUNCA nombran un producto (llegan con "Hola", o el detalle vino por audio o
 * imagen), más un 9% que no son clientes (notificaciones de banco, Rappi,
 * cobranzas, chats personales). Por eso la unidad de medida correcta es la
 * CONVERSACIÓN y no el mensaje: dentro de un hilo, el producto se nombra una vez
 * y los otros 20 mensajes son medidas, montos y "ok gracias".
 */

export type Producto = {
  /** Etiqueta que se muestra tal cual en los reportes del cliente. */
  label: string;
  /**
   * Cómo lo nombra la gente. Se comparan normalizados (sin tildes, minúsculas) y
   * con borde de palabra, así "lona" no calza dentro de "colonial". Gana el
   * término MÁS LARGO que calce, para que "pendón roller" no se quede en
   * "pendón" ni "tarjeta pvc" se confunda con "tarjeta".
   */
  terminos: string[];
  /**
   * Términos tan genéricos que solo valen si NADA más calzó. "impresiones" es el
   * caso típico: aparece en "impresión de trípticos" (donde gana tríptico) y
   * también sola, cuando de verdad el cliente quiere fotocopias.
   */
  fallback?: string[];
  /**
   * true = el negocio NO lo hace. Se clasifica igual A PROPÓSITO: saber cuánta
   * gente pide algo que no vendes es información comercial, no basura. Si 30
   * personas al mes piden poleras, eso es una decisión de negocio esperando.
   */
  noSeHace?: boolean;
};

/**
 * Desambiguaciones que corren ANTES del diccionario, porque una palabra sola no
 * alcanza para decidir. Salen de la propia ficha de vocabulario, que marca
 * explícitamente qué términos son ambiguos y qué habría que preguntar.
 *
 * `entonces: null` significa "no clasificar": hay casos donde la palabra clave
 * aparece pero el pedido es otra cosa (un PORTAtarjetas no es una tarjeta), y
 * ahí es mejor no contar nada que contar mal.
 */
type Regla = { si: RegExp; entonces: string | null };

export const RUBROS: Record<string, { reglas: Regla[]; productos: Producto[] }> = {
  imprenta: {
    reglas: [
      /**
       * PORTAtarjetas / PORTAcredenciales: accesorios, no impresos. Aparecieron
       * dos veces en datos reales (una consulta directa y un link de Mercado
       * Libre) y las dos veces contaminaban el conteo de tarjetas.
       */
      { si: /\bporta ?(tarjeta|credencial|carnet)\w*\b/, entonces: null },
      /**
       * "Tarjetas" es el caso ambiguo que la ficha marca en mayúsculas: puede ser
       * papel (presentación) o plástico (credencial PVC). Decide el contexto; sin
       * contexto cae al diccionario y queda como presentación, que es lo mucho
       * más frecuente.
       */
      {
        si: /\btarjeta\w*\b[^.]{0,40}\b(pvc|plastic\w+|carnet|carne|socio\w*|gimnasio|acceso|credencial|evento)\b/,
        entonces: "Credenciales PVC",
      },
      {
        si: /\b(pvc|plastic\w+|carnet|socio\w*|gimnasio)\b[^.]{0,40}\btarjeta\w*\b/,
        entonces: "Credenciales PVC",
      },
      /** Tarjetas de condolencias: producto distinto, apareció en datos reales. */
      { si: /\btarjeta\w*\b[^.]{0,30}\bcondolencia\w*\b/, entonces: "Tarjetas de condolencias" },
      /**
       * "Letrero" aparece en tres productos distintos y el material decide: de
       * tela/lona es gran formato, de caballete es paloma, el resto señalética.
       * Sin esta regla, "letrero de tela con armado de madera" (caso real) caía
       * en señalética.
       */
      { si: /\bletrero\w*\b[^.]{0,30}\b(tela|lona|pvc|genero|tel[oó]n)\b/, entonces: "Lonas y telas PVC" },
      { si: /\bletrero\w*\b[^.]{0,30}\b(caballete|vereda|piso|tipo a)\b/, entonces: "Palomas publicitarias" },
      /**
       * "Etiqueta" vs "sticker": la ficha dice que hay ambigüedad y que se
       * pregunta para qué es. Si nombra un producto envasado, es etiqueta de
       * producto — la especialidad de la casa.
       */
      {
        si: /\betiqueta\w*\b[^.]{0,60}\b(vino\w*|cerveza\w*|cecina\w*|longaniza\w*|chorizo\w*|queso\w*|merken|mermelada\w*|miel|conserva\w*|frasco\w*|botella\w*|aceite|licor\w*|salsa\w*)\b/,
        entonces: "Etiquetas de producto",
      },
      /** "Folleto" solo es ambiguo (flyer o díptico); el doblez lo define. */
      {
        si: /\bfolleto\w*\b[^.]{0,40}\b(dobl\w+|d[ií]ptico|tr[ií]ptico|desplegable)\b/,
        entonces: "Dípticos / trípticos",
      },
    ],
    productos: [
      {
        label: "Flyers / volantes",
        terminos: [
          "flyer", "flyers", "flayer", "flayers",
          "volante", "volantes", "bolante", "bolantes",
          "panfleto", "panfletos", "folletin", "folletines",
          "hojita publicitaria", "papelito publicitario",
          "publicidad para repartir", "publicidad pa repartir",
        ],
      },
      {
        label: "Dípticos / trípticos",
        terminos: ["diptico", "dipticos", "triptico", "tripticos", "desplegable", "desplegables", "brochure", "folleto doblado"],
      },
      {
        label: "Afiches",
        terminos: ["afiche", "afiches", "poster", "posters", "cartel", "carteles", "lamina publicitaria"],
      },
      {
        label: "Tarjetas de presentación",
        terminos: [
          "tarjeta de presentacion", "tarjetas de presentacion",
          "tarjeta de visita", "tarjetas de visita",
          "tarjetita", "tarjetitas", "tarjeta", "tarjetas",
        ],
      },
      { label: "Tarjetas de condolencias", terminos: ["tarjeta de condolencia", "tarjetas de condolencias", "condolencias"] },
      {
        label: "Credenciales PVC",
        terminos: [
          "credencial", "credenciales", "carnet", "carnets", "carne de socio",
          "tarjeta plastica", "tarjetas plasticas", "tarjeta pvc", "tarjetas pvc",
          "acreditacion", "acreditaciones", "gafete", "gafetes", "photocheck",
        ],
      },
      {
        label: "Stickers",
        terminos: [
          "sticker", "stickers", "stiker", "stikers", "esticker", "estiker",
          "autoadhesivo", "autoadhesivos", "auto adhesivo",
          "calcomania", "calcomanias", "pegatina", "pegatinas", "pegotin", "pegotines",
        ],
      },
      { label: "Etiquetas de producto", terminos: ["etiqueta", "etiquetas", "etiquetado"] },
      {
        label: "Pendones / roller",
        terminos: ["pendon", "pendones", "pendon roller", "roller", "rollers", "banderola", "banderolas", "araña publicitaria", "banner"],
      },
      {
        label: "Lonas y telas PVC",
        terminos: [
          "lona", "lonas", "tela pvc", "telas pvc", "gigantografia", "gigantografias",
          "lienzo", "lienzos", "telon", "telones", "pasacalle", "pasacalles",
        ],
      },
      {
        label: "Adhesivo y trovicel",
        terminos: ["trovicel", "sintra", "foamboard", "foam board", "pvc espumado", "vinilo adhesivo", "adhesivo por metro", "adhesivo para la vitrina"],
      },
      { label: "Palomas publicitarias", terminos: ["paloma publicitaria", "palomas publicitarias", "letrero caballete", "letrero tipo a"] },
      { label: "Imanes publicitarios", terminos: ["iman", "imanes", "iman publicitario", "magnetico", "magneticos"] },
      { label: "Timbres", terminos: ["timbre", "timbres", "timbre de goma", "timbre automatico", "sello de goma", "cuño", "cuños"] },
      {
        label: "Talonarios",
        terminos: [
          "talonario", "talonarios", "autocopiativo", "autocopiativos",
          "guia de despacho", "guias de despacho", "comanda", "comandas",
          "recetario", "recetarios", "set autocopiativo",
        ],
      },
      {
        label: "Anillados / empastes",
        terminos: [
          "anillado", "anillados", "argollado", "espiralado", "wire o",
          "empaste", "empastes", "empastado", "empastados",
          "encuadernacion", "empaste de tesis", "tapa dura", "tapa semi dura",
        ],
      },
      {
        label: "Fotocopias e impresiones",
        terminos: ["fotocopia", "fotocopias", "sacar copias", "saca copias"],
        // Solo si nada más calzó: "impresión de trípticos" debe quedar en tríptico.
        fallback: ["impresion", "impresiones", "imprimir", "impreso", "impresos"],
      },
      {
        label: "Libros y manuales",
        terminos: ["libro", "libros", "manual", "manuales", "reglamento", "reglamentos", "memoria de titulo"],
      },
      { label: "Agendas", terminos: ["agenda", "agendas"] },
      { label: "Diplomas y certificados", terminos: ["diploma", "diplomas", "certificado", "certificados", "reconocimiento", "reconocimientos"] },
      {
        label: "Invitaciones y entradas",
        terminos: ["invitacion", "invitaciones", "parte de matrimonio", "partes de matrimonio", "tarjeta de matrimonio", "entradas", "ticket", "tickets"],
      },
      { label: "Menús / cartas", terminos: ["menu", "menus", "carta del local", "carta del restaurant", "carta para el restaurant"] },
      { label: "Señalética", terminos: ["señaletica", "señaleticas", "señalizacion", "letrero", "letreros", "señal de seguridad"] },
      { label: "Calendarios", terminos: ["calendario", "calendarios", "almanaque", "almanaques"] },
      { label: "Cuadernos y libretas", terminos: ["cuaderno", "cuadernos", "libreta", "libretas"] },
      { label: "Sobres", terminos: ["sobre membretado", "sobres membretados", "sobres impresos"] },
      { label: "Carpetas corporativas", terminos: ["carpeta", "carpetas", "carpeta corporativa", "carpetas corporativas", "carpeta institucional"] },
      { label: "Bolsas personalizadas", terminos: ["bolsa", "bolsas", "bolsa personalizada", "bolsas personalizadas", "bolsa con logo", "bolsas con logo", "bolsa de tela", "bolsa de algodon"] },
      { label: "Patentes de camión", terminos: ["patente para camion", "patentes de camion", "patente de camion"] },
      { label: "Stands publicitarios", terminos: ["stand publicitario", "stands publicitarios", "stand para feria"] },
      {
        label: "Páginas web",
        terminos: ["pagina web", "paginas web", "sitio web", "sitios web", "landing", "landing page", "tienda online", "ecommerce"],
      },
      { label: "Diseño gráfico", terminos: ["diseño grafico", "diseñar el logo", "diseño de logo", "logotipo"] },

      /**
       * LO QUE NO SE HACE. Se clasifica igual, por decisión de negocio: la ficha
       * de vocabulario lista explícitamente estos rechazos, y contarlos convierte
       * un "no" repetido en un dato accionable.
       */
      { label: "Tazas (no se hacen)", terminos: ["taza", "tazas", "tazon", "tazones"], noSeHace: true },
      {
        label: "Textil / poleras (no se hacen)",
        terminos: ["polera", "poleras", "poleron", "polerones", "camiseta", "camisetas", "gorro bordado", "ropa estampada"],
        noSeHace: true,
      },
      {
        label: "Letreros luminosos (no se hacen)",
        terminos: ["letrero luminoso", "letreros luminosos", "neon", "letras corporeas", "letrero led"],
        noSeHace: true,
      },
      {
        label: "Artículos promocionales (no se hacen)",
        terminos: ["lapices promocionales", "llaveros personalizados", "termo personalizado", "termos personalizados", "articulos promocionales", "termo", "termos"],
        noSeHace: true,
      },
    ],
  },
};

/** Minúsculas y sin tildes: la gente escribe "pendon", "menu", "iman", "señaletica". */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mensajes que NO son una consulta de producto: cierres, confirmaciones, saludos
 * sueltos, adjuntos sin texto, links pelados y números sueltos.
 *
 * POR QUÉ ES NECESARIO (medido, no supuesto): de 1.000 mensajes reales de
 * Impresora Color, 281 son de este tipo. Contarlos como "Sin clasificar" haría
 * que esa barra se comiera el gráfico y el dueño dejara de creerle al panel —
 * que es peor que no tener panel.
 */
const RUIDO_ESTRUCTURAL: RegExp[] = [
  /^\[el cliente envi[oó]/, // adjunto sin texto: ese metadato lo pone el propio bot
  /^[\s\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]+$/u, // solo emojis
  /^https?:\/\/\S+$/, // link pelado
  /^blob:\S+$/,
  /^[\d\s.,$+()x×-]+$/, // puro número: montos, medidas sueltas, teléfonos
];

/**
 * Palabras que solas no dicen nada: saludos, cierres, confirmaciones y muletillas.
 *
 * POR QUÉ UNA LISTA DE PALABRAS Y NO UNA LISTA DE FRASES: la primera versión
 * enumeraba frases completas ("ok", "gracias", "muchas gracias") y se le escapaba
 * "Ok gracias", que es literalmente el mensaje más común de la base. Enumerar
 * combinaciones no termina nunca — "ya listo", "si gracias", "perfecto muchas
 * gracias", "dale ok". Mirando palabra por palabra, todas esas caen solas.
 *
 * REGLA: un mensaje es ruido si TODAS sus palabras están acá. Basta una palabra
 * con contenido para que el mensaje se conserve, que es el lado correcto donde
 * equivocarse (perder un producto es peor que contar un "ok" de más).
 */
const MULETILLAS = new Set([
  "ok", "oka", "okey", "okay", "okis", "dale", "vale",
  "listo", "lista", "bien", "bueno", "buena", "genial", "perfecto", "excelente",
  "buenisimo", "bacan", "regio", "estupendo",
  "si", "sii", "sip", "no", "nop", "ya", "yaa", "yaaa",
  "aprobado", "recibido", "correcto", "claro", "obvio", "enviado", "confirmado",
  "gracias", "muchas", "mil", "agradecida", "agradecido",
  "hola", "holaa", "holaaa", "buenas", "buenos", "dia", "dias", "tardes", "noches",
  "hey", "alo", "alooo",
  "chao", "adios", "hasta", "luego", "nos", "vemos", "estes", "cuidate", "saludos",
  "por", "favor", "porfa", "porfavor",
  "jaja", "jajaja", "jeje", "mm", "mmm", "emm", "eh", "ah", "oh", "uf",
  "todo", "igualmente", "abrazo", "cordial", "cordiales", "atenta", "atento",
  "asi", "eso", "esto", // "Así 👍🏻", "eso", "esto" solos son confirmaciones
]);

/**
 * Unidades de medida y cantidad.
 *
 * Van junto a las muletillas porque un mensaje que SOLO trae medidas
 * ("436,6cm x 59,4 cm", caso real) es un dato de un pedido que ya está en curso,
 * no la mención de un producto. Cuenta para el hilo, no para el ranking.
 */
const UNIDADES = new Set([
  "cm", "cms", "mm", "mt", "mts", "m", "metro", "metros", "x", "por",
  "gr", "grs", "gramos", "kg", "cc", "lt", "lts",
  "u", "un", "uds", "unidad", "unidades", "aprox",
]);

export function esRuido(texto: string): boolean {
  const t = normalizar(texto);
  if (t.length < 3) return true;
  if (RUIDO_ESTRUCTURAL.some((r) => r.test(t))) return true;

  /**
   * Se miran solo las PALABRAS (letras), no los números.
   *
   * Un mensaje sin ninguna palabra es un monto, una medida o un teléfono: dato
   * de un pedido en curso, no una consulta. Y si todas las palabras que tiene
   * son muletillas o unidades, tampoco aporta. Basta UNA palabra con contenido
   * para conservarlo — es el lado correcto donde equivocarse, porque perder la
   * mención de un producto es peor que contar un "ok" de más.
   */
  const palabras = t.match(/[a-zñ]+/g);
  if (!palabras) return true;
  return palabras.every((w) => MULETILLAS.has(w) || UNIDADES.has(w));
}

/**
 * NO ES UN CLIENTE. Notificaciones automáticas y mensajes de otras empresas que
 * llegan al mismo WhatsApp: bancos, Previred, Rappi, campañas de terceros,
 * portales de compra pública.
 *
 * POR QUÉ IMPORTA: en los datos reales son 8 de 94 conversaciones (9%). Sin este
 * filtro, la bandeja de leads de Cecilia abre con Rappi y una promoción de
 * depilación arriba, y deja de usarse. Un tablero de trabajo sirve por lo que
 * DEJA FUERA — misma lección que el corte por actividad del embudo.
 *
 * Es deliberadamente conservador: solo marca lo que es inequívocamente
 * automático. Ante la duda, deja pasar (un lead de más molesta menos que un lead
 * perdido).
 */
const NO_ES_CLIENTE: RegExp[] = [
  /\brappi\b/,
  /\bpreviredb?\b|\bimposiciones\b/,
  /c[oó]digo de verificaci[oó]n|no compartas este c[oó]digo|tu c[oó]digo es \d/,
  /\bmercadopublico\b|buscador\.mercadopublico/,
  /empresas\.bci\.cl|\bsantander\b.*\btransferencia autom/,
  /te has llevado un \d+ ?% de descuento|para asegurar tu cita/,
  /hemos terminado esta conversaci[oó]n/,
];

export function esNotificacionAutomatica(texto: string): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  return NO_ES_CLIENTE.some((r) => r.test(t));
}

/**
 * MENSAJE PREFORMATEADO ("Hola, quiero cotizar ...").
 *
 * Hallazgo de los datos reales: 23 de 94 conversaciones (24%) empiezan con este
 * texto, que el cliente NO escribió — viene prellenado por el enlace desde el
 * que entró. Detectarlo sirve para dos cosas: atribuir el lead a su origen en
 * vez de meterlo en la bolsa "WhatsApp", y aprovechar que varias variantes ya
 * traen el producto ("...quiero cotizar stickers personalizados").
 *
 * ⚠ QUÉ ORIGEN ES, EXACTAMENTE: sabemos que viene de un enlace con texto
 * prellenado, pero no si ese enlace es un anuncio de Click-to-WhatsApp o el
 * botón de WhatsApp del sitio/Instagram del negocio. Son cosas distintas para
 * medir retorno, así que hay que confirmarlo con el dueño antes de darle nombre
 * definitivo. Hasta entonces se marca como "anuncio", que es la hipótesis más
 * probable, y cambiarlo es una línea.
 */
export function esMensajePreformateado(texto: string): boolean {
  if (!texto) return false;
  return /^hola,?\s*(quiero|necesito|me gustaria)\s+cotizar\b/.test(normalizar(texto));
}

export type Clasificacion = {
  /** Etiqueta de producto, o null si no se reconoció ninguno. */
  producto: string | null;
  /** Término exacto que hizo el match. Sirve para depurar sin adivinar. */
  termino: string | null;
  noSeHace: boolean;
};

const VACIO: Clasificacion = { producto: null, termino: null, noSeHace: false };

/**
 * Clasifica un mensaje. Devuelve producto null cuando no reconoce nada — a
 * propósito: es mejor no clasificar que clasificar mal, porque un ranking con
 * productos inventados es peor que un ranking con menos filas.
 */
export function clasificarProducto(texto: string, rubro: string): Clasificacion {
  if (!texto || esRuido(texto)) return VACIO;

  const cfg = RUBROS[normalizar(rubro)];
  if (!cfg) return VACIO; // rubro sin diccionario: no rompe, solo no clasifica

  const t = normalizar(texto);

  // 1) Desambiguaciones primero: son más específicas que cualquier término solo.
  for (const regla of cfg.reglas) {
    if (!regla.si.test(t)) continue;
    if (regla.entonces === null) return VACIO; // "no clasificar" explícito
    const p = cfg.productos.find((x) => x.label === regla.entonces);
    return { producto: regla.entonces, termino: "(regla)", noSeHace: Boolean(p?.noSeHace) };
  }

  // 2) Diccionario: gana el término más largo que calce (el más específico).
  const calza = (termino: string): boolean =>
    new RegExp(`(^|[^a-z0-9])${escapar(normalizar(termino))}([^a-z0-9]|$)`).test(t);

  let mejor: { producto: Producto; termino: string } | null = null;
  for (const producto of cfg.productos) {
    for (const termino of producto.terminos) {
      if (!calza(termino)) continue;
      if (!mejor || termino.length > mejor.termino.length) mejor = { producto, termino };
    }
  }

  // 3) Solo si nada calzó: términos genéricos de respaldo.
  if (!mejor) {
    for (const producto of cfg.productos) {
      for (const termino of producto.fallback ?? []) {
        if (!calza(termino)) continue;
        if (!mejor || termino.length > mejor.termino.length) mejor = { producto, termino };
      }
    }
  }

  if (!mejor) return VACIO;
  return { producto: mejor.producto.label, termino: mejor.termino, noSeHace: Boolean(mejor.producto.noSeHace) };
}

/**
 * URGENCIA. Solo devuelve "alta" o "media" cuando hay una señal explícita; si no,
 * null. Nunca marca "baja" por defecto: pintar todo de "Baja" en la pantalla de
 * leads es ruido visual que hace que los badges dejen de significar algo.
 */
export function detectarUrgencia(texto: string): "alta" | "media" | null {
  if (!texto) return null;
  const t = normalizar(texto);

  if (/\burgent\w*\b|\burgencia\b|\bpara hoy\b|\bhoy mismo\b|\bahora mismo\b|\blo antes posible\b|\bcuanto antes\b|\bapurad\w+\b|\bes para ya\b|\bcorriendo\b/.test(t)) {
    return "alta";
  }
  if (/\bpara mañana\b|\bmañana mismo\b|\besta semana\b|\bpara el (lunes|martes|miercoles|jueves|viernes|sabado)\b|\bpara este (lunes|martes|miercoles|jueves|viernes|sabado)\b|\bantes del (lunes|martes|miercoles|jueves|viernes|sabado)\b/.test(t)) {
    return "media";
  }
  return null;
}
