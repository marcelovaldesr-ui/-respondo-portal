import {
  costoPorResultado,
  ctr,
  cpm,
  sonComparables,
  type FilaRendimiento,
  type Proveedor,
} from "@/lib/ads/canal";

/**
 * EL MOTOR DE ANÁLISIS PUBLICITARIO — determinista, antes que cualquier modelo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DE DÓNDE SALE ESTO: de la skill `analista-google-ads`, que lleva meses
 * operando la cuenta real de Impresora Color. Lo que se trajo NO son sus
 * números —esos son de esa cuenta y no valen para nadie más— sino su MÉTODO:
 *
 *   ✓ universal   → los mínimos de evidencia, comparar períodos del mismo
 *                   largo, ordenar por plata, separar hecho de recomendación,
 *                   decir «no alcanza» como respuesta legítima.
 *   ✓ de Google   → términos vs palabras clave, conversiones «duras» y no
 *                   `all_conversions`, verificar que una negativa no ciegue una
 *                   palabra propia.
 *   ✗ de Impresora→ el CPA de ~1.900 CLP, el geo de Chillán, «no contesta el
 *                   teléfono», los ids de campaña. NADA de eso está acá: son
 *                   datos de un cliente, no reglas de producto.
 *   ✓ de proceso  → primero se verifica que la medición esté viva; recién
 *                   después se opina del rendimiento.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ LA DECISIÓN QUE MÁS IMPORTA: **nada de umbrales universales.** «CTR bajo
 * 2% es malo» es falso en la mitad de las cuentas —depende del rubro, del
 * objetivo, del formato y del país— y una recomendación construida sobre eso se
 * siente científica y está inventada. Acá se compara SIEMPRE contra algo del
 * propio negocio: su período anterior, o la mediana de sus campañas
 * comparables. Si no hay contra qué comparar, no hay hallazgo.
 *
 * ⭐ Y LA SEGUNDA: separar INSIGHT de RECOMENDACIÓN. «El costo por conversión
 * subió 34%» es un hecho que se sostiene solo. «Antes de subir presupuesto,
 * probaría una creatividad nueva» es un consejo que puede estar equivocado.
 * Mezclarlos hace que cuando el consejo falla, el dueño deje de creerle también
 * a los hechos.
 *
 * Puro y sin dependencias de ejecución: se prueba con Node pelado.
 */

/* ── Vocabulario ──────────────────────────────────────────────────────────── */

export type Confianza = "alta" | "media" | "baja";

/** Lo que se puede proponer. NO incluye ejecutar nada: Respondo no escribe. */
export type TipoAccion = "mantener" | "observar" | "probar" | "reducir" | "pausar" | "escalar" | "revisar";

export const ETIQUETA_ACCION: Record<TipoAccion, string> = {
  mantener: "Mantener",
  observar: "Observar",
  probar: "Probar",
  reducir: "Reducir",
  pausar: "Pausar",
  escalar: "Escalar",
  revisar: "Revisar",
};

export type Entidad = {
  proveedor: Proveedor;
  nivel: FilaRendimiento["nivel"];
  id: string;
  nombre: string;
};

/** Un HECHO con su evidencia. No propone nada. */
export type Insight = {
  clave: string;
  titulo: string;
  evidencia: string;
  tono: "alerta" | "oportunidad" | "neutro";
  /** Para ordenar: primero lo que cuesta plata. */
  prioridad: number;
  entidad?: Entidad;
};

/** Un CONSEJO, con todo lo que hace falta para poder discutirlo. */
export type Recomendacion = {
  clave: string;
  accion: TipoAccion;
  /** Qué hacer, en una línea. */
  que: string;
  /** Dónde hacerlo. Nombre humano, no un id. */
  donde: string;
  porQue: string;
  evidencia: string;
  /** Qué métricas y qué período se usaron. Para poder auditarlo. */
  datosUsados: string[];
  confianza: Confianza;
  /** Qué se pierde si la recomendación está equivocada. */
  riesgo: string;
  entidad: Entidad;
  /**
   * Plata en juego, para ordenar. No es una promesa de ahorro: es el gasto
   * que la recomendación toca, que es lo único que se puede afirmar.
   */
  plataEnJuego: number | null;
  moneda: string;
};

/** Lo que NO se pudo evaluar, y qué falta para poder hacerlo. */
export type DatoInsuficiente = {
  clave: string;
  que: string;
  queFalta: string;
};

