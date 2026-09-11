import { db } from "@/lib/db";
import { listarFichas } from "@/lib/conocimiento";
import { saberDelNegocio } from "@/lib/isabel";
import { saberEnTexto, type HechoSabido } from "@/lib/isabelCore";
import { NEGOCIO_DEMO } from "@/lib/marketing/demo";
import { exigirId } from "@/lib/marketing/tenant";

/**
 * LO QUE RESPONDO YA SABE DEL NEGOCIO, PUESTO AL SERVICIO DEL MARKETING.
 *
 * Esta es la ventaja que ningún generador de anuncios genérico tiene: no le
 * pedimos al dueño que describa su empresa desde cero. Ya la conocemos por
 * tres vías, y las tres se juntan acá:
 *
 *   1. La ficha del negocio (`ed_clientes`): nombre, rubro, cómo se presenta.
 *   2. El conocimiento que alimenta a los empleados IA (`ed_conocimiento`):
 *      servicios, precios, horarios, políticas — lo que Tino contesta.
 *   3. ⭐ El saber destilado de las conversaciones (`ed_isabel_saber`): con qué
 *      palabras la gente PIDE las cosas, qué objeta, qué precios circulan. Es
 *      lo que hace que un anuncio hable como hablan los clientes reales y no
 *      como habla un redactor.
 *
 * Se usa para generar creatividades, para sugerir la oferta en el asistente de
 * campañas y como contexto del copiloto. Un solo módulo, una sola verdad.
 */

export type ContextoMarca = {
  nombre: string;
  rubro: string;
  /** Qué vende, en una línea, cuando se pudo inferir. */
  descripcion: string;
  /** Servicios/productos nombrados en el conocimiento, con precio si lo hay. */
  ofertas: { titulo: string; detalle: string }[];
  /** Cómo se llaman las cosas en boca de los clientes. */
  saber: HechoSabido[];
  /** El mismo saber, listo para pegar en un prompt. */
  saberTexto: string;
  /** Número de WhatsApp del negocio (destino de los anuncios). */
  whatsapp: string | null;
  /** Ciudad/zona si aparece en el conocimiento. */
  zona: string | null;
  demo: boolean;
};

/**
 * Separa del conocimiento lo que parece un servicio o producto vendible: las
 * fichas de categorías «servicios», «productos», «precios» o cuyo título trae
 * un precio. Es heurístico a propósito: el generador lo usa como SUGERENCIA
 * y la persona siempre puede escribir otra cosa.
 */
function ofertasDesde(fichas: { categoria: string; titulo: string; contenido: string }[]) {
  const CATS = /servicio|producto|precio|catalogo|catálogo|oferta|promo/i;
  return fichas
    .filter((f) => CATS.test(f.categoria) || CATS.test(f.titulo) || /\$\s?\d/.test(f.contenido))
    .slice(0, 12)
    .map((f) => ({
      titulo: f.titulo.trim(),
      detalle: f.contenido.replace(/\s+/g, " ").trim().slice(0, 240),
    }));
}

function zonaDesde(fichas: { categoria: string; titulo: string; contenido: string }[]): string | null {
  const texto = fichas
    .filter((f) => /ubicaci|direcci|contacto|donde|dónde/i.test(f.categoria + " " + f.titulo))
    .map((f) => f.contenido)
    .join(" ");
  const m = texto.match(/\b(Santiago|Chillán|Concepción|Valparaíso|Viña del Mar|Temuco|Antofagasta|La Serena|Rancagua|Talca|Puerto Montt|Los Ángeles|Iquique|Arica|Osorno|Valdivia|Curicó|Quillota|Copiapó|Punta Arenas)\b/i);
  return m ? m[1] : null;
}

