import {
  costoPorResultado,
  ctr,
  cpm,
  sonComparables,
  type FilaRendimiento,
  type Proveedor,
} from "@/lib/ads/canal";
import {
  MONEDA_DESCONOCIDA,
  agruparPorMoneda,
  monedaConocida,
  normalizarMoneda,
  type Moneda,
} from "@/lib/ads/moneda";

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
  /**
   * ⭐ CAÍDA MATERIAL DE CTR, en porcentaje RELATIVO.
   *
   * Antes el desgaste creativo se disparaba con `ctrAhora < ctrAntes`: un CTR
   * de 2,50% que pasaba a 2,49% —una diferencia de cuatro décimas de por
   * ciento, indistinguible del ruido— generaba una alerta de «anuncio cansado»
   * y una recomendación de rotar la creatividad. Alertar por ruido no es ser
   * cuidadoso: es entrenar al dueño para ignorar las alertas.
   *
   * 25% es el mismo umbral con que ya se reporta una caída de CTR en la
   * sección 5, y se usa el mismo acá a propósito: dos umbrales distintos para
   * la misma señal serían dos productos distintos discutiendo entre ellos.
   */
  caidaCtrMaterial: 25,
  /** Subida de CPM que vale la pena nombrar, en porcentaje relativo. */
  subidaCpmMaterial: 30,
  /** Variación de costo por resultado que deja de ser ruido. */
  variacionCostoMaterial: 20,
  /** Clics de un término antes de opinar de él. */
  clicsTermino: 3,
} as const;

/**
 * Los umbrales, reemplazables sin tocar el código.
 *
 * Son los mismos de `MINIMOS`, pero pasables por parámetro: una instalación con
 * cuentas muy chicas puede bajarlos y una agencia puede subirlos, y el test
 * puede fijarlos. Lo que NO es reemplazable es que exista un umbral: sin él,
 * cualquier variación es un hallazgo.
 */
export type Umbrales = {
  caidaCtrMaterial: number;
  subidaCpmMaterial: number;
  variacionCostoMaterial: number;
  frecuenciaAlta: number;
  impresiones: number;
  clics: number;
};

export function umbralesCon(parcial?: Partial<Umbrales>): Umbrales {
  return {
    caidaCtrMaterial: MINIMOS.caidaCtrMaterial,
    subidaCpmMaterial: MINIMOS.subidaCpmMaterial,
    variacionCostoMaterial: MINIMOS.variacionCostoMaterial,
    frecuenciaAlta: MINIMOS.frecuenciaAlta,
    impresiones: MINIMOS.impresiones,
    clics: MINIMOS.clics,
    ...(parcial ?? {}),
  };
}

/**
 * ¿Esta entidad está viva?
 *
 * ⚠️ Recomendar «sube 20% el presupuesto» sobre una campaña PAUSADA es ruido
 * puro: no hay presupuesto que subir. Peor, gasta la credibilidad del panel en
 * un consejo imposible de ejecutar. Los HECHOS sobre una campaña pausada sí se
 * reportan —gastó lo que gastó— pero las acciones que exigen una campaña activa
 * no se proponen.
 */
