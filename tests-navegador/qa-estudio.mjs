/**
 * QA DE CALIDAD DEL ESTUDIO CREATIVO — los tres negocios, con contexto real.
 *
 * No es una prueba unitaria: llama al modelo de verdad y cuesta plata. Se corre
 * a mano cuando se toca el pipeline de copy, y su salida es la evidencia de que
 * el anuncio mejoró — no la afirmación de que mejoró.
 *
 *   node tests-navegador/qa-estudio.mjs            los tres
 *   node tests-navegador/qa-estudio.mjs respondo   uno solo
 *
 * ⚠️ Respondo e Impresora usan su CONOCIMIENTO REAL de la base. AyP todavía no
 * es cliente de la plataforma, así que sus fichas se arman acá con el contenido
 * público de su propio sitio (ayp-abogados.cl) y pasan por el MISMO
 * clasificador y el MISMO extractor. Es la única forma de probar un tercer tono
 * sin hardcodear un resultado.
 */
import { construirContexto } from "../lib/marketing/contextoComercial.ts";
import { ensamblarContexto, completitud } from "../lib/marketing/contextoComercialCore.ts";
import { clasificarFichas } from "../lib/marketing/rolesConocimiento.ts";
import { generarCopy } from "../lib/marketing/copy.ts";
import { solapamiento } from "../lib/marketing/copyCore.ts";

/* ── AyP: fichas armadas con el contenido público de su sitio ─────────────── */
const FICHAS_AYP = [
  {
    categoria: "servicios",
    titulo: "Qué hacemos",
    contenido:
      "A&P Asociados entrega asesoría y representación jurídica para personas y empresas. Áreas: derecho penal, derecho de familia, derecho laboral, derecho civil, derecho comercial, derecho inmobiliario, cobranza de deudas y sucesiones y herencias.",
  },
  {
    categoria: "precios",
    titulo: "Valor de la primera consulta",
    contenido:
      "La consulta inicial tiene un valor de $30.000, que se descuenta de los honorarios si el cliente decide contratar el servicio.",
  },
  {
    categoria: "politicas",
    titulo: "Experiencia del estudio",
    contenido: "Estudio jurídico con más de cuatro años de ejercicio, atendiendo a personas y empresas.",
  },
  {
    categoria: "horarios",
    titulo: "Ubicación y contacto",
    contenido:
      "Calle 18 de Septiembre 246, Edificio Centro Urbano 18S, oficina 408. Contacto por correo a gestionesjuridicas.ayp@gmail.com y por el formulario del sitio. El WhatsApp está anunciado como disponible próximamente, todavía no opera.",
  },
  {
    categoria: "vocabulario",
    titulo: "Cómo nos presentamos",
    contenido:
      "Nos presentamos con compromiso, ética, transparencia, confidencialidad y comunicación clara. No prometemos resultados judiciales. Tratamos de usted. Sin emojis.",
  },
];

const CASOS = {
  respondo: {
    clienteId: "77777777-7777-7777-7777-777777777777",
    pedido: {
      objetivo: "conversaciones",
      producto: "",
      oferta: "",
      destino: "una llamada de 30 minutos agendada desde el sitio",
      plataforma: "meta",
      formato: "cuadrado (feed de Facebook e Instagram)",
    },
  },
  impresora: {
    clienteId: "33333333-3333-3333-3333-333333333333",
    pedido: {
      objetivo: "cotizaciones",
      producto: "",
      oferta: "",
      destino: "WhatsApp del local",
      plataforma: "meta",
      formato: "cuadrado (feed de Facebook e Instagram)",
    },
  },
  ayp: {
    fichas: FICHAS_AYP,
    nombre: "A&P Asociados",
    rubro: "servicios jurídicos · estudio de abogados",
    pedido: {
      objetivo: "conversaciones",
      producto: "",
      oferta: "",
      destino: "el formulario de contacto del sitio",
      plataforma: "meta",
      formato: "cuadrado (feed de Facebook e Instagram)",
    },
  },
};