export async function contextoDeMarca(clienteId: string, demo = false): Promise<ContextoMarca> {
  exigirId(clienteId);
  if (demo) {
    return {
      nombre: NEGOCIO_DEMO.nombre,
      rubro: NEGOCIO_DEMO.rubro,
      descripcion: "Imprenta en Chillán: pendones, gigantografías, tarjetas, poleras sublimadas y stickers, con entrega express.",
      ofertas: [
        { titulo: "Pendón roller 80×200", detalle: "Desde $34.990, listo en 24 horas. Diseño incluido con logo del cliente." },
        { titulo: "Tarjetas de presentación", detalle: "1.000 unidades desde $19.990. Papel couché 350 g, mate o brillante." },
        { titulo: "Gigantografía PVC", detalle: "Por m², instalación incluida en Chillán. Resistente al agua." },
        { titulo: "Poleras sublimadas", detalle: "Desde 10 unidades, full color, entrega en 5 días hábiles." },
        { titulo: "Stickers troquelados", detalle: "100 unidades desde $8.990, vinilo resistente al agua." },
      ],
      saber: [
        { tipo: "piden", clave: "pendon para feria", texto: "Piden «pendón» o «roller» para ferias y eventos; casi siempre con apuro (para el fin de semana).", veces: 14 },
        { tipo: "piden", clave: "tarjetas con diseno", texto: "Preguntan si el diseño está incluido antes que el precio.", veces: 9 },
        { tipo: "objecion", clave: "plazo de entrega", texto: "La objeción más común es el plazo, no el precio: «¿alcanza para el sábado?».", veces: 11 },
        { tipo: "objecion", clave: "precio poleras", texto: "En poleras comparan con AliExpress y se van si no hay mínimo bajo.", veces: 6 },
        { tipo: "precio", clave: "pendon 34990", texto: "Pendón estándar cotizado a $34.990 en la mayoría de los casos.", veces: 12 },
        { tipo: "costumbre", clave: "retiro en local", texto: "La mayoría retira en el local; el despacho lo piden solo desde fuera de Chillán.", veces: 8 },
      ],
      saberTexto: "",
      whatsapp: "+56 9 1234 5678",
      zona: "Chillán",
      demo: true,
    };
  }

  const [cliente, fichas, saber] = await Promise.all([
    db()
      .from("ed_clientes")
      // ⚠️ Solo columnas que existen: PostgREST rechaza el select ENTERO si
      // una no existe (trampa documentada en la memoria del proyecto).
      .select("nombre, rubro, waba_phone_id")
      .eq("id", clienteId)
      .maybeSingle()
      .then((r) => r.data as Record<string, unknown> | null),
    listarFichas(clienteId).catch(() => []),
    saberDelNegocio(clienteId, 40).catch(() => [] as HechoSabido[]),
  ]);

  const vigentes = fichas.filter((f) => f.vigente);
  const descripcion =
    vigentes.find((f) => /negocio|empresa|quienes|quiénes|sobre/i.test(f.categoria + " " + f.titulo))
      ?.contenido.replace(/\s+/g, " ")
      .slice(0, 300) ?? "";

  return {
    nombre: String(cliente?.nombre ?? "Tu negocio"),
    rubro: String(cliente?.rubro ?? ""),
    descripcion,
    ofertas: ofertasDesde(vigentes),
    saber,
    saberTexto: saberEnTexto(saber),
    // El número visible no está guardado (solo el id de Meta); el asistente de
    // campañas muestra el estado de la conexión en vez de un número.
    whatsapp: cliente?.waba_phone_id ? "WhatsApp conectado" : null,
    zona: zonaDesde(vigentes),
    demo: false,
  };
}

/** El contexto en texto plano, para los prompts. Omite lo vacío. */
export function contextoEnTexto(c: ContextoMarca): string {
  const partes = [`NEGOCIO: ${c.nombre}${c.rubro ? ` (${c.rubro})` : ""}${c.zona ? ` · ${c.zona}` : ""}`];
  if (c.descripcion) partes.push(`QUÉ HACE: ${c.descripcion}`);
  if (c.ofertas.length) {
    partes.push("LO QUE VENDE:");
    for (const o of c.ofertas) partes.push(`  · ${o.titulo}: ${o.detalle}`);
  }
  const saber = c.saberTexto || saberEnTexto(c.saber);
  if (saber) partes.push(saber);
  return partes.join("\n");
}
