/**
 * CÓMO SUENA ESTA EMPRESA. Núcleo puro: se infiere y se compara sin red.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ LOS TRES ANUNCIOS SONABAN AL MISMO REDACTOR
 *
 * El prompt anterior empezaba así, para todo el mundo:
 *
 *     «Eres el redactor publicitario de una pyme chilena. (…)
 *      Español de Chile, tuteo, directo.»
 *
 * Eso es una voz, y estaba escrita a fuego en el código. Un estudio jurídico,
 * una imprenta de barrio y una empresa de software B2B recibían la MISMA
 * instrucción de tono, así que salían textos intercambiables. No era culpa del
 * modelo: le estábamos pidiendo literalmente que sonaran igual.
 *
 * Acá la voz es un DATO DEL NEGOCIO, no una constante del producto. Sale del
 * rubro y, cuando existe, de la ficha donde el propio negocio escribió cómo
 * habla —Respondo y Impresora ya tienen una— y se puede corregir a mano.
 *
 * ⚠️ El tuteo no es universal ni siquiera en Chile: un estudio de abogados que
 * tutea en un anuncio pierde al cliente que quiere un abogado serio.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type Formalidad = "tuteo" | "neutro" | "usted";
export type Energia = "sobria" | "media" | "alta";
export type Tecnicidad = "llana" | "media" | "tecnica";
export type EstiloFrase = "corta" | "mixta" | "desarrollada";
export type EstiloAfirmacion = "cauta" | "directa" | "rotunda";

export type VozMarca = {
  formalidad: Formalidad;
  energia: Energia;
  tecnicidad: Tecnicidad;
  /** Cuán directa es la llamada a la acción. */
  franqueza: "suave" | "directa";
  emojis: "nunca" | "ocasional";
  frase: EstiloFrase;
  afirmacion: EstiloAfirmacion;
  /** Frases que esta marca NO usa. Salen de su propia ficha de voz. */
  prohibidas: string[];
  /** De dónde salió: para poder discutirla en el contexto revisable. */
  origen: "declarada" | "rubro" | "por defecto";
};

/**
 * La voz que corresponde a un rubro cuando el negocio no declaró la suya.
 *
 * No es estereotipo por gusto: es el punto de partida menos malo. Un servicio
 * profesional regulado no puede prometer resultados; una imprenta vende plazo y
 * precio y suena a mostrador; el software B2B se juega la credibilidad en no
 * sonar a vendedor.
 */
const POR_RUBRO: { re: RegExp; voz: Partial<VozMarca> }[] = [
  {
    re: /abogad|jur[íi]dic|legal|notar|contab|auditor[íi]a|arquitect|ingenier[íi]a|m[ée]dic|cl[íi]nic|dental|psicolog|estudio profesional/i,
    voz: { formalidad: "usted", energia: "sobria", tecnicidad: "media", franqueza: "suave", emojis: "nunca", frase: "desarrollada", afirmacion: "cauta" },
  },
  {
    re: /software|tecnolog[íi]a|plataforma|saas|inteligencia artificial|automatizaci[óo]n|agencia|consultor[íi]a|b2b/i,
    voz: { formalidad: "tuteo", energia: "sobria", tecnicidad: "media", franqueza: "directa", emojis: "nunca", frase: "corta", afirmacion: "directa" },
  },
  {
    re: /imprenta|impresi|gr[áa]fic|taller|ferreter|repuesto|construc|cerrajer|mec[áa]nic|mueble/i,
    voz: { formalidad: "tuteo", energia: "media", tecnicidad: "llana", franqueza: "directa", emojis: "nunca", frase: "corta", afirmacion: "directa" },
  },
  {
    re: /est[ée]tica|belleza|spa|peluquer|barber|u[ñn]as|masaje|gimnasio|fitness|deportiv|nutrici/i,
    voz: { formalidad: "tuteo", energia: "alta", tecnicidad: "llana", franqueza: "directa", emojis: "ocasional", frase: "corta", afirmacion: "directa" },
  },
  {
    re: /restaur|caf[ée]|panader|pasteler|comida|delivery|tienda|comercio|boutique|moda/i,
    voz: { formalidad: "tuteo", energia: "alta", tecnicidad: "llana", franqueza: "directa", emojis: "ocasional", frase: "corta", afirmacion: "directa" },
  },
];

export const VOZ_POR_DEFECTO: VozMarca = {
  formalidad: "tuteo",
  energia: "media",
  tecnicidad: "llana",
  franqueza: "directa",
  emojis: "nunca",
  frase: "corta",
  afirmacion: "directa",
  prohibidas: [],
  origen: "por defecto",
};

/** Frases que delatan a una máquina. Se suman a las que prohíba cada marca. */
export const MULETILLAS_IA = [
  "potencia tu negocio",
  "lleva tus resultados al siguiente nivel",
  "descubre una nueva forma",
  "optimiza tu comunicación",
  "soluciones pensadas para ti",
  "en el mundo actual",
  "no esperes más",
  "transforma tu",
  "revoluciona",
  "la solución definitiva",
  "estamos aquí para ayudarte",
  "tu aliado estratégico",
  "eleva tu",
  "maximiza tu potencial",
];