export type Analisis = {
  insights: Insight[];
  recomendaciones: Recomendacion[];
  insuficientes: DatoInsuficiente[];
  /** true cuando NO hay nada que recomendar y eso es una respuesta válida. */
  nadaQueCambiar: boolean;
};

/* ── Mínimos de evidencia ─────────────────────────────────────────────────── */

/**
 * LOS MÍNIMOS. Bajarlos es empezar a inventar.
 *
 * ⚠️ Todos son en CANTIDADES, nunca en plata: un umbral de «8.000 pesos» —que
 * es el que usa la skill para la cuenta chilena— no significa nada en una
 * cuenta que factura en dólares, y nadie se acordaría de convertirlo. El
 * umbral de gasto se calcula abajo a partir de la propia cuenta.
 */
export const MINIMOS = {
  /** Clics de una entidad antes de poder decir que no funciona. */
  clics: 15,
  /** Impresiones antes de poder opinar del CTR. */
  impresiones: 1000,
  /** Resultados en CADA período para comparar costo por resultado. */
  resultadosParaComparar: 10,
  /** Resultados para decir que algo es consistentemente eficiente. */
  resultadosParaElogiar: 5,
  /** Campañas comparables para que una mediana signifique algo. */
  paresParaMediana: 3,
  /** Días del período para hablar de tendencia. */
  diasParaTendencia: 14,
  /** Frecuencia (Meta) desde la cual el desgaste es plausible. */
  frecuenciaAlta: 3,
} as const;

/**
 * El umbral de gasto sin resultado, DERIVADO de la propia cuenta.
 *
 * Tres veces lo que le cuesta a este negocio conseguir un resultado. Si todavía
 * no consiguió ninguno, diez veces su costo por clic. Si tampoco hay clics, no
 * hay umbral y no se afirma nada. Así el mismo código funciona en una cuenta
 * chilena de $150.000 al mes y en una en dólares, sin ninguna constante de
 * moneda escrita a mano.
 */
export function umbralGastoSinResultado(filas: FilaRendimiento[]): number | null {
  const conResultado = filas.filter((f) => (f.resultados?.cantidad ?? 0) > 0);
  const gastoTotal = filas.reduce((a, f) => a + f.gasto.valor, 0);
  const resultadosTotal = conResultado.reduce((a, f) => a + (f.resultados?.cantidad ?? 0), 0);
  if (resultadosTotal > 0) return (gastoTotal / resultadosTotal) * 3;
  const clics = filas.reduce((a, f) => a + f.clics, 0);
  if (clics > 0) return (gastoTotal / clics) * 10;
  return null;
}

/* ── Utilidades de comparación ────────────────────────────────────────────── */

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
const dec1 = (n: number) => n.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const entero = (n: number) => new Intl.NumberFormat("es-CL").format(Math.round(n));

/** Plata en el idioma del negocio, con su moneda cuando no es peso chileno. */
export function plata(valor: number, moneda: string): string {
  const n = entero(valor);
  return moneda.toUpperCase() === "CLP" ? `$${n}` : `${n} ${moneda.toUpperCase()}`;
}

export function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function variacion(ahora: number, antes: number): number | null {
  if (!antes) return null;
  return ((ahora - antes) / antes) * 100;
}

/**
 * ¿Estas dos campañas son comparables entre sí?
 *
 * Mismo proveedor, mismo objetivo declarado y —lo que más importa— el mismo
 * TIPO de resultado. Una campaña de mensajes y una de compras conviven en la
 * misma cuenta y comparar sus costos por resultado es comparar un almuerzo con
 * un auto.
 */
export function comparables(a: FilaRendimiento, b: FilaRendimiento): boolean {
  if (a.proveedor !== b.proveedor) return false;
  if ((a.objetivo ?? "") !== (b.objetivo ?? "")) return false;
  if (!a.resultados && !b.resultados) return true;
  return sonComparables(a.resultados, b.resultados);
}

/* ── El análisis ──────────────────────────────────────────────────────────── */

export type ContextoAnalisis = {
  /** Filas del período, de todos los canales, en cualquier nivel. */
  filas: FilaRendimiento[];
  /** Las mismas del período anterior de IGUAL largo. */
  filasAntes: FilaRendimiento[];
  /** Etiqueta del período para escribirla en la evidencia. */
  periodo: string;
  /** Días del período, para saber si se puede hablar de tendencia. */
  dias: number;
};