export function estaActiva(f: { estado?: FilaRendimiento["estado"] }): boolean {
  return f.estado !== "pausada" && f.estado !== "terminada";
}

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
  /**
   * ⚠️ Este umbral es un ESCALAR, y por eso solo tiene sentido sobre filas de
   * UNA moneda. Quien lo llama ya particionó por moneda (`analizarAds`); acá se
   * comprueba igual, porque un umbral calculado sobre pesos y dólares mezclados
   * es un número con forma de umbral que no acota nada.
   */
  const monedas = new Set(filas.map((f) => normalizarMoneda(f.gasto.moneda)));
  if (monedas.size > 1) return null;
  if (!monedaConocida([...monedas][0] ?? MONEDA_DESCONOCIDA)) return null;

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
  /**
   * Sin moneda conocida NO se escribe símbolo ni código: sale el número pelado,
   * que es exactamente lo que sabemos. Antes cualquier cosa que no fuera «CLP»
   * se imprimía como «12345 » con la moneda vacía al lado.
   */
  const m = normalizarMoneda(moneda);
  if (!monedaConocida(m)) return n;
  return m === "CLP" ? `$${n}` : `${n} ${m}`;
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
  /** Umbrales de materialidad. Se omiten para usar los de fábrica. */
  umbrales?: Partial<Umbrales>;
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

  const insights: Insight[] = [];
  const recomendaciones: Recomendacion[] = [];
  const insuficientes: DatoInsuficiente[] = [];

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

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * ⭐ EL ANÁLISIS SE PARTE POR MONEDA, Y ESO NO ES UN DETALLE DE FORMATO.
   *
   * Todo lo que sigue compara plata: el total gastado, el umbral de «gastó sin
   * convertir», la concentración del presupuesto, la mediana entre pares. Antes
   * todo eso salía de un `reduce((a, f) => a + f.gasto.valor, 0)` sobre TODAS
   * las filas y de un `campanas[0]?.gasto.moneda ?? "CLP"` para rotular el
   * resultado. Con una cuenta de Meta en dólares y una de Google en pesos eso
   * daba, literalmente, 100.000 + 150 = 100.150 «pesos»: el umbral quedaba
   * inflado, la concentración marcaba 99,8% en el canal equivocado y la cifra
   * salía a pantalla con el símbolo de la moneda de la primera fila.
   *
   * No hay tipo de cambio que inventar acá. Lo correcto es analizar cada moneda
   * por separado —cada grupo con su propio total, su propio umbral y su propia
   * mediana— y decirle a la persona que los totales no se suman entre sí.
   * ═════════════════════════════════════════════════════════════════════════
   */
  const porMoneda = agruparPorMoneda(campanas, (c) => c.gasto);
  const conocidas = [...porMoneda.keys()].filter((m) => monedaConocida(m));

  if (conocidas.length > 1) {
    insuficientes.push({
      clave: "monedas_mezcladas",
      que: "El total invertido y el costo por resultado del negocio completo",
      queFalta: `Las cuentas conectadas facturan en ${conocidas.join(" y ")}. Cada una se analiza por separado: sumar o comparar cifras de monedas distintas exigiría un tipo de cambio que Respondo no tiene y no va a inventar.`,
    });
  }

  for (const [moneda, delGrupo] of porMoneda) {
    analizarUnaMoneda(ctx, delGrupo, moneda, { insights, recomendaciones, insuficientes });
  }

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

type Acumulador = {
  insights: Insight[];
  recomendaciones: Recomendacion[];
  insuficientes: DatoInsuficiente[];
};

/**
 * El análisis de UN grupo de campañas que comparten moneda.
 *
 * Todo lo de acá adentro puede sumar y comparar plata sin miedo, porque todas
 * las filas que recibe están en la misma unidad. Lo que NO puede hacer es mirar
 * fuera de su grupo.
 */