/**
 * Lee la ficha de voz que el negocio escribió, si existe.
 *
 * Busca dos cosas concretas y nada más: el bloque de FRASES PROHIBIDAS y las
 * marcas de estilo. Es deliberadamente literal — no le pedimos a un modelo que
 * «interprete el tono», porque entonces la voz volvería a ser una opinión.
 */
export function vozDeclarada(textoDeVoz: string): Partial<VozMarca> {
  const t = textoDeVoz ?? "";
  if (!t.trim()) return {};
  const v: Partial<VozMarca> = {};

  if (/\busted\b|\bustedes\b/i.test(t) && !/\btute/i.test(t)) v.formalidad = "usted";
  if (/tute|\bt[úu]\b/i.test(t)) v.formalidad = "tuteo";

  if (/sin (humo|entusiasmo fingido|exclamaci)|sobri|sin exagerar/i.test(t)) v.energia = "sobria";
  if (/entusias|energ[íi]a|alegr/i.test(t) && !/fingid/i.test(t)) v.energia = "alta";

  if (/nunca dos seguidos|un emoji de vez en cuando|de vez en cuando/i.test(t)) v.emojis = "ocasional";
  if (/sin emojis|nada de emojis|cero emojis/i.test(t)) v.emojis = "nunca";

  if (/m[áa]ximo \d+ l[íi]neas|una sola idea|corrido|frases cortas|nada de listas/i.test(t)) v.frase = "corta";
  if (/clar[ao]|direct[ao]|sin rodeos|responde la pregunta en la primera l[íi]nea/i.test(t)) v.franqueza = "directa";
  if (/no promet|no garantic|no afirmes|no exageres|sin promesas/i.test(t)) v.afirmacion = "cauta";

  const prohibidas = frasesProhibidas(t);
  if (prohibidas.length) v.prohibidas = prohibidas;
  return v;
}

/**
 * Extrae el bloque «FRASES PROHIBIDAS» de la ficha de voz.
 *
 * Respondo tiene una lista escrita —«Estoy aquí para ayudarte», «¡Excelente!»—
 * y que el generador la ignorara era absurdo: el propio negocio ya había hecho
 * el trabajo de decir qué NO quiere leer.
 */
export function frasesProhibidas(texto: string): string[] {
  const m = (texto ?? "").match(/frases?\s+prohibidas?[^\n]*\n?([\s\S]{0,700})/i);
  if (!m) return [];
  const out: string[] = [];
  for (const cita of m[1].matchAll(/[«"“']([^»"”'\n]{3,60})[»"”']/g)) {
    const s = cita[1].trim();
    if (s && !out.includes(s.toLowerCase())) out.push(s.toLowerCase());
  }
  return out.slice(0, 20);
}

export function inferirVoz(rubro: string, textoDeVoz = ""): VozMarca {
  const porRubro = POR_RUBRO.find((r) => r.re.test(rubro ?? ""))?.voz;
  const declarada = vozDeclarada(textoDeVoz);
  const origen: VozMarca["origen"] = Object.keys(declarada).length ? "declarada" : porRubro ? "rubro" : "por defecto";
  return { ...VOZ_POR_DEFECTO, ...porRubro, ...declarada, origen };
}

/** La voz en instrucciones para el modelo. Concreta, no adjetivos sueltos. */
export function vozEnTexto(v: VozMarca): string {
  const l: string[] = [];
  l.push(
    v.formalidad === "usted"
      ? "Trata de USTED. Nunca tutees."
      : v.formalidad === "neutro"
        ? "Evita tratar directamente al lector; escribe impersonal."
        : "Tutea.",
  );
  l.push(
    v.energia === "sobria"
      ? "Tono sobrio: sin signos de exclamación, sin superlativos, sin entusiasmo fingido."
      : v.energia === "alta"
        ? "Tono cercano y con energía, sin caer en gritar."
        : "Tono neutro y cordial.",
  );
  l.push(v.tecnicidad === "tecnica" ? "Puedes usar el vocabulario técnico del rubro." : "Vocabulario llano, sin jerga.");
  l.push(v.frase === "corta" ? "Frases cortas, una idea por frase." : "Puedes desarrollar la idea en frases largas.");
  l.push(
    v.afirmacion === "cauta"
      ? "No prometas resultados ni garantías de ningún tipo. Describe lo que se hace, no lo que se logrará."
      : v.afirmacion === "rotunda"
        ? "Afirma con seguridad lo que el negocio sí puede sostener."
        : "Afirma con claridad, sin exagerar.",
  );
  l.push(v.emojis === "nunca" ? "CERO emojis." : "Como máximo un emoji, y solo si aporta.");
  if (v.prohibidas.length) l.push(`Frases que esta marca NO usa: ${v.prohibidas.map((p) => `«${p}»`).join(" · ")}`);
  return l.join("\n");
}

/** ¿Dos voces suenan distinto? Se usa para probar que tres negocios no se parezcan. */
export function distanciaDeVoz(a: VozMarca, b: VozMarca): number {
  const ejes: (keyof VozMarca)[] = ["formalidad", "energia", "tecnicidad", "franqueza", "emojis", "frase", "afirmacion"];
  return ejes.reduce((n, e) => n + (a[e] === b[e] ? 0 : 1), 0);
}