async function contextoDe(nombre, caso) {
  if (caso.clienteId) return construirContexto(caso.clienteId);
  // AyP: mismo ensamblado, mismo clasificador, sin extractor de modelo
  // (sus fichas ya vienen una por concepto, no hay catálogo que minar).
  return ensamblarContexto({
    nombre: caso.nombre,
    rubro: caso.rubro,
    zona: null,
    sitio: "ayp-abogados.cl",
    fichas: clasificarFichas(caso.fichas),
    vocabularioCliente: [],
    extraccion: {
      entidades: [
        { nombre: "Derecho de familia", tipo: "servicio", detalle: "Asesoría y representación en materias de familia.", precio: null },
        { nombre: "Derecho laboral", tipo: "servicio", detalle: "Asesoría y representación laboral para personas y empresas.", precio: null },
        { nombre: "Cobranza de deudas", tipo: "servicio", detalle: "Gestión y cobranza judicial y extrajudicial.", precio: null },
        { nombre: "Sucesiones y herencias", tipo: "servicio", detalle: "Tramitación de posesión efectiva y particiones.", precio: null },
        { nombre: "Derecho penal", tipo: "servicio", detalle: "Defensa y querellas.", precio: null },
        { nombre: "Primera consulta", tipo: "servicio", detalle: "Consulta inicial, se descuenta de los honorarios si se contrata.", precio: "$30.000" },
      ],
      problema: "Una persona o una empresa tiene un asunto legal y no sabe qué corresponde hacer ni cuánto le va a costar.",
      resultado: "Saber qué opciones tiene y quién lo va a representar.",
      audiencia: "Personas y empresas con un asunto legal en curso o por iniciar.",
      diferenciadores: ["Atiende a personas y a empresas", "La primera consulta se descuenta de los honorarios"],
    },
  });
}

function mostrar(p) {
  if (p.plataforma === "google") {
    console.log(`  titulares:    ${p.titulares.map((t) => `«${t}»`).join(" ")}`);
    console.log(`  descripciones:${p.descripciones.map((t) => `\n    «${t}»`).join("")}`);
    return;
  }
  const v = (x, i) => {
    console.log(`\n  ${i === 0 ? "PRINCIPAL" : `VARIANTE ${i}`}  [ángulo: ${x.angulo}]`);
    if (x.gancho) console.log(`    gancho:  ${x.gancho}`);
    console.log(`    titular: ${x.titular}   (${x.titular.length}/40)`);
    console.log(`    texto:   ${x.texto}`);
    console.log(`    cta:     ${x.cta}`);
  };
  [p.principal, ...p.variantes].forEach(v);
}

async function main() {
  const pedidos = process.argv.slice(2).filter((a) => CASOS[a]);
  const nombres = pedidos.length ? pedidos : Object.keys(CASOS);
  const salidas = {};

  for (const nombre of nombres) {
    const caso = CASOS[nombre];
    console.log(`\n${"═".repeat(74)}\n${nombre.toUpperCase()}\n${"═".repeat(74)}`);
    const c = await contextoDe(nombre, caso);
    const k = completitud(c);
    console.log(`voz: ${c.voz.formalidad}/${c.voz.energia}/${c.voz.afirmacion}/emojis:${c.voz.emojis} (${c.voz.origen})`);
    console.log(`sabemos: ${k.sabemos.join(" · ") || "—"}`);
    console.log(`faltan:  ${k.faltan.join(" · ") || "—"}`);

    const r = await generarCopy(caso.clienteId ?? "qa", caso.pedido, { contexto: c });
    if (!r.ok) {
      console.log(`\n  ✗ NO GENERÓ: ${r.motivo}${r.faltaContexto ? ` (${r.faltaContexto})` : ""}`);
      continue;
    }
    const e = r.paquete.estrategia;
    console.log(`\n  ESTRATEGIA`);
    console.log(`    audiencia: ${e.audiencia}`);
    console.log(`    situación: ${e.situacion}`);
    console.log(`    necesidad: ${e.necesidad}`);
    console.log(`    ángulo:    ${e.angulo}`);
    console.log(`    promesa:   ${e.promesa}`);
    console.log(`    prueba:    ${e.prueba ?? "ninguna (no se afirma ningún resultado)"}`);
    mostrar(r.paquete);
    console.log(
      `\n  revisión: ${r.revision.aprobado ? "aprobado" : "CON DEFECTOS"}` +
        `  ·  ${r.traza.llamadas} llamada(s), ${r.traza.ms} ms, ${r.traza.reescrito ? "reescrito" : "sin reescritura"}` +
        `  ·  defectos iniciales: ${r.traza.defectosIniciales}`,
    );
    for (const d of r.revision.defectos) console.log(`     ${d.grave ? "✗" : "·"} ${d.texto}`);
    salidas[nombre] = r.paquete;
  }

  /* ── ¿Se pueden intercambiar las marcas? ─────────────────────────────── */
  const ns = Object.keys(salidas).filter((n) => salidas[n].plataforma === "meta");
  if (ns.length > 1) {
    console.log(`\n${"═".repeat(74)}\nPRUEBA DE INTERCAMBIO DE MARCAS\n${"═".repeat(74)}`);
    let peor = 0;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = salidas[ns[i]].principal;
        const b = salidas[ns[j]].principal;
        const s = solapamiento(`${a.titular} ${a.texto}`, `${b.titular} ${b.texto}`);
        peor = Math.max(peor, s);
        console.log(`  ${ns[i]} vs ${ns[j]}: ${Math.round(s * 100)}% de palabras en común`);
      }
    }
    console.log(peor > 0.35 ? `\n  ✗ demasiado parecidos: ${Math.round(peor * 100)}%` : `\n  ✓ los anuncios no son intercambiables`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
