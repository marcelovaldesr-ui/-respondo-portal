import type { ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import type { Angulo, DireccionVisual } from "@/lib/marketing/copyCore";
import type { FormatoCreatividad } from "@/lib/marketing/tipos";

/**
 * QUÉ SE VE EN LA IMAGEN — núcleo puro.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ TODOS LOS SAAS TIENEN LA MISMA FOTO
 *
 * El prompt anterior decía, para cualquier negocio y cualquier anuncio:
 *
 *     «describe UNA fotografía publicitaria realista del producto en su
 *      contexto de uso, sin texto ni logos, luz natural, estilo editorial»
 *
 * Eso no es una dirección de arte, es un molde. Con un producto físico —un
 * pendón, una polera— todavía funciona, porque el producto se puede fotografiar.
 * Con software no hay nada que fotografiar, así que el modelo rellena con lo
 * único que conoce: una persona genérica mirando un teléfono. Y entonces
 * Respondo se anuncia con la misma imagen que cualquier competidor del mundo.
 *
 * Acá la imagen es consecuencia del ÁNGULO: si el anuncio habla de horas
 * perdidas por inasistencia, la foto es una agenda con huecos, no una persona
 * sonriendo con un notebook.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOS PROHIBICIONES DURAS
 *
 * 1. **Nada que parezca una captura de pantalla real.** Una interfaz inventada
 *    por un modelo, con textos falsos y botones que no existen, presentada como
 *    si fuera el producto, es material engañoso — y el día que alguien la
 *    compare con el producto real, el que queda mal es el negocio. Si hace
 *    falta mostrar el producto, se usa una captura DE VERDAD.
 * 2. **Nada de logos.** Ni el del negocio ni el de terceros. Un modelo no
 *    reproduce un logo: lo deforma. El logo se pone después, en el editor.
 *
 * ⭐ Y una advertencia que el caso de Respondo hace explícita: la marca es
 * Respondo, WhatsApp es el canal. Pintar todo de verde WhatsApp es anunciar a
 * Meta gratis.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Qué se puede fotografiar en este negocio. Cambia toda la dirección. */
export type Materia = "producto_fisico" | "servicio_presencial" | "intangible";

const FISICO = /imprenta|impresi|gr[áa]fic|tienda|comercio|repuesto|moto|mueble|aliment|panader|pasteler|restaur|ropa|moda|ferreter|vivero|florer/i;
const PRESENCIAL = /est[ée]tica|belleza|spa|peluquer|barber|gimnasio|fitness|cl[íi]nic|dental|m[ée]dic|kinesi|taller|mec[áa]nic|veterinar|abogad|jur[íi]dic|contab|notar|consultor/i;

export function materiaDe(c: ContextoComercial): Materia {
  const t = `${c.negocio.rubro} ${c.vende.map((v) => v.nombre).join(" ")}`;
  if (FISICO.test(t)) return "producto_fisico";
  if (PRESENCIAL.test(t)) return "servicio_presencial";
  return "intangible";
}

/** Lo que cada ángulo pide que se vea. Es la diferencia entre foto y relleno. */
const ESCENA_POR_ANGULO: Record<Angulo, string> = {
  problema: "el momento en que algo se está perdiendo: lo que queda a medias, vacío o sin atender",
  operativo: "las manos de alguien haciendo a mano una tarea repetitiva, con el desorden que eso deja",
  venta: "el punto donde el interesado se queda esperando y no avanza",
  velocidad: "el instante corto en que alguien todavía está decidiendo",
  capacidad: "el producto o el servicio haciendo exactamente aquello de lo que habla el anuncio",
  control: "una persona con la vista puesta en el conjunto, tranquila, con el mando",
  precio: "el producto solo, limpio, protagonista absoluto, con aire alrededor para poner la cifra",
  prueba: "el resultado ya conseguido, en su sitio y en uso",
  urgencia: "una señal de tiempo real en la escena, sin relojes de banco de imágenes",
  publico: "una persona reconociblemente de ese oficio, en su propio lugar de trabajo",
};

const AIRE_POR_FORMATO: Record<FormatoCreatividad, string> = {
  "1:1": "deja aire en el tercio superior para el titular",
  "4:5": "composición vertical, sujeto en el tercio inferior, aire arriba",
  "9:16": "vertical completa, sujeto centrado y bajo, mucho aire arriba para el texto de la historia",
  "16:9": "horizontal, sujeto a un lado y el otro lado despejado",
};

/**
 * Los negativos.
 *
 * Es la parte que más trabaja: casi todo el parecido entre anuncios de software
 * viene de los mismos cinco clichés, y nombrarlos explícitamente los saca.
 */
const NUNCA = [
  "ningún texto, ninguna palabra, ninguna letra dentro de la imagen",
  "ningún logotipo ni marca, ni del negocio ni de terceros",
  "ninguna interfaz, pantalla de aplicación, panel ni conversación de chat simulada",
  "ninguna persona genérica sonriendo a cámara con los brazos cruzados",
  "ninguna persona mirando un notebook en una oficina de banco de imágenes",
  "ningún gráfico con la flecha subiendo",
  "ningún robot, ningún cerebro luminoso, ninguna red neuronal dibujada",
  "ninguna marca de agua",
];

/** Lo que se le manda al generador de imágenes. */
export function promptDeImagen(
  c: ContextoComercial,
  d: DireccionVisual | null,
  angulo: Angulo,
  formato: FormatoCreatividad,
  producto: string,
): string {
  const materia = materiaDe(c);
  const sujeto =
    d?.sujeto ||
    (materia === "producto_fisico"
      ? `${producto || c.vende[0]?.nombre || "el producto"} real, en el lugar donde se usa`
      : materia === "servicio_presencial"
        ? "el lugar de trabajo real donde se presta el servicio, sin gente posando"
        : "una escena de trabajo cotidiana del negocio al que va dirigido el anuncio");

  const partes = [
    `Fotografía documental publicitaria, ${formato}.`,
    `SUJETO: ${sujeto}.`,
    `QUÉ TIENE QUE CONTAR: ${d?.concepto || ESCENA_POR_ANGULO[angulo]}.`,
    d?.composicion ? `COMPOSICIÓN: ${d.composicion}.` : "",
    `ENCUADRE: ${AIRE_POR_FORMATO[formato]}.`,
    d?.foco ? `FOCO: ${d.foco}.` : "",
    `LUZ Y CARÁCTER: ${d?.sensacion || "luz natural, colores reales, sin saturar; se tiene que ver como una foto tomada, no como una ilustración"}.`,
    materia === "intangible"
      ? "No hay un objeto que fotografiar: la escena es del MUNDO del cliente, no del software."
      : "",
    `NUNCA: ${NUNCA.join("; ")}.`,
  ];
  return partes.filter(Boolean).join("\n");
}

/**
 * La misma decisión, dicha para una persona.
 *
 * Lo que se le mostraba antes era el prompt entero, así que la persona pasaba
 * de pensar en el concepto a corregir un texto técnico. Acá arriba va lo que
 * se va a ver; el prompt queda detrás de «ver instrucciones», para quien lo
 * quiera tocar.
 */
export function direccionEnPalabras(
  c: ContextoComercial,
  d: DireccionVisual | null,
  angulo: Angulo,
  producto: string,
): string {
  const materia = materiaDe(c);
  const sujeto =
    d?.sujeto || (materia === "producto_fisico" ? producto || c.vende[0]?.nombre || "el producto" : "el mundo del cliente");
  const idea = d?.concepto || ESCENA_POR_ANGULO[angulo];
  const feel = d?.sensacion || "luz natural, sin montaje";
  return `Se ve ${sujeto}. La foto tiene que contar ${idea}. ${feel[0].toUpperCase()}${feel.slice(1)}. Sin texto ni logos dentro de la imagen: eso va después, en el editor.`;
}
