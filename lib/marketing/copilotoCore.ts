import type { Panorama } from "@/lib/marketing/tipos";

/**
 * NÚCLEO PURO DEL COPILOTO — herramientas deterministas y prompt.
 *
 * LA ARQUITECTURA, EN UNA LÍNEA: el modelo NUNCA ve la base ni calcula una
 * cifra. Ve el resultado de HERRAMIENTAS que corren sobre el `Panorama` ya
 * cargado —el mismo que dibujan las pantallas— y su trabajo es interpretar,
 * comparar y recomendar con evidencia. Si una herramienta devuelve poco, el
 * modelo tiene la instrucción de decirlo, no de rellenar.
 *
 * Cada herramienta devuelve texto compacto y ya formateado: el modelo no
 * necesita aritmética, necesita criterio.
 */

const pesos = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

export type Herramienta = {
  nombre: string;
  descripcion: string;
  correr: (p: Panorama) => string;
};

export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: "resumenDelPeriodo",
    descripcion: "Las métricas del período con su certeza y la variación contra el período anterior.",
    correr: (p) => {
      const L: string[] = [`Período: ${p.rango.etiqueta} (${p.rango.desde} a ${p.rango.hasta}). Meta ${p.metaConectada ? "conectada" : "NO conectada"}.`];
      for (const g of p.metricas) {
        for (const m of g.metricas) {
          if (m.certeza === "no_disponible") {
            L.push(`  ${m.etiqueta}: no disponible (${m.motivo ?? "sin dato"})`);
            continue;
          }
          const v = m.monto ? pesos(m.monto.valor) : m.clave === "ctr" || m.clave === "conversion" ? pct(m.valor) : m.clave === "roas" ? `${m.valor?.toFixed(2)}×` : String(m.valor);
          const antes = m.antes === null || m.antes === undefined ? "" : ` (antes: ${m.monto ? pesos(m.antes) : m.clave === "ctr" || m.clave === "conversion" ? pct(m.antes) : m.antes})`;
          L.push(`  ${m.etiqueta}: ${v}${antes} [${m.certeza}]`);
        }
      }
      return L.join("\n");
    },
  },
  {
    nombre: "embudo",
    descripcion: "Los escalones del embudo anuncio → conversación → calificado → cotización/reserva → venta, con tasas.",
    correr: (p) =>
      p.embudo
        .map((e) => `  ${e.etiqueta}: ${e.valor === null ? "no disponible" : e.valor}${e.tasa === null ? "" : ` (${pct(e.tasa)} del anterior)`}`)
        .join("\n"),
  },
  {
    nombre: "rendimientoPorCampana",
    descripcion: "Cada campaña con gasto, conversaciones, calificados, ventas, cobrado, costo por conversación, costo por venta y retorno.",
    correr: (p) => {
      const activas = p.campanas.filter((c) => c.origen !== "borrador");
      if (!activas.length) return "  (sin campañas con datos en el período)";
      return activas
        .map(
          (c) =>
            `  «${c.nombre}» [${c.estado}${c.origen === "atribucion" ? ", solo atribución" : ""}]: gasto ${pesos(c.gasto)} · ${c.conversaciones} conv · ${c.calificados} calif · ${c.avanzados} cotiz/reservas · ${c.ventas} ventas · cobrado ${pesos(c.cobrado)} · CPC ${pesos(c.cpc)} · CPV ${pesos(c.cpv)} · ROAS ${c.roas === null ? "—" : c.roas.toFixed(2) + "×"} · ${c.anuncios} anuncios`,
        )
        .join("\n");
    },
  },
  {
    nombre: "rendimientoPorAnuncio",
    descripcion: "Cada anuncio con su campaña y sus cifras. Sirve para saber cuál probar de nuevo o cuál apagar.",
    correr: (p) => {
      if (!p.anuncios.length) return "  (sin anuncios con conversaciones en el período)";
      return p.anuncios
        .slice(0, 20)
        .map(
          (a) =>
            `  «${a.titular}» (${a.campanaNombre}): gasto ${pesos(a.gasto)} · ${a.conversaciones} conv · ${a.calificados} calif · ${a.cotizaciones} cotiz · ${a.agendadas} reservas · ${a.ventas} ventas · cobrado ${pesos(a.cobrado)}`,
        )
        .join("\n");
    },
  },
  {
    nombre: "calidadDeLeads",
    descripcion: "Cómo se reparten los leads por etapa y qué anuncios traen leads que no avanzan.",
    correr: (p) => {
      const total = p.leads.length;
      if (!total) return "  (sin leads atribuidos en el período)";
      const por = (f: (l: (typeof p.leads)[number]) => boolean) => p.leads.filter(f).length;
      const L = [
        `  Total ${total}: ${por((l) => l.etapa === "nuevo")} sin avanzar · ${por((l) => l.etapa === "interesado")} interesados · ${por((l) => l.etapa === "cotizado")} cotizados · ${por((l) => l.etapa === "ganado")} compraron · ${por((l) => l.etapa === "perdido")} perdidos`,
        `  Calificados: ${por((l) => l.calificado)} (${pct((por((l) => l.calificado) / total) * 100)})`,
      ];
      const porAnuncio = new Map<string, { t: number; c: number; v: number }>();
      for (const l of p.leads) {
        const a = porAnuncio.get(l.anuncioTitular) ?? { t: 0, c: 0, v: 0 };
        a.t += 1;
        if (l.calificado) a.c += 1;
        if (l.compro) a.v += 1;
        porAnuncio.set(l.anuncioTitular, a);
      }
      const peores = [...porAnuncio.entries()]
        .filter(([, a]) => a.t >= 5)
        .sort((x, y) => x[1].c / x[1].t - y[1].c / y[1].t)
        .slice(0, 3);
      if (peores.length) {
        L.push("  Anuncios con peor calificación (≥5 conversaciones):");
        for (const [t, a] of peores) L.push(`    «${t}»: ${a.c} de ${a.t} calificados, ${a.v} ventas`);
      }
      return L.join("\n");
    },
  },
  {
    nombre: "tendenciaSemanal",
    descripcion: "Comparación de la última semana contra la anterior en gasto, conversaciones, calificados y ventas.",
    correr: (p) => {
      const s = p.serie;
      if (s.length < 14) return `  (el período tiene ${s.length} días; hacen falta 14 para comparar semanas)`;
      const ult = s.slice(-7);
      const ant = s.slice(-14, -7);
      const sum = (xs: typeof s, k: keyof (typeof s)[number]) => xs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
      const linea = (k: keyof (typeof s)[number], nombre: string, plata = false) => {
        const a = sum(ult, k);
        const b = sum(ant, k);
        const f = plata ? pesos : (n: number) => String(n);
        const var_ = b ? ` (${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%)` : "";
        return `  ${nombre}: ${f(a)} esta semana vs ${f(b)} la anterior${var_}`;
      };
      return [
        p.metaConectada ? linea("gasto", "Gasto", true) : "  Gasto: no disponible (sin Meta)",
        linea("conversaciones", "Conversaciones"),
        linea("calificados", "Calificados"),
        linea("ventas", "Ventas"),
        linea("cobrado", "Cobrado", true),
      ].join("\n");
    },
  },
  {
    nombre: "hallazgosAutomaticos",
    descripcion: "Los hallazgos deterministas que el sistema ya detectó, con su evidencia.",
    correr: (p) =>
      p.hallazgos.length
        ? p.hallazgos.map((h) => `  [${h.tono}] ${h.titulo} — ${h.evidencia}`).join("\n")
        : "  (ninguno: no hay volumen suficiente para afirmar nada todavía)",
  },
  {
    nombre: "creatividades",
    descripcion: "Las creatividades del estudio, su estado y su rendimiento cuando lo hay.",
    correr: (p) =>
      p.creatividades.length
        ? p.creatividades
            .map(
              (c) =>
                `  «${c.nombre}» [${c.estado}] ${c.formato} · titular «${c.titular}»${c.rendimiento ? ` · ${c.rendimiento.conversaciones} conv, ${c.rendimiento.ventas} ventas, gasto ${pesos(c.rendimiento.gasto)}` : " · sin datos de rendimiento"}`,
            )
            .join("\n")
        : "  (no hay creatividades todavía)",
  },
  {
    nombre: "estadoDeConfiguracion",
    descripcion: "Qué integraciones están listas y qué falta.",
    correr: (p) => p.estado.items.map((i) => `  [${i.estado}] ${i.titulo}: ${i.detalle}`).join("\n"),
  },
];

