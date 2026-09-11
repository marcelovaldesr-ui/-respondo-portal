import type { FormatoCreatividad, PlataformaCreatividad } from "@/lib/marketing/tipos";

/**
 * ARRANQUES DEL ESTUDIO CREATIVO.
 *
 * No son botones decorativos: cada uno precarga el brief del generador con un
 * objetivo, un formato, una plataforma y unas indicaciones concretas, y desde
 * ahí corre EXACTAMENTE el mismo motor que el brief en blanco. Es la
 * diferencia entre una plantilla real y una promesa.
 *
 * Se eligieron los seis arranques que una pyme chilena usa de verdad. Ninguno
 * inventa datos: todos siguen tomando el producto, el precio y las palabras
 * del contexto del negocio, y si el contexto no tiene precio, el anuncio no
 * lo menciona.
 */
export type PlantillaCreativa = {
  clave: string;
  titulo: string;
  texto: string;
  icono: "producto" | "oferta" | "historia" | "testimonio" | "promo" | "whatsapp";
  objetivo: string;
  formato: FormatoCreatividad;
  plataforma: PlataformaCreatividad;
  indicaciones: string;
};

export const PLANTILLAS_CREATIVAS: PlantillaCreativa[] = [
  {
    clave: "producto",
    titulo: "Anuncio de producto",
    texto: "El más vendible, con su precio",
    icono: "producto",
    objetivo: "cotizaciones",
    formato: "1:1",
    plataforma: "ambas",
    indicaciones:
      "Anuncio de producto: muestra el producto en su contexto de uso real. Nombra el precio exacto solo si está en el contexto. Cierra pidiendo que escriban por WhatsApp.",
  },
  {
    clave: "oferta",
    titulo: "Oferta con plazo",
    texto: "Un gancho con fecha",
    icono: "oferta",
    objetivo: "ventas",
    formato: "1:1",
    plataforma: "ambas",
    indicaciones:
      "Oferta concreta con un plazo claro. La urgencia tiene que ser real y verificable (fin de mes, stock, temporada); no inventes descuentos que no estén en el contexto.",
  },
  {
    clave: "historia",
    titulo: "Historia 9:16",
    texto: "Para historias y reels",
    icono: "historia",
    objetivo: "conversaciones",
    formato: "9:16",
    plataforma: "instagram",
    indicaciones:
      "Formato historia a pantalla completa: el gancho tiene que funcionar en los primeros dos segundos y el texto ser muy breve, porque se lee de pie y con el pulgar encima.",
  },
  {
    clave: "testimonio",
    titulo: "Prueba social",
    texto: "Lo que ya resolviste a otros",
    icono: "testimonio",
    objetivo: "conversaciones",
    formato: "4:5",
    plataforma: "ambas",
    indicaciones:
      "Prueba social en primera persona del negocio, contando un caso típico que resolviste (tipo de cliente y qué necesitaba). NO inventes nombres de clientes ni cifras de satisfacción.",
  },
  {
    clave: "promo",
    titulo: "Temporada",
    texto: "Lo que se viene este mes",
    icono: "promo",
    objetivo: "cotizaciones",
    formato: "1:1",
    plataforma: "ambas",
    indicaciones:
      "Anuncio de temporada: conecta el producto con lo que está pasando este mes en Chile (fiestas, vuelta a clases, aniversarios, ferias) según lo que venda el negocio.",
  },
  {
    clave: "whatsapp",
    titulo: "Click-to-WhatsApp",
    texto: "Que escriban ahora",
    icono: "whatsapp",
    objetivo: "conversaciones",
    formato: "4:5",
    plataforma: "ambas",
    indicaciones:
      "El objetivo es una sola cosa: que aprieten el botón y escriban. Baja la barrera —di exactamente qué pasa al escribir y en cuánto respondes— y evita pedir datos en el anuncio.",
  },
];

export function plantillaPorClave(clave: string | null | undefined): PlantillaCreativa | null {
  if (!clave) return null;
  return PLANTILLAS_CREATIVAS.find((p) => p.clave === clave) ?? null;
}