const idDe = (f: FilaRendimiento) => `${f.proveedor}|${f.nivel}|${f.id}`;

function entidadDe(f: FilaRendimiento): Entidad {
  return { proveedor: f.proveedor, nivel: f.nivel, id: f.id, nombre: f.nombre };
}

/**
 * Analiza una cuenta publicitaria y devuelve hechos, consejos y lo que no se
 * pudo evaluar.
 *
 * ⭐ NO recibe conversaciones ni ventas: esto es inteligencia PUBLICITARIA y
 * tiene que funcionar para un negocio que solo conectó su cuenta. Lo que
 * Respondo sabe de más —quién escribió, quién compró— se suma en otra capa
 * (`lib/marketing/datos.ts`), y cuando está, manda.
 */
export function analizarAds(ctx: ContextoAnalisis): Analisis {
  const campanas = ctx.filas.filter((f) => f.nivel === "campana");
  const campanasAntes = new Map(ctx.filasAntes.filter((f) => f.nivel === "campana").map((f) => [idDe(f), f]));

  const insights: Insight[] = [];
  const recomendaciones: Recomendacion[] = [];
  const insuficientes: DatoInsuficiente[] = [];

  const gastoTotal = campanas.reduce((a, f) => a + f.gasto.valor, 0);
  const moneda = campanas[0]?.gasto.moneda ?? "CLP";
  const umbral = umbralGastoSinResultado(campanas);

  /* ── 0. ¿Hay algo que analizar? ────────────────────────────────────────── */
  if (!campanas.length) {
    return {
      insights: [],
      recomendaciones: [],
      insuficientes: [
        {
          clave: "sin_campanas",
          que: "El rendimiento de las campañas",
          queFalta: "La cuenta conectada no reportó ninguna campaña con actividad en este período.",
        },
      ],
      nadaQueCambiar: true,
    };
  }

  /* ── 1. LA MEDICIÓN PRIMERO ────────────────────────────────────────────────
     Antes que cualquier opinión de rendimiento: ¿esta cuenta está registrando
     resultados? Optimizar sobre una medición rota es el error más caro que
     existe, porque todo lo que sigue parece correcto. Es el punto 1 del método
     de la skill y acá es el punto 1 también. */
  const clicsTotales = campanas.reduce((a, f) => a + f.clics, 0);
  const algunaReportaResultados = campanas.some((f) => f.resultados !== null && f.resultados !== undefined);

  if (clicsTotales >= MINIMOS.clics && !algunaReportaResultados) {
    insights.push({
      clave: "medicion_muda",
      titulo: "La cuenta está recibiendo clics pero no registra ninguna conversión",
      evidencia: `${entero(clicsTotales)} clics en ${ctx.periodo} y ninguna acción de conversión reportada. Puede que la medición no esté instalada, o que esta cuenta no tenga conversiones configuradas. Mientras no se sepa, cualquier conclusión sobre qué campaña rinde mejor está construida sobre aire.`,
      tono: "alerta",
      prioridad: 200,
    });
    recomendaciones.push({
      clave: "revisar_medicion",
      accion: "revisar",
      que: "Revisar que la medición de conversiones esté instalada y activa",
      donde: "La cuenta publicitaria completa",
      porQue:
        "Sin conversiones registradas no se puede saber qué campaña trae clientes: solo cuál gasta más rápido.",
      evidencia: `${entero(clicsTotales)} clics y 0 conversiones en ${ctx.periodo}.`,
      datosUsados: ["clics", "conversiones", ctx.periodo],
      confianza: "alta",
      riesgo: "Ninguno: es una verificación, no un cambio.",
      entidad: entidadDe(campanas[0]),
      plataEnJuego: gastoTotal,
      moneda,
    });
    // Con la medición muda, el resto del análisis no se emite: sería opinar
    // sobre datos que sabemos incompletos.
    return { insights, recomendaciones, insuficientes, nadaQueCambiar: false };
  }

  /* ── 2. Concentración del gasto ───────────────────────────────────────────── */
  if (campanas.length >= 2 && gastoTotal > 0) {
    const mayor = [...campanas].sort((a, b) => b.gasto.valor - a.gasto.valor)[0];
    const parte = (mayor.gasto.valor / gastoTotal) * 100;
    if (parte >= 70) {
      insights.push({
        clave: `concentracion_${idDe(mayor)}`,
        titulo: `El ${Math.round(parte)}% de la inversión está en una sola campaña`,
        evidencia: `«${mayor.nombre}» concentra ${plata(mayor.gasto.valor, moneda)} de ${plata(gastoTotal, moneda)} en ${ctx.periodo}. No es un problema en sí —puede ser la que funciona— pero deja al negocio expuesto: si esa campaña cae, cae casi todo.`,
        tono: "neutro",
        prioridad: 55,
        entidad: entidadDe(mayor),
      });
    }
  }

  /* ── 3. Gasto sin resultados ──────────────────────────────────────────────── */
  if (umbral !== null) {
    for (const c of campanas) {
      const res = c.resultados?.cantidad ?? 0;
      if (res > 0) continue;
      if (c.gasto.valor < umbral) continue;
      if (c.clics < MINIMOS.clics) {
        insuficientes.push({
          clave: `sin_resultado_${idDe(c)}`,
          que: `Si «${c.nombre}» está rindiendo`,
          queFalta: `Gastó ${plata(c.gasto.valor, moneda)} pero lleva ${c.clics} clics. Hacen falta al menos ${MINIMOS.clics} para poder afirmar algo.`,
        });
        continue;
      }
      const pausada = c.estado === "pausada" || c.estado === "terminada";
      insights.push({
        clave: `gasta_sin_resultado_${idDe(c)}`,
        titulo: `«${c.nombre}» gastó ${plata(c.gasto.valor, moneda)} sin una sola conversión`,
        evidencia: `${entero(c.clics)} clics y 0 conversiones en ${ctx.periodo}. El umbral para decirlo se calculó con la propia cuenta: ${plata(umbral, moneda)}, que es tres veces lo que le cuesta a este negocio conseguir un resultado.`,
        tono: "alerta",
        prioridad: 120,
        entidad: entidadDe(c),
      });
      if (!pausada) {
        recomendaciones.push({
          clave: `pausar_${idDe(c)}`,
          accion: "pausar",
          que: `Pausar «${c.nombre}» o revisar a dónde manda el clic`,
          donde: `Campaña «${c.nombre}»`,
          porQue:
            "Está comprando visitas que no terminan en nada medible. Antes de pausar vale revisar si el problema es el destino (una página lenta o que no pide nada) y no el anuncio.",
          evidencia: `${plata(c.gasto.valor, moneda)} y ${entero(c.clics)} clics sin conversiones en ${ctx.periodo}.`,
          datosUsados: ["gasto", "clics", "conversiones", ctx.periodo],
          confianza: c.clics >= MINIMOS.clics * 2 ? "alta" : "media",
          riesgo:
            "Si la conversión de esta campaña ocurre por un canal que no medimos (una llamada, una visita al local), pausarla corta algo que sí funciona.",
          entidad: entidadDe(c),
          plataEnJuego: c.gasto.valor,
          moneda,
        });
      }
    }
  }

  /* ── 4. Costo por resultado contra el período anterior ───────────────────── */
  for (const c of campanas) {
    const antes = campanasAntes.get(idDe(c));
    if (!antes) continue;
    const rAhora = c.resultados?.cantidad ?? 0;
    const rAntes = antes.resultados?.cantidad ?? 0;

    if (!sonComparables(c.resultados, antes.resultados)) continue;

    if (rAhora < MINIMOS.resultadosParaComparar || rAntes < MINIMOS.resultadosParaComparar) {
      if (rAhora + rAntes > 0) {
        insuficientes.push({
          clave: `cpa_${idDe(c)}`,
          que: `Si el costo por resultado de «${c.nombre}» subió o bajó`,
          queFalta: `Hay ${rAhora} conversiones ahora y ${rAntes} antes. Hacen falta ${MINIMOS.resultadosParaComparar} en cada período para que la comparación signifique algo.`,
        });
      }
      continue;
    }

    const costoAhora = costoPorResultado(c);
    const costoAntes = costoPorResultado(antes);
    if (!costoAhora || !costoAntes) continue;
    const v = variacion(costoAhora.valor, costoAntes.valor);
    if (v === null || Math.abs(v) < 20) continue;

    const peor = v > 0;
    insights.push({
      clave: `costo_resultado_${idDe(c)}`,
      titulo: `El costo por conversión de «${c.nombre}» ${peor ? "subió" : "bajó"} ${pct(Math.abs(v))}`,
      evidencia: `${plata(costoAhora.valor, moneda)} por conversión en ${ctx.periodo}, contra ${plata(costoAntes.valor, moneda)} en el período anterior del mismo largo (${rAhora} y ${rAntes} conversiones).`,
      tono: peor ? "alerta" : "oportunidad",
      prioridad: peor ? 110 : 70,
      entidad: entidadDe(c),
    });

    if (peor) {
      recomendaciones.push({
        clave: `creativo_${idDe(c)}`,
        accion: "probar",
        que: `Probar una variante creativa nueva en «${c.nombre}» antes de tocar el presupuesto`,
        donde: `Campaña «${c.nombre}»`,
        porQue:
          "Cuando el costo sube con el mismo público, lo primero que se agota suele ser el anuncio, no la audiencia. Subir presupuesto sobre un anuncio cansado acelera el gasto sin mejorar el resultado.",
        evidencia: `Costo por conversión ${plata(costoAntes.valor, moneda)} → ${plata(costoAhora.valor, moneda)} (${pct(v)}).`,
        datosUsados: ["gasto", "conversiones", "período anterior de igual largo"],
        confianza: "media",
        riesgo: "Una creatividad nueva reinicia el aprendizaje y puede rendir peor las primeras 48 horas.",
        entidad: entidadDe(c),
        plataEnJuego: c.gasto.valor,
        moneda,
      });
    } else if (rAhora >= MINIMOS.resultadosParaElogiar) {
      recomendaciones.push({
        clave: `escalar_${idDe(c)}`,
        accion: "escalar",
        que: `Subir el presupuesto de «${c.nombre}» de a poco (no más de 20% por vez)`,
        donde: `Campaña «${c.nombre}»`,
        porQue: "Está consiguiendo conversiones más baratas que en el período anterior, con volumen suficiente para creerle.",
        evidencia: `${rAhora} conversiones a ${plata(costoAhora.valor, moneda)} contra ${plata(costoAntes.valor, moneda)} antes.`,
        datosUsados: ["gasto", "conversiones", "período anterior de igual largo"],
        confianza: "media",
        riesgo:
          "Un salto grande de presupuesto reinicia el aprendizaje y suele empeorar el costo durante días. Por eso de a 20% y no más de un ajuste por semana.",
        entidad: entidadDe(c),
        plataEnJuego: c.gasto.valor,
        moneda,
      });
    }
  }

  /* ── 5. CTR y CPM contra el propio período anterior ───────────────────────── */
  for (const c of campanas) {
    const antes = campanasAntes.get(idDe(c));
    if (!antes) continue;
    if (c.impresiones < MINIMOS.impresiones || antes.impresiones < MINIMOS.impresiones) continue;

    const ctrAhora = ctr(c);
    const ctrAntes = ctr(antes);
    if (ctrAhora !== null && ctrAntes !== null) {
      const v = variacion(ctrAhora, ctrAntes);
      if (v !== null && v <= -25) {
        insights.push({
          clave: `ctr_${idDe(c)}`,
          titulo: `«${c.nombre}» está consiguiendo menos clics por vista que antes`,
          evidencia: `CTR de ${dec1(ctrAntes)}% a ${dec1(ctrAhora)}% (${pct(v)}), con ${entero(c.impresiones)} impresiones en ${ctx.periodo}. Suele significar que el anuncio ya se vio demasiado o que el mensaje dejó de calzar con a quién se le muestra.`,
          tono: "alerta",
          prioridad: 90,
          entidad: entidadDe(c),
        });
      }
    }

    const cpmAhora = cpm(c);
    const cpmAntes = cpm(antes);
    if (cpmAhora && cpmAntes) {
      const v = variacion(cpmAhora.valor, cpmAntes.valor);
      if (v !== null && v >= 30) {
        insights.push({
          clave: `cpm_${idDe(c)}`,
          titulo: `Mostrar «${c.nombre}» se encareció ${pct(v)}`,
          evidencia: `${plata(cpmAntes.valor, moneda)} a ${plata(cpmAhora.valor, moneda)} por cada mil vistas. Pasa cuando hay más competencia por el mismo público (fechas comerciales) o cuando la audiencia quedó muy chica.`,
          tono: "neutro",
          prioridad: 60,
          entidad: entidadDe(c),
        });
      }
    }
  }

  /* ── 6. Desgaste creativo (solo donde hay frecuencia: Meta) ──────────────── */
  for (const c of campanas) {
    if (c.proveedor !== "meta") continue;
    const f = c.frecuencia;
    if (typeof f !== "number" || f < MINIMOS.frecuenciaAlta) continue;
    if (c.impresiones < MINIMOS.impresiones) continue;
    const antes = campanasAntes.get(idDe(c));
    const ctrAhora = ctr(c);
    const ctrAntes = antes ? ctr(antes) : null;
    const cayoCtr = ctrAhora !== null && ctrAntes !== null && ctrAhora < ctrAntes;

    insights.push({
      clave: `desgaste_${idDe(c)}`,
      titulo: `Cada persona ya vio «${c.nombre}» ${dec1(f)} veces`,
      evidencia: cayoCtr
        ? `Frecuencia ${dec1(f)} y el CTR bajó de ${dec1(ctrAntes!)}% a ${dec1(ctrAhora!)}%. Las dos señales juntas es el patrón del anuncio cansado: la misma gente lo ve otra vez y ya no lo aprieta.`
        : `Frecuencia ${dec1(f)} en ${ctx.periodo}. Todavía sin caída de CTR, así que no es urgente; conviene tener lista la próxima variante.`,
      tono: cayoCtr ? "alerta" : "neutro",
      prioridad: cayoCtr ? 95 : 45,
      entidad: entidadDe(c),
    });

    if (cayoCtr) {
      recomendaciones.push({
        clave: `rotar_${idDe(c)}`,
        accion: "probar",
        que: `Rotar la creatividad de «${c.nombre}»`,
        donde: `Campaña «${c.nombre}»`,
        porQue: "Frecuencia alta con CTR a la baja: el anuncio se gastó con este público.",
        evidencia: `Frecuencia ${dec1(f)}; CTR ${dec1(ctrAntes!)}% → ${dec1(ctrAhora!)}%.`,
        datosUsados: ["frecuencia", "CTR", "período anterior de igual largo"],
        confianza: "media",
        riesgo: "Si la audiencia es chica, cambiar el anuncio no arregla la frecuencia: hay que ampliarla.",
        entidad: entidadDe(c),
        plataEnJuego: c.gasto.valor,
        moneda,
      });
    }
  }

  /* ── 7. Mediana entre pares: quién queda muy por encima ───────────────────── */
  const conCosto = campanas
    .map((c) => ({ c, costo: costoPorResultado(c) }))
    .filter((x): x is { c: FilaRendimiento; costo: { valor: number; moneda: string } } => Boolean(x.costo));

  for (const { c, costo } of conCosto) {
    const pares = conCosto.filter((o) => o.c !== c && comparables(o.c, c));
    if (pares.length < MINIMOS.paresParaMediana - 1) continue;
    const med = mediana(pares.map((p) => p.costo.valor));
    if (med === null || med <= 0) continue;
    const veces = costo.valor / med;
    if (veces < 2) continue;
    if ((c.resultados?.cantidad ?? 0) < MINIMOS.resultadosParaElogiar) continue;

    insights.push({
      clave: `caro_vs_pares_${idDe(c)}`,
      titulo: `«${c.nombre}» consigue conversiones ${dec1(veces)}× más caras que el resto`,
      evidencia: `${plata(costo.valor, moneda)} por conversión contra una mediana de ${plata(med, moneda)} entre sus campañas comparables (mismo objetivo y mismo tipo de resultado, ${pares.length + 1} campañas).`,
      tono: "alerta",
      prioridad: 100,
      entidad: entidadDe(c),
    });
    recomendaciones.push({
      clave: `reducir_${idDe(c)}`,
      accion: "reducir",
      que: `Bajar el presupuesto de «${c.nombre}» y mover esa plata a las que convierten más barato`,
      donde: `Campaña «${c.nombre}»`,
      porQue: "Con el mismo objetivo y el mismo tipo de resultado, las demás campañas del negocio consiguen conversiones a menos de la mitad.",
      evidencia: `${plata(costo.valor, moneda)} vs mediana ${plata(med, moneda)} (${dec1(veces)}×).`,
      datosUsados: ["gasto", "conversiones", "mediana de campañas comparables"],
      confianza: pares.length >= MINIMOS.paresParaMediana ? "alta" : "media",
      riesgo:
        "Si esta campaña cumple otro rol —abrir un público nuevo, sostener la marca— su costo más alto puede ser esperable.",
      entidad: entidadDe(c),
      plataEnJuego: c.gasto.valor,
      moneda,
    });
  }

  /* ── 8. Lo que está funcionando: también es un hallazgo ──────────────────── */
  const mejor = conCosto
    .filter((x) => (x.c.resultados?.cantidad ?? 0) >= MINIMOS.resultadosParaElogiar)
    .sort((a, b) => a.costo.valor - b.costo.valor)[0];
  if (mejor && conCosto.length >= 2) {
    insights.push({
      clave: `mejor_${idDe(mejor.c)}`,
      titulo: `«${mejor.c.nombre}» es la que consigue conversiones más baratas`,
      evidencia: `${mejor.c.resultados!.cantidad} conversiones a ${plata(mejor.costo.valor, moneda)} cada una en ${ctx.periodo}.`,
      tono: "oportunidad",
      prioridad: 65,
      entidad: entidadDe(mejor.c),
    });
  }

  /* ── 9. Google: términos de búsqueda y palabras clave ────────────────────── */
  analizarBusqueda(ctx, { umbral, moneda, insights, recomendaciones, insuficientes });

  /* ── 10. ¿El período alcanza para hablar de tendencia? ───────────────────── */
  if (ctx.dias < MINIMOS.diasParaTendencia && ctx.filasAntes.length === 0) {
    insuficientes.push({
      clave: "periodo_corto",
      que: "Si algo mejoró o empeoró",
      queFalta: `El período elegido tiene ${ctx.dias} días y no hay un período anterior con datos para comparar.`,
    });
  }

  return {
    insights: insights.sort((a, b) => b.prioridad - a.prioridad),
    recomendaciones: recomendaciones.sort(
      (a, b) => (b.plataEnJuego ?? 0) - (a.plataEnJuego ?? 0) || confianzaPeso(b.confianza) - confianzaPeso(a.confianza),
    ),
    insuficientes,
    nadaQueCambiar: recomendaciones.length === 0,
  };
}