export const PREGUNTAS_SUGERIDAS = [
  "¿Qué campaña me está trayendo mejores clientes?",
  "¿Dónde estoy perdiendo plata?",
  "¿Qué cambió esta semana?",
  "¿Qué anuncio debería probar de nuevo?",
  "¿Qué creatividad está funcionando mejor?",
  "Créame una campaña para vender más este mes",
];

export type TurnoCopiloto = { pregunta: string; respuesta: string };

export type RespuestaCopiloto = {
  respuesta: string;
  evidencia: { texto: string; href?: string }[];
  acciones: { texto: string; href: string }[];
  herramientasUsadas: string[];
  /** Cuando la persona pidió crear una campaña: el borrador propuesto. */
  borrador?: {
    nombre: string;
    objetivo: string;
    oferta: string;
    audiencia: { ubicacion: string; edadDesde: number | null; edadHasta: number | null; intereses: string[]; nota: string };
    presupuestoDiario: number | null;
    copies: { titular: string; texto: string; cta: string }[];
    creatividad: { concepto: string; imagenPrompt: string };
  } | null;
  /** true cuando el modelo dijo que no alcanza el dato. */
  sinDatos: boolean;
};

export function promptCopiloto(entrada: {
  pregunta: string;
  panorama: Panorama;
  contextoMarca: string;
  hilo: TurnoCopiloto[];
}): string {
  const { pregunta, panorama, contextoMarca, hilo } = entrada;
  const resultados = HERRAMIENTAS.map((h) => `▸ ${h.nombre} — ${h.descripcion}\n${h.correr(panorama)}`).join("\n\n");
  const hiloTexto = hilo
    .slice(-3)
    .map((t) => `Persona: ${t.pregunta}\nCopiloto: ${t.respuesta}`)
    .join("\n\n");

  return `Eres el copiloto de marketing de una pyme chilena dentro de Respondo. Tu trabajo es ayudar al dueño a entender qué anuncios le traen clientes y a crear la próxima campaña mejor que la anterior.

${contextoMarca}

RESULTADOS DE LAS HERRAMIENTAS (datos deterministas del período; son la ÚNICA fuente de cifras)
${resultados}

${hiloTexto ? `CONVERSACIÓN PREVIA\n${hiloTexto}\n` : ""}
PREGUNTA DE LA PERSONA
${pregunta}

REGLAS
1. Cada afirmación con número tiene que salir de las herramientas de arriba. No calcules cifras nuevas ni las estimes. Si el dato no está o el volumen es chico (menos de ~8 conversaciones o ~3 ventas en lo que se compara), dilo con esas palabras: «con este volumen no se puede concluir».
2. Habla en español de Chile, directo, como un asesor que respeta el tiempo del dueño. Sin listas de diez puntos: la conclusión primero, después la evidencia, después qué haría.
3. «Calificado» significa que la conversación avanzó a interesado o más, o cotizó, reservó o compró. Úsalo así.
4. Cuando compares campañas o anuncios, nombra el mejor y el peor con sus cifras exactas.
5. Si la persona pide CREAR una campaña, arma un borrador completo con la información del negocio: objetivo, oferta concreta (con precio si el contexto lo tiene), audiencia razonable (ubicación de la zona del negocio, edad, 2-4 intereses), presupuesto diario sugerido (entre $2.000 y $10.000 salvo que el gasto actual indique otra escala), DOS copies (titular ≤40 caracteres, texto ≤300, CTA de: Enviar mensaje · Cotizar por WhatsApp · Escribir ahora · Pedir información · Reservar · Comprar) y una descripción de imagen. No inventes precios que no estén en el contexto.
6. Recomienda rutas concretas del producto cuando corresponda: /marketing/campanas, /marketing/campanas/{id}, /marketing/atribucion, /marketing/leads, /marketing/creatividades, /marketing/campanas/nueva, /marketing/integraciones. Las "acciones" son enlaces para VER una pantalla («Ver campaña X», «Ver personas»): Respondo no activa, pausa ni publica campañas en Meta, así que nunca escribas una acción que prometa eso; si conviene reactivar o pausar algo, dilo en la respuesta como recomendación para hacer en Meta.

Responde SOLO con JSON:
{
  "respuesta": "texto para la persona (párrafos cortos; puedes usar saltos de línea)",
  "evidencia": [ { "texto": "cifra o hecho exacto que sostiene la respuesta", "href": "/marketing/... (opcional)" } ],
  "acciones": [ { "texto": "Ver campaña X", "href": "/marketing/campanas/..." } ],
  "herramientasUsadas": ["resumenDelPeriodo", "..."],
  "sinDatos": false,
  "borrador": null
}
Si la persona pidió crear una campaña, "borrador" lleva:
{ "nombre": "...", "objetivo": "conversaciones|reservas|cotizaciones|ventas", "oferta": "...", "audiencia": { "ubicacion": "...", "edadDesde": 25, "edadHasta": 55, "intereses": ["..."], "nota": "..." }, "presupuestoDiario": 5000, "copies": [ { "titular": "...", "texto": "...", "cta": "..." }, { ... } ], "creatividad": { "concepto": "...", "imagenPrompt": "..." } }`;
}