function analizarUnaMoneda(
  ctx: ContextoAnalisis,
  campanas: FilaRendimiento[],
  moneda: Moneda,
  acc: Acumulador,
): void {
  const { insights, recomendaciones, insuficientes } = acc;
  const campanasAntes = new Map(
    ctx.filasAntes
      .filter((f) => f.nivel === "campana" && normalizarMoneda(f.gasto.moneda) === normalizarMoneda(moneda))
      .map((f) => [idDe(f), f]),
  );
  const umbrales = umbralesCon(ctx.umbrales);

  /**
   * ⚠️ Sin moneda conocida NO hay umbral de plata ni comparación de costos: el
   * gasto se puede mostrar, pero «gastó 40.000 sin convertir» no significa nada
   * si no sabemos 40.000 de qué. Lo que SÍ sobrevive es todo lo que se mide en
   * cantidades: CTR, frecuencia, impresiones.
   */
  const hayMoneda = monedaConocida(moneda);
  const gastoTotal = campanas.reduce((a, f) => a + f.gasto.valor, 0);
  const umbral = hayMoneda ? umbralGastoSinResultado(campanas) : null;

  if (!hayMoneda) {
    insuficientes.push({
      clave: "moneda_desconocida",
      que: "El costo por resultado y los umbrales de gasto de esas campañas",
      queFalta: `${campanas.length === 1 ? "Una campaña reporta" : `${campanas.length} campañas reportan`} gasto pero la cuenta no declaró su moneda. Las cifras se muestran sin símbolo y no se comparan con nada: preferimos decir «no comparable» antes que mostrar una cifra falsa.`,
    });
  }

  /* ── 1. LA MEDICIÓN PRIMERO ────────────────────────────────────────────────
     Antes que cualquier opinión de rendimiento: ¿esta cuenta está registrando
     resultados? Optimizar sobre una medición rota es el error más caro que
     existe, porque todo lo que sigue parece correcto. Es el punto 1 del método
     de la skill y acá es el punto 1 también. */
  const clicsTotales = campanas.reduce((a, f) => a + f.clics, 0);
  const algunaReportaResultados = campanas.some((f) => f.resultados !== null && f.resultados !== undefined);

  const medicionMuda = clicsTotales >= umbrales.clics && !algunaReportaResultados;

  if (medicionMuda) {
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
      plataEnJuego: hayMoneda ? gastoTotal : null,
      moneda,
    });
    insuficientes.push({
      clave: "sin_conversiones_medidas",
      que: "Qué campaña trae clientes y cuál no",
      queFalta:
        "Esta cuenta no está registrando ninguna conversión, así que no se puede comparar el costo por resultado de nada. Lo que sigue son hallazgos de ENTREGA —cuántos ven el anuncio, cuántos lo aprietan, cuánto cuesta mostrarlo— que no dependen de esa medición.",
    });
  }

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * ⭐ INTELIGENCIA DE CONVERSIÓN vs INTELIGENCIA DE ENTREGA.
   *
   * Acá había un `return` temprano: si la medición estaba muda, el motor
   * devolvía la alerta de medición y NADA más. La intención era buena —no
   * opinar sobre datos que sabemos incompletos— pero apagaba de más. Que no
   * haya conversiones registradas no hace desconocido el CTR, ni la frecuencia,
   * ni el CPM, ni cómo está repartido el gasto, ni qué términos de búsqueda
   * están entrando. Un negocio con la medición rota es precisamente el que más
   * necesita que alguien le diga que su anuncio se gastó.
   *
   * La regla, entonces, no es «callarse»: es NO OPINAR SOBRE CONVERSIONES.
   *   · conversión → costo por resultado, escalar, reducir, mediana entre
   *     pares, mejor campaña, términos que no convierten. Todo eso se apaga.
   *   · entrega    → CTR, CPM, frecuencia, desgaste creativo, concentración del
   *     gasto, reparto entre términos. Todo eso sigue.
   * ═════════════════════════════════════════════════════════════════════════
   */
  const puedeOpinarDeConversiones = !medicionMuda;

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

  /* ── 3. Gasto sin resultados (conversión) ───────────────────────────────── */
  if (puedeOpinarDeConversiones && umbral !== null) {
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

  /* ── 4. Costo por resultado contra el período anterior (conversión) ──────── */
  for (const c of puedeOpinarDeConversiones ? campanas : []) {
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
    if (v === null || Math.abs(v) < umbrales.variacionCostoMaterial) continue;

    const peor = v > 0;
    insights.push({
      clave: `costo_resultado_${idDe(c)}`,
      titulo: `El costo por conversión de «${c.nombre}» ${peor ? "subió" : "bajó"} ${pct(Math.abs(v))}`,
      evidencia: `${plata(costoAhora.valor, moneda)} por conversión en ${ctx.periodo}, contra ${plata(costoAntes.valor, moneda)} en el período anterior del mismo largo (${rAhora} y ${rAntes} conversiones).`,
      tono: peor ? "alerta" : "oportunidad",
      prioridad: peor ? 110 : 70,
      entidad: entidadDe(c),
    });

    if (peor && estaActiva(c)) {
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
    } else if (rAhora >= MINIMOS.resultadosParaElogiar && estaActiva(c)) {
      /**
       * ⚠️ `estaActiva`: recomendar «sube 20% el presupuesto» sobre una campaña
       * PAUSADA no es un consejo, es una imposibilidad. Antes se emitía igual,
       * porque la comparación de costo por resultado no miraba el estado.
       */
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
    if (c.impresiones < umbrales.impresiones || antes.impresiones < umbrales.impresiones) continue;

    const ctrAhora = ctr(c);
    const ctrAntes = ctr(antes);
    if (ctrAhora !== null && ctrAntes !== null) {
      const v = variacion(ctrAhora, ctrAntes);
      if (v !== null && v <= -umbrales.caidaCtrMaterial) {
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
      if (v !== null && v >= umbrales.subidaCpmMaterial) {
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
  /**
   * ⚠️ ACÁ ESTABA `const cayoCtr = ctrAhora < ctrAntes`.
   *
   * Cualquier decremento contaba: 2,50% → 2,49% disparaba la alerta de anuncio
   * cansado y la recomendación de rotar la creatividad. Es ruido con forma de
   * diagnóstico, y el costo no es el falso positivo: es que el dueño aprende a
   * ignorar la sección entera.
   *
   * Tampoco alcanza con «poner un número». La fatiga necesita las TRES cosas a
   * la vez, y las tres tienen una razón distinta:
   *   · FRECUENCIA suficiente  → sin repetición no hay desgaste que explicar.
   *   · VOLUMEN suficiente en LOS DOS períodos → un CTR sobre 80 impresiones se
   *     mueve solo; sin base en el período anterior no hay contra qué comparar.
   *   · CAÍDA MATERIAL → una baja relativa que supere el umbral configurado.
   * Si falta cualquiera, se reporta la frecuencia como HECHO y no se recomienda
   * nada: «tienes frecuencia 3,4» es cierto; «tu anuncio se gastó» no lo es.
   */
  for (const c of campanas) {
    if (c.proveedor !== "meta") continue;
    const f = c.frecuencia;
    if (typeof f !== "number" || f < umbrales.frecuenciaAlta) continue;
    if (c.impresiones < umbrales.impresiones) continue;
    const antes = campanasAntes.get(idDe(c));
    const ctrAhora = ctr(c);
    const ctrAntes = antes ? ctr(antes) : null;
    const hayBase = Boolean(antes && antes.impresiones >= umbrales.impresiones);
    const caida = hayBase && ctrAhora !== null && ctrAntes !== null ? variacion(ctrAhora, ctrAntes) : null;
    const cayoCtr = caida !== null && caida <= -umbrales.caidaCtrMaterial;

    insights.push({
      clave: `desgaste_${idDe(c)}`,
      titulo: `Cada persona ya vio «${c.nombre}» ${dec1(f)} veces`,
      evidencia: cayoCtr
        ? `Frecuencia ${dec1(f)} y el CTR bajó de ${dec1(ctrAntes!)}% a ${dec1(ctrAhora!)}% (${pct(caida!)}), con ${entero(c.impresiones)} impresiones ahora y ${entero(antes!.impresiones)} antes. Las dos señales juntas es el patrón del anuncio cansado: la misma gente lo ve otra vez y ya no lo aprieta.`
        : hayBase && caida !== null
          ? `Frecuencia ${dec1(f)} en ${ctx.periodo}. El CTR se movió ${pct(caida)}, que está dentro del ruido normal: todavía no es desgaste. Conviene tener lista la próxima variante.`
          : `Frecuencia ${dec1(f)} en ${ctx.periodo}. No hay un período anterior con volumen suficiente para saber si el CTR está cayendo; por ahora es solo repetición.`,
      tono: cayoCtr ? "alerta" : "neutro",
      prioridad: cayoCtr ? 95 : 45,
      entidad: entidadDe(c),
    });

    if (cayoCtr && estaActiva(c)) {
      recomendaciones.push({
        clave: `rotar_${idDe(c)}`,
        accion: "probar",
        que: `Rotar la creatividad de «${c.nombre}»`,
        donde: `Campaña «${c.nombre}»`,
        porQue: "Frecuencia alta con CTR a la baja: el anuncio se gastó con este público.",
        evidencia: `Frecuencia ${dec1(f)}; CTR ${dec1(ctrAntes!)}% → ${dec1(ctrAhora!)}% (${pct(caida!)}), sobre ${entero(c.impresiones)} impresiones.`,
        datosUsados: ["frecuencia", "CTR", "período anterior de igual largo"],
        confianza: "media",
        riesgo: "Si la audiencia es chica, cambiar el anuncio no arregla la frecuencia: hay que ampliarla.",
        entidad: entidadDe(c),
        plataEnJuego: c.gasto.valor,
        moneda,
      });
    }
  }

  /* ── 7. Mediana entre pares: quién queda muy por encima (conversión) ─────── */
  const conCosto = (puedeOpinarDeConversiones && hayMoneda ? campanas : [])
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
    // Bajarle el presupuesto a una campaña pausada no baja nada.
    if (!estaActiva(c)) continue;
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
  analizarBusqueda(ctx, {
    umbral,
    moneda,
    puedeOpinarDeConversiones,
    insights,
    recomendaciones,
    insuficientes,
  });
}

function confianzaPeso(c: Confianza): number {
  return c === "alta" ? 3 : c === "media" ? 2 : 1;
}

/* ── Términos, palabras clave y negativas: el modelo ──────────────────────── */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTO ES UN MODELO Y NO UN `includes`.
 *
 * La verificación existía y era correcta en intención: antes de proponer una
 * negativa hay que comprobar que no ciegue una palabra clave propia. Pero
 * estaba escrita así:
 *
 *   textoPalabras.filter((p) => p.includes(termino) || termino.includes(p))
 *
 * y `includes` no sabe nada de Google Ads. Tres fallas reales:
 *
 *  1. **Compara substrings, no palabras.** El término «auto» «choca» con la
 *     palabra clave «autor», y «impresion» con «impresiones». La propuesta se
 *     bloquea por un choque que no existe, y el dueño nunca se entera de que
 *     está pagando por ese término.
 *  2. **No distingue concordancia.** Una negativa EXACTA solo bloquea esa
 *     consulta literal; una de FRASE bloquea cualquier consulta que contenga
 *     esa secuencia; una AMPLIA, cualquiera que contenga esas palabras en
 *     cualquier orden. Son tres radios de daño distintos y el código trataba a
 *     los tres igual.
 *  3. **No mira el estado.** Una palabra clave PAUSADA no está trayendo
 *     tráfico: no se puede «cegar». Bloquear la propuesta por culpa de una
 *     palabra pausada es un falso negativo puro.
 *
 * La lección de junio de 2026 —la negativa «sublimacion» que dejó ciego un
 * grupo entero en Impresora Color— no fue «verifica substrings»: fue **una
 * negativa de UNA palabra en concordancia amplia mata todo lo que la contenga**.
 * Eso es lo que este modelo sabe.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type Concordancia = "exacta" | "frase" | "amplia";

/** Palabras comparables: sin tildes, sin signos, sin los adornos de Google. */
export function tokens(texto: string): string[] {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[+"\[\]]/g, " ")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** ¿`a` aparece como secuencia contigua dentro de `b`? */
function contieneSecuencia(b: string[], a: string[]): boolean {
  if (!a.length || a.length > b.length) return false;
  for (let i = 0; i <= b.length - a.length; i++) {
    if (a.every((t, j) => b[i + j] === t)) return true;
  }
  return false;
}

/**
 * ¿Una negativa con este texto y esta concordancia dejaría sin servir a esta
 * palabra clave?
 *
 * El criterio es el de Google: una palabra clave queda inútil si TODA consulta
 * que la active caería en la negativa. Con una negativa exacta eso solo pasa si
 * la palabra clave ES el término. Con una de frase, si el término aparece
 * completo y en orden dentro de la palabra clave. Con una amplia, basta con que
 * todas sus palabras estén, en cualquier orden.
 */
export function negativaBloquea(negativa: string, concordancia: Concordancia, palabraClave: string): boolean {
  const n = tokens(negativa);
  const k = tokens(palabraClave);
  if (!n.length || !k.length) return false;
  if (concordancia === "exacta") return n.length === k.length && n.every((t, i) => t === k[i]);
  if (concordancia === "frase") return contieneSecuencia(k, n);
  return n.every((t) => k.includes(t));
}

export type VeredictoNegativa = {
  /** Con qué concordancia se puede proponer sin cegar nada. `null` = con ninguna. */
  concordancia: Concordancia | null;
  /** Palabras clave ACTIVAS que quedarían sin servir si se aplicara en amplia. */
  bloqueaEnAmplia: string[];
  /** Palabras clave ACTIVAS que quedarían sin servir en frase. */
  bloqueaEnFrase: string[];
};

/**
 * Evalúa una negativa candidata contra las palabras clave ACTIVAS del negocio.
 *
 * Devuelve la concordancia MÁS SEGURA con la que se puede proponer, y qué
 * pasaría si alguien la aplicara más ancha. Esa segunda parte es la que
 * convierte la lección de «sublimacion» en algo que el dueño puede leer antes
 * de hacer el cambio, y no después.
 */
export function evaluarNegativa(termino: string, palabrasActivas: string[]): VeredictoNegativa {
  const enFrase = palabrasActivas.filter((p) => negativaBloquea(termino, "frase", p));
  const enAmplia = palabrasActivas.filter((p) => negativaBloquea(termino, "amplia", p));
  const enExacta = palabrasActivas.filter((p) => negativaBloquea(termino, "exacta", p));
  return {
    concordancia: enExacta.length ? null : enFrase.length ? "exacta" : "frase",
    bloqueaEnFrase: enFrase,
    bloqueaEnAmplia: enAmplia,
  };
}

/** ¿Este término ya está agregado o ya está excluido en la cuenta? */
function estadoTermino(f: FilaRendimiento): { yaExcluido: boolean; yaEsPalabra: boolean } {
  const s = String(f.extra?.estadoTermino ?? "").toUpperCase();
  return {
    yaExcluido: s.includes("EXCLUDED"),
    yaEsPalabra: s === "ADDED" || s === "ADDED_EXCLUDED",
  };
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
    puedeOpinarDeConversiones: boolean;
    insights: Insight[];
    recomendaciones: Recomendacion[];
    insuficientes: DatoInsuficiente[];
  },
): void {
  const { umbral, moneda, puedeOpinarDeConversiones } = acc;

  /**
   * ⚠️ Solo las filas de ESTE grupo de moneda. Un término de una campaña en
   * dólares no se compara con el umbral de una cuenta en pesos. El criterio es
   * la moneda del propio gasto de la fila y no la campaña a la que dice
   * pertenecer: es el dato que la fila trae garantizado.
   */
  const delGrupo = (f: FilaRendimiento) => normalizarMoneda(f.gasto.moneda) === normalizarMoneda(moneda);
  const terminos = ctx.filas.filter((f) => f.nivel === "termino" && delGrupo(f));
  const palabras = ctx.filas.filter((f) => f.nivel === "palabra" && delGrupo(f));
  if (!terminos.length && !palabras.length) return;

  /**
   * Las palabras clave que de verdad están trayendo tráfico. Una pausada no se
   * puede cegar, así que no puede vetar una negativa.
   */
  const activas = palabras.filter(estaActiva).map((p) => p.nombre);

  /* Palabras clave que gastan sin convertir. */
  if (puedeOpinarDeConversiones && umbral !== null) {
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
      // Una palabra pausada ya no gasta: no hay nada que pausar.
      if (!estaActiva(p)) continue;
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
  if (puedeOpinarDeConversiones && umbral !== null && terminos.length) {
    const sospechosos = terminos
      .filter((t) => (t.resultados?.cantidad ?? 0) === 0 && t.gasto.valor >= umbral && t.clics >= MINIMOS.clicsTermino)
      .filter((t) => !estadoTermino(t).yaExcluido)
      .sort((a, b) => b.gasto.valor - a.gasto.valor)
      .slice(0, 5);

    for (const t of sospechosos) {
      /**
       * LA VERIFICACIÓN, ahora con el modelo. Se propone la concordancia MÁS
       * SEGURA que no ciegue ninguna palabra activa, y si ninguna sirve se dice
       * por qué en vez de proponer algo peligroso.
       */
      const v = evaluarNegativa(t.nombre, activas);
      if (!v.concordancia) {
        acc.insuficientes.push({
          clave: `negativa_riesgosa_${t.id}`,
          que: `Excluir el término «${t.nombre}»`,
          queFalta: `No se propone: es exactamente ${v.bloqueaEnFrase.length === 1 ? "la palabra clave activa" : "una de las palabras clave activas"} «${v.bloqueaEnFrase.slice(0, 2).join("», «")}», así que excluirlo dejaría ciego a ese grupo. Lo que conviene revisar es la palabra clave, no el término.`,
        });
        continue;
      }
      const aviso =
        v.bloqueaEnAmplia.length && v.concordancia !== "amplia"
          ? ` Ojo: aplicada en concordancia AMPLIA dejaría sin servir «${v.bloqueaEnAmplia.slice(0, 3).join("», «")}». Es el error que en junio de 2026 dejó ciego un grupo entero durante semanas.`
          : "";
      acc.recomendaciones.push({
        clave: `negativa_${t.id}`,
        accion: "revisar",
        que: `Evaluar excluir el término «${t.nombre}» en concordancia ${v.concordancia}`,
        donde: `Campaña «${t.campanaNombre ?? "—"}»`,
        porQue: `Gastó sin convertir y en concordancia ${v.concordancia} no deja sin servir ninguna de las ${activas.length} palabras clave activas del negocio (verificado palabra por palabra, no por substring).${aviso}`,
        evidencia: `${plata(t.gasto.valor, moneda)} en ${entero(t.clics)} clics, 0 conversiones, ${ctx.periodo}. Lo disparó la palabra «${String(t.extra?.palabraQueLoDisparo ?? "—")}» en concordancia ${String(t.extra?.concordancia ?? "—").toLowerCase()}.`,
        datosUsados: ["términos de búsqueda", "gasto", "clics", "conversiones", "palabras clave activas", "concordancia"],
        confianza: "media",
        riesgo:
          "Un término que hoy no convierte puede ser parte de una búsqueda larga que sí vende. Por eso se propone en la concordancia más cerrada que no rompe nada.",
        entidad: entidadDe(t),
        plataEnJuego: t.gasto.valor,
        moneda,
      });
    }

    /* Términos que SÍ convierten y todavía no son palabra clave: la oportunidad. */
    const ganadores = terminos
      .filter((t) => (t.resultados?.cantidad ?? 0) >= 2)
      .filter((t) => !estadoTermino(t).yaEsPalabra)
      // Comparación por palabras, no por cadena: «impresion planos» y
      // «Impresión de planos» no son el mismo término, pero «Impresion Planos»
      // sí lo es y antes contaba como nuevo por una tilde.
      .filter((t) => !palabras.some((p) => tokens(p.nombre).join(" ") === tokens(t.nombre).join(" ")))
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

  /**
   * ── ENTREGA: esto sobrevive a la medición muda ──────────────────────────
   *
   * Cuando la cuenta no registra conversiones, todo lo de arriba se apaga
   * —«gastó sin convertir» no se puede afirmar si nada convierte nunca— pero el
   * reparto del gasto entre términos sigue siendo un hecho observable, y es
   * justo lo que le sirve a un negocio con la medición rota: ver en qué se está
   * yendo la plata mientras arregla la medición.
   */
  if (!puedeOpinarDeConversiones && terminos.length >= MINIMOS.paresParaMediana) {
    const gastoTerminos = terminos.reduce((a, t) => a + t.gasto.valor, 0);
    const mayor = [...terminos].sort((a, b) => b.gasto.valor - a.gasto.valor)[0];
    if (gastoTerminos > 0 && mayor.clics >= MINIMOS.clicsTermino) {
      const parte = (mayor.gasto.valor / gastoTerminos) * 100;
      if (parte >= 30) {
        acc.insights.push({
          clave: `termino_concentra_${mayor.id}`,
          titulo: `«${mayor.nombre}» se está llevando el ${Math.round(parte)}% de lo que gastan las búsquedas`,
          evidencia: `${plata(mayor.gasto.valor, moneda)} de ${plata(gastoTerminos, moneda)} y ${entero(mayor.clics)} clics en ${ctx.periodo}. No se puede decir si convierte —esta cuenta no registra conversiones— pero sí en qué se está yendo la plata.`,
          tono: "neutro",
          prioridad: 80,
          entidad: entidadDe(mayor),
        });
      }
    }
  }
}