function confianzaPeso(c: Confianza): number {
  return c === "alta" ? 3 : c === "media" ? 2 : 1;
}

/**
 * LO ESPECÍFICO DE BÚSQUEDA (hoy, solo Google).
 *
 * ⭐⭐ LA REGLA QUE SALVÓ UNA CUENTA REAL: antes de proponer una palabra
 * negativa, hay que verificar que no bloquee una palabra clave propia. En junio
 * de 2026 se agregó la negativa «sublimacion» en Impresora Color y dejó CIEGO
 * un grupo de anuncios completo durante semanas sin que nadie lo notara. Acá
 * esa verificación no es un consejo escrito en un documento: está en el código,
 * y una negativa que choca con una palabra activa NO se propone.
 */
function analizarBusqueda(
  ctx: ContextoAnalisis,
  acc: {
    umbral: number | null;
    moneda: string;
    insights: Insight[];
    recomendaciones: Recomendacion[];
    insuficientes: DatoInsuficiente[];
  },
): void {
  const terminos = ctx.filas.filter((f) => f.nivel === "termino");
  const palabras = ctx.filas.filter((f) => f.nivel === "palabra");
  if (!terminos.length && !palabras.length) return;

  const { umbral, moneda } = acc;

  /* Palabras clave que gastan sin convertir. */
  if (umbral !== null) {
    const caras = palabras
      .filter((p) => (p.resultados?.cantidad ?? 0) === 0 && p.clics >= MINIMOS.clics && p.gasto.valor >= umbral)
      .sort((a, b) => b.gasto.valor - a.gasto.valor)
      .slice(0, 3);
    for (const p of caras) {
      acc.insights.push({
        clave: `palabra_cara_${idDe(p)}`,
        titulo: `La palabra «${p.nombre}» gastó ${plata(p.gasto.valor, moneda)} sin convertir`,
        evidencia: `${entero(p.clics)} clics y 0 conversiones en ${ctx.periodo}, con concordancia ${String(p.extra?.concordancia ?? "—").toLowerCase()}.`,
        tono: "alerta",
        prioridad: 85,
        entidad: entidadDe(p),
      });
      acc.recomendaciones.push({
        clave: `revisar_palabra_${idDe(p)}`,
        accion: "revisar",
        que: `Revisar la palabra «${p.nombre}»: pausarla o cerrarle la concordancia`,
        donde: `Grupo «${p.grupoNombre ?? "—"}» · campaña «${p.campanaNombre ?? "—"}»`,
        porQue:
          "Está trayendo clics que no convierten. Antes de pausarla conviene mirar sus términos: a veces la palabra sirve y lo que falla es la concordancia amplia.",
        evidencia: `${plata(p.gasto.valor, moneda)} en ${entero(p.clics)} clics, 0 conversiones, ${ctx.periodo}.`,
        datosUsados: ["gasto", "clics", "conversiones", "concordancia"],
        confianza: p.clics >= MINIMOS.clics * 2 ? "alta" : "media",
        riesgo: "Si es una palabra de marca o de un servicio nuevo, cortarla apaga demanda que recién empieza.",
        entidad: entidadDe(p),
        plataEnJuego: p.gasto.valor,
        moneda,
      });
    }
  }

  /* Términos de búsqueda que gastan sin convertir. */
  if (umbral !== null && terminos.length) {
    const textoPalabras = palabras.map((p) => p.nombre.toLowerCase());
    const sospechosos = terminos
      .filter((t) => (t.resultados?.cantidad ?? 0) === 0 && t.gasto.valor >= umbral && t.clics >= 3)
      .sort((a, b) => b.gasto.valor - a.gasto.valor)
      .slice(0, 5);

    for (const t of sospechosos) {
      const termino = t.nombre.toLowerCase();
      /**
       * LA VERIFICACIÓN. Si alguna palabra clave activa del negocio CONTIENE el
       * término (o al revés), negativizarlo la dejaría ciega. En ese caso no se
       * propone la negativa: se dice por qué no.
       */
      const choca = textoPalabras.filter((p) => p.includes(termino) || termino.includes(p));
      if (choca.length) {
        acc.insuficientes.push({
          clave: `negativa_riesgosa_${t.id}`,
          que: `Excluir el término «${t.nombre}»`,
          queFalta: `No se propone: chocaría con ${choca.length === 1 ? "la palabra clave activa" : "palabras clave activas"} «${choca.slice(0, 2).join("», «")}» y dejaría ciego a ese grupo. Es exactamente lo que pasó con una negativa de una sola palabra en una cuenta real.`,
        });
        continue;
      }
      acc.recomendaciones.push({
        clave: `negativa_${t.id}`,
        accion: "revisar",
        que: `Evaluar excluir el término «${t.nombre}»`,
        donde: `Campaña «${t.campanaNombre ?? "—"}»`,
        porQue:
          "Gastó sin convertir y no choca con ninguna palabra clave activa del negocio (verificado contra las palabras del período).",
        evidencia: `${plata(t.gasto.valor, moneda)} en ${entero(t.clics)} clics, 0 conversiones, ${ctx.periodo}.`,
        datosUsados: ["términos de búsqueda", "gasto", "clics", "conversiones", "palabras clave activas"],
        confianza: "media",
        riesgo:
          "Un término que hoy no convierte puede ser parte de una búsqueda larga que sí vende. Conviene excluir en concordancia exacta, no amplia.",
        entidad: entidadDe(t),
        plataEnJuego: t.gasto.valor,
        moneda,
      });
    }

    /* Términos que SÍ convierten y todavía no son palabra clave: la oportunidad. */
    const ganadores = terminos
      .filter((t) => (t.resultados?.cantidad ?? 0) >= 2)
      .filter((t) => !textoPalabras.includes(t.nombre.toLowerCase()))
      .sort((a, b) => (b.resultados?.cantidad ?? 0) - (a.resultados?.cantidad ?? 0))
      .slice(0, 3);
    for (const t of ganadores) {
      acc.insights.push({
        clave: `termino_gana_${t.id}`,
        titulo: `«${t.nombre}» está convirtiendo y todavía no es palabra clave propia`,
        evidencia: `${t.resultados!.cantidad} conversiones con ${plata(t.gasto.valor, moneda)} en ${ctx.periodo}. Hoy entra por concordancia; agregarla deja controlar su puja y su anuncio.`,
        tono: "oportunidad",
        prioridad: 75,
        entidad: entidadDe(t),
      });
    }
  }
}