export function parsearRespuestaCopiloto(crudo: string): RespuestaCopiloto | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    const m = crudo.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const respuesta = String(obj.respuesta ?? "").trim();
  if (!respuesta) return null;

  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  const rutaOk = (h: unknown) => typeof h === "string" && /^\/(marketing|conversaciones|clientes)/.test(h);

  const b = obj.borrador as Record<string, unknown> | null | undefined;
  const borrador = b && typeof b === "object" && b.nombre
    ? {
        nombre: String(b.nombre).slice(0, 100),
        objetivo: ["conversaciones", "reservas", "cotizaciones", "ventas"].includes(String(b.objetivo)) ? String(b.objetivo) : "conversaciones",
        oferta: String(b.oferta ?? "").slice(0, 500),
        audiencia: (() => {
          const a = (b.audiencia ?? {}) as Record<string, unknown>;
          return {
            ubicacion: String(a.ubicacion ?? ""),
            edadDesde: typeof a.edadDesde === "number" ? a.edadDesde : null,
            edadHasta: typeof a.edadHasta === "number" ? a.edadHasta : null,
            intereses: lista(a.intereses).map(String).slice(0, 6),
            nota: String(a.nota ?? ""),
          };
        })(),
        presupuestoDiario: typeof b.presupuestoDiario === "number" ? Math.round(b.presupuestoDiario) : null,
        copies: lista(b.copies)
          .map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            return { titular: String(o.titular ?? "").slice(0, 60), texto: String(o.texto ?? "").slice(0, 400), cta: String(o.cta ?? "Enviar mensaje") };
          })
          .filter((c) => c.titular && c.texto)
          .slice(0, 3),
        creatividad: (() => {
          const c = (b.creatividad ?? {}) as Record<string, unknown>;
          return { concepto: String(c.concepto ?? ""), imagenPrompt: String(c.imagenPrompt ?? "") };
        })(),
      }
    : null;

  return {
    respuesta,
    evidencia: lista(obj.evidencia)
      .map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return { texto: String(o.texto ?? ""), href: rutaOk(o.href) ? String(o.href) : undefined };
      })
      .filter((e) => e.texto)
      .slice(0, 6),
    acciones: lista(obj.acciones)
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        return { texto: String(o.texto ?? ""), href: rutaOk(o.href) ? String(o.href) : "" };
      })
      .filter((a) => a.texto && a.href)
      .slice(0, 4),
    herramientasUsadas: lista(obj.herramientasUsadas).map(String).filter((n) => HERRAMIENTAS.some((h) => h.nombre === n)),
    borrador,
    sinDatos: Boolean(obj.sinDatos),
  };
}
