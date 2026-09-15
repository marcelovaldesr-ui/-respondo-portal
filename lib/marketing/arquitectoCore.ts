import type { Proveedor } from "@/lib/ads/canal";
import type { Senales } from "@/lib/ads/senales";
import {
  formatearMonto,
  monedaConocida,
  montoComparable,
  normalizarMoneda,
  type Moneda,
  type Monto,
} from "@/lib/ads/moneda";

/**
 * EL ARQUITECTO DE CAMPAÑAS — núcleo puro: modelo, límites y validación.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ ES Y QUÉ NO ES
 *
 * El asistente de campañas que ya existía rellena un formulario: objetivo,
 * oferta, presupuesto, copies. Sirve cuando la persona ya sabe qué quiere
 * hacer. El Arquitecto resuelve el paso anterior —el que en la práctica frena
 * a todos— : «quiero clientes que necesiten abogado laboral en Santiago, tengo
 * $300.000 al mes». De ahí tiene que salir una campaña pensada: en qué
 * plataforma, por qué esa, con qué estructura, con qué palabras, a dónde manda
 * el clic, qué se va a medir y qué hipótesis se está probando.
 *
 * ⚠️ NO PUBLICA NADA. Ni en Meta ni en Google, y no es una limitación
 * temporal: es la misma decisión de producto de toda la sección. El plan se
 * guarda, se copia y se lleva a la plataforma a mano. «Preparado» nunca se
 * muestra como «publicado».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO ES PURO Y EL MODELO VIVE EN OTRO
 *
 * Todo lo que se puede decidir sin un modelo se decide acá: qué destinos son
 * posibles con las señales que hay, cómo se reparte el presupuesto, qué
 * límites de caracteres tiene cada plataforma, y si un plan está completo.
 * Al modelo se le pide solo lo que un modelo hace mejor —ángulos, palabras,
 * redacción— y todo lo que devuelve pasa por la validación de acá.
 *
 * El resultado práctico: un plan nunca puede quedar con un titular de 78
 * caracteres que Meta va a rechazar, ni con destino WhatsApp en un negocio que
 * no tiene WhatsApp, por más que el modelo lo escriba.
 */

/* ── A dónde puede ir el clic ─────────────────────────────────────────────── */

export type Destino = "whatsapp" | "sitio_web" | "formulario_meta" | "llamada";

export const ETIQUETA_DESTINO: Record<Destino, string> = {
  whatsapp: "WhatsApp",
  sitio_web: "Sitio web",
  formulario_meta: "Formulario en la plataforma",
  llamada: "Llamada telefónica",
};

/**
 * Los destinos POSIBLES para este negocio, con el motivo cuando no lo son.
 *
 * ⭐ Acá muere el supuesto «todo va a WhatsApp», que estaba escrito a fuego en
 * el asistente viejo (`destino: "whatsapp"` en el tipo y en el guardado). Un
 * estudio jurídico que manda al sitio y un e-commerce que manda al catálogo son
 * el caso normal, no la excepción.
 *
 * ⚠️ `whatsapp` exige la señal de conversaciones: ofrecerlo sin eso sería
 * prometer una medición que no va a existir —el anuncio llevaría a un WhatsApp
 * que Respondo no ve, y el plan mostraría un embudo que nunca se llena—.
 */
export function destinosPosibles(senales: Senales, tieneWhatsapp: boolean): {
  destino: Destino;
  posible: boolean;
  motivo?: string;
}[] {
  return [
    {
      destino: "sitio_web",
      posible: true,
    },
    {
      destino: "whatsapp",
      posible: tieneWhatsapp,
      motivo: tieneWhatsapp
        ? undefined
        : "Este negocio no tiene WhatsApp conectado a Respondo, así que no podríamos seguir la conversación ni medir qué pasó después del clic.",
    },
    {
      destino: "formulario_meta",
      posible: true,
      motivo: senales.conversaciones
        ? undefined
        : "Los datos del formulario quedan en la plataforma: hay que descargarlos desde ahí.",
    },
    {
      destino: "llamada",
      posible: true,
      motivo: "Una llamada no deja rastro en Respondo: se mide en la plataforma, no acá.",
    },
  ];
}

/* ── Límites reales de cada plataforma ────────────────────────────────────── */

/**
 * Los topes de caracteres. Están acá y no en la UI porque son una REGLA del
 * dominio: un titular de 41 caracteres no es feo, es rechazado.
 *
 * Meta: titular 40, texto principal 125 visibles (hasta 300 antes del «ver
 * más»), descripción 30. Google RSA: titulares 30, descripciones 90.
 */
export const LIMITES = {
  meta: { titular: 40, texto: 300, textoVisible: 125, descripcion: 30 },
  google: { titular: 30, descripcion: 90, titularesMin: 3, descripcionesMin: 2 },
} as const;

export function recortar(texto: string, max: number): string {
  const t = (texto ?? "").trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/* ── El plan ──────────────────────────────────────────────────────────────── */

export type PalabraClave = {
  texto: string;
  /** Concordancia sugerida. Exacta y de frase primero: gastan menos al probar. */
  concordancia: "exacta" | "frase" | "amplia";
};

export type GrupoPlanificado = {
  nombre: string;
  /** Solo Google. */
  palabras: PalabraClave[];
  negativasSugeridas: string[];
  titulares: string[];
  descripciones: string[];
};

export type ConjuntoPlanificado = {
  nombre: string;
  ubicacion: string;
  edadDesde: number | null;
  edadHasta: number | null;
  intereses: string[];
  nota: string;
};

export type CampanaPlanificada = {
  canal: Proveedor;
  nombre: string;
  /** El objetivo tal como se llama en la plataforma. */
  objetivo: string;
  /** Cantidad + moneda. Nunca un escalar suelto: ver `pisoDiarioDe`. */
  presupuestoDiario: Monto | null;
  destino: Destino;
  /** URL o número, según el destino. */
  destinoDetalle: string;
  /** Meta. */
  conjuntos: ConjuntoPlanificado[];
  /** Google. */
  grupos: GrupoPlanificado[];
};

export type AnguloCreativo = {
  nombre: string;
  /** Problema · educación · confianza · oferta · prueba social. */
  tipo: string;
  gancho: string;
  titular: string;
  texto: string;
  cta: string;
  /** Qué debería mostrar la imagen. Alimenta el Estudio creativo. */
  direccionVisual: string;
};

export type Tracking = {
  /** UTMs listos para pegar. Deterministas: el mismo plan da los mismos. */
  utm: { source: string; medium: string; campaign: string; content: string } | null;
  /** Qué se va a poder medir de verdad, y qué no. */
  loQueSeMide: string[];
  loQueNoSeMide: string[];
};

export type Hipotesis = {
  enunciado: string;
  senalPrincipal: string;
  senalesSecundarias: string[];
  /** La señal que solo Respondo puede dar, cuando existe. */
  senalRespondo: string | null;
};

export type PlanCampana = {
  objetivoNegocio: string;
  /** Cantidad + moneda, o null si la persona no declaró presupuesto. */
  presupuestoMensual: Monto | null;
  /**
   * La moneda del plan, incluso cuando no hay presupuesto declarado. Puede ser
   * `MONEDA_DESCONOCIDA` si el negocio no tiene ninguna cuenta conectada: en
   * ese caso el plan lo dice en vez de escribir «CLP» y que alguien lo crea.
   */
  moneda: Moneda;
  /** El piso que se usó para validar, con su origen. `null` = no se exigió. */
  piso: PisoDiario | null;
  duracionDias: number;
  estrategiaCanal: { canal: Proveedor; parte: number; porQue: string }[];
  campanas: CampanaPlanificada[];
  angulos: AnguloCreativo[];
  tracking: Tracking;
  hipotesis: Hipotesis;
  /** Lo que el plan NO puede prometer con lo que hay conectado hoy. */
  advertencias: string[];
};

/* ── Reparto de presupuesto ───────────────────────────────────────────────── */

/**
 * ⭐ NO SE REPARTE EL PRESUPUESTO A OJO.
 *
 * Dos reglas y las dos vienen de cómo funcionan las plataformas, no de un
 * gusto:
 *
 *  1. **Un piso por campaña.** Un presupuesto partido en cuatro deja cada
 *     campaña sin volumen para salir del aprendizaje, y ninguna llega a datos
 *     concluyentes: se gasta el mes entero sin aprender nada. Bajo el piso, se
 *     concentra en menos campañas en vez de repartir igual.
 *  2. **Intención primero.** Cuando alguien BUSCA lo que el negocio vende, ese
 *     clic vale más que una impresión a alguien que no estaba buscando. Con
 *     los dos canales disponibles, la mayor parte va a Búsqueda salvo que el
 *     objetivo sea claramente de generar demanda.
 */
/**
 * ⚠️ ACÁ ESTABA `PISO_DIARIO_CAMPANA = 2000`, Y ERA UN NÚMERO SIN MONEDA.
 *
 * 2.000 es un piso correcto **en pesos chilenos**. El código lo comparaba
 * contra cualquier presupuesto, viniera en la moneda que viniera. Una cuenta en
 * dólares con US$600 al mes —US$20 al día, un presupuesto perfectamente sano—
 * daba `20 < 2000`: el reparto se colapsaba a un solo canal y `revisarPlan`
 * marcaba la campaña como insuficiente. Para que el plan pasara la validación
 * había que declarar US$60.000 mensuales.
 *
 * Y el arreglo obvio —«si es USD entonces 2»— es el mismo error con una tabla
 * más larga: sigue siendo una constante de plata escrita a mano, sigue sin
 * saber qué moneda está mirando, y se rompe con la moneda número tres.
 *
 * ⭐ LO QUE EL PISO MIDE DE VERDAD NO ES PLATA: ES APRENDIZAJE.
 *
 * El motivo por el que existe —está escrito arriba— es que una campaña con
 * demasiado poco presupuesto no junta volumen para salir del aprendizaje y el
 * mes se gasta sin concluir nada. Eso se mide en CLICS POR DÍA, que es una
 * cantidad y no depende de ninguna moneda. La plata es la PROYECCIÓN de esa
 * cantidad, y el único tipo de cambio honesto para hacerla es el de la propia
 * cuenta: su costo por clic, en su moneda, medido en su historia.
 *
 * El orden, entonces:
 *   1. **Observado.** piso = CPC de la cuenta × clics diarios mínimos. Misma
 *      moneda que el presupuesto, sin inventar ningún tipo de cambio.
 *   2. **Configurado.** Si el negocio todavía no tiene historia, se usa la
 *      semilla declarada para esa moneda. Es CONFIGURACIÓN, es reemplazable, y
 *      el plan dice que el piso salió de ahí y no de sus datos.
 *   3. **Ninguno.** Si no hay historia y esa moneda no está configurada —o la
 *      moneda es desconocida— NO se exige piso y se dice por qué. Preferimos
 *      no opinar antes que bloquear un plan sano con una cifra inventada.
 */

/** Clics diarios con los que una campaña empieza a poder concluir algo. */
export const CLICS_DIARIOS_PARA_APRENDER = 8;

/**
 * Semillas por moneda, para el negocio que todavía no tiene historia propia.
 *
 * ⚠️ Solo CLP, y a propósito: es la única moneda de la que este producto tiene
 * evidencia real (cuentas chilenas operadas de verdad). Inventar una fila para
 * USD sería repetir el defecto en otra celda. Una instalación que opere en otra
 * moneda declara la suya —ver `semillasDeEntorno`— y mientras no lo haga el
 * sistema no exige piso en vez de exigir uno falso.
 */
export const PISOS_DIARIOS_SEMILLA: Readonly<Record<string, number>> = { CLP: 2000 };

/**
 * Lee las semillas de una variable de entorno con formato `CLP:2000,USD:5`.
 *
 * Vive acá, en el núcleo puro, porque es parseo de texto y se prueba sin nada
 * alrededor; el que lee `process.env` es el módulo de entrada/salida.
 */
export function semillasDeEntorno(crudo: string | undefined | null): Record<string, number> {
  const out: Record<string, number> = { ...PISOS_DIARIOS_SEMILLA };
  for (const par of String(crudo ?? "").split(",")) {
    const [m, v] = par.split(":");
    const moneda = normalizarMoneda(m);
    const valor = Number(String(v ?? "").trim());
    if (monedaConocida(moneda) && Number.isFinite(valor) && valor > 0) out[moneda] = valor;
  }
  return out;
}

export type PisoDiario = {
  monto: Monto;
  /** De dónde salió: de la cuenta de este negocio, o de la configuración. */
  origen: "observado" | "configurado";
  /** Explicación en una línea, para mostrarla junto a la cifra. */
  porQue: string;
};

/**
 * El piso diario por campaña, en la moneda del plan. `null` significa
 * literalmente «no se puede exigir un piso», no «el piso es cero».
 *
 * `cpc` tiene que venir en LA MISMA moneda que el plan. Si no coincide, se
 * ignora: convertirlo exigiría un tipo de cambio que no tenemos y que no vamos
 * a inventar.
 */
export function pisoDiarioDe(entrada: {
  moneda: Moneda;
  cpc?: Monto | null;
  semillas?: Record<string, number>;
}): PisoDiario | null {
  const moneda = normalizarMoneda(entrada.moneda);
  if (!monedaConocida(moneda)) return null;

  const cpc = entrada.cpc;
  if (montoComparable(cpc) && normalizarMoneda(cpc!.moneda) === moneda && cpc!.valor > 0) {
    return {
      monto: { valor: cpc!.valor * CLICS_DIARIOS_PARA_APRENDER, moneda },
      origen: "observado",
      porQue: `Para juntar unos ${CLICS_DIARIOS_PARA_APRENDER} clics al día al costo por clic que tiene hoy esta cuenta (${formatearMonto(cpc!)}).`,
    };
  }

  const semillas = entrada.semillas ?? PISOS_DIARIOS_SEMILLA;
  const semilla = semillas[moneda];
  if (Number.isFinite(semilla) && semilla > 0) {
    return {
      monto: { valor: semilla, moneda },
      origen: "configurado",
      porQue:
        "Este negocio todavía no tiene historial propio de costo por clic, así que se usa el mínimo configurado para esta moneda.",
    };
  }
  return null;
}

/**
 * El costo por clic de una cuenta, a partir de sus propias filas.
 *
 * ⚠️ Solo suma filas de UNA moneda —la que se pide— y nunca mezcla: un total
 * que junta pesos con dólares no es un total, es un número. Si no hay clics en
 * esa moneda, devuelve null y el piso pasa a la semilla.
 */
export function cpcDe(
  filas: { gasto: Monto; clics: number }[],
  moneda: Moneda,
): Monto | null {
  const m = normalizarMoneda(moneda);
  if (!monedaConocida(m)) return null;
  const propias = filas.filter((f) => montoComparable(f.gasto) && normalizarMoneda(f.gasto.moneda) === m);
  const clics = propias.reduce((a, f) => a + (Number.isFinite(f.clics) ? f.clics : 0), 0);
  if (clics <= 0) return null;
  const gasto = propias.reduce((a, f) => a + f.gasto.valor, 0);
  if (!(gasto > 0)) return null;
  return { valor: gasto / clics, moneda: m };
}

export type ParteDeCanal = { canal: Proveedor; parte: number; diario: Monto | null };

export function repartirPresupuesto(
  mensual: Monto | null,
  canales: Proveedor[],
  intencionDeBusqueda: boolean,
  piso: PisoDiario | null,
): ParteDeCanal[] {
  if (!canales.length) return [];

  /** El diario de una parte, en LA MISMA moneda que el mensual. */
  const diarioDe = (parte: number): Monto | null =>
    mensual === null ? null : { valor: (mensual.valor * parte) / 30, moneda: mensual.moneda };

  if (canales.length === 1) {
    return [{ canal: canales[0], parte: 1, diario: diarioDe(1) }];
  }
  const aGoogle = intencionDeBusqueda ? 0.65 : 0.35;
  const partes: Record<Proveedor, number> = { google: aGoogle, meta: 1 - aGoogle };

  const reparto: ParteDeCanal[] = canales.map((canal) => ({
    canal,
    parte: partes[canal],
    diario: diarioDe(partes[canal]),
  }));

  /**
   * Si el reparto deja alguna por debajo del piso, NO se reparte: se concentra
   * todo en la que la estrategia priorizó. Es preferible probar bien un canal
   * que probar mal dos.
   *
   * ⚠️ Y si NO hay piso conocido —cuenta sin historia en una moneda que no está
   * configurada— no se concentra nada. Antes esa misma rama se ejecutaba igual
   * comparando contra 2.000 «lo que fuera», y a una cuenta en dólares le mataba
   * el segundo canal sin que nadie se lo pidiera. No saber el piso es no saber,
   * no es «está bajo el piso».
   */
  if (!piso || mensual === null) return reparto;
  if (!mismaMoneda(mensual, piso.monto)) return reparto;

  if (reparto.some((r) => (r.diario?.valor ?? 0) < piso.monto.valor)) {
    const principal = intencionDeBusqueda
      ? canales.includes("google")
        ? "google"
        : canales[0]
      : canales.includes("meta")
        ? "meta"
        : canales[0];
    return [{ canal: principal as Proveedor, parte: 1, diario: diarioDe(1) }];
  }
  return reparto;
}

/** Dos montos que se pueden comparar de verdad: ambos con moneda y la misma. */
function mismaMoneda(a: Monto | null | undefined, b: Monto | null | undefined): boolean {
  return (
    montoComparable(a) && montoComparable(b) && normalizarMoneda(a!.moneda) === normalizarMoneda(b!.moneda)
  );
}

/**
 * ¿La demanda de esto se BUSCA o hay que despertarla?
 *
 * Heurística explícita y auditable, no un modelo: si el objetivo menciona algo
 * que la gente teclea cuando ya tiene el problema («abogado laboral»,
 * «cotizar», «reparación»), hay intención de búsqueda. Si es una oferta que
 * nadie busca por su nombre, hay que generar demanda.
 *
 * Se deja acá, en el núcleo puro, porque es la decisión que más plata mueve del
 * plan entero y tiene que poder probarse sin llamar a ningún proveedor.
 */
/**
 * ⚠️ SIN `\b` AL FINAL, y no es un descuido: varias entradas son PREFIJOS
 * («abogad» para abogado/abogada/abogados). Un límite de palabra después del
 * prefijo exige que la siguiente letra no sea una letra, así que «abogado»
 * NUNCA coincidía y la heurística devolvía «no hay intención de búsqueda»
 * justo para el caso más claro que existe. Lo atrapó el test de la Fase 6.
 */
const SENAL_BUSQUEDA =
  /\b(abogad|contador|dentist|kinesiolog|veterinari|cerrajer|gasfiter|electricist|mec[aá]nic|reparaci[oó]n|arreglo|urgencia|cotiza|presupuesto|precio|comprar|contratar|servicio t[eé]cnico|instalaci[oó]n|imprenta|impresi[oó]n|notar[ií]a|arriendo|venta de)/i;

export function hayIntencionDeBusqueda(objetivo: string): boolean {
  return SENAL_BUSQUEDA.test(objetivo ?? "");
}

/* ── Tracking ─────────────────────────────────────────────────────────────── */

/** Un slug corto y estable para las UTM. Mismo texto → mismo slug. */
export function slug(texto: string, max = 40): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/**
 * El tracking que se puede prometer, con lo que hay conectado.
 *
 * ⚠️ **Nunca se afirma que algo se mide si no está configurado.** Un plan que
 * promete «vas a ver qué anuncio trajo cada venta» en un negocio sin
 * conversaciones ni enlace de pago es la mentira más cara que puede decir este
 * producto, porque se descubre recién un mes después.
 */
export function armarTracking(
  objetivo: string,
  destino: Destino,
  canal: Proveedor,
  senales: Senales,
): Tracking {
  const campaign = slug(objetivo);
  const utm =
    destino === "sitio_web"
      ? {
          source: canal === "google" ? "google" : "meta",
          medium: "cpc",
          campaign: campaign || "campana",
          content: "{{ad.name}}",
        }
      : null;

  const mide: string[] = [];
  const noMide: string[] = [];

  if (senales.ads) mide.push("Inversión, impresiones, clics y costo por clic, por campaña y por anuncio.");
  if (senales.conversiones) mide.push("Las conversiones que la plataforma ya tiene configuradas en la cuenta.");

  if (destino === "whatsapp") {
    if (senales.conversaciones) {
      mide.push("Cada conversación que llegó por el anuncio, con su etapa y su resultado.");
      if (senales.ingresos) mide.push("La plata cobrada por enlace de pago en esas conversaciones.");
      else noMide.push("La plata: sin enlace de pago no se puede atribuir una venta a un anuncio.");
    } else {
      noMide.push(
        "Lo que pasa después del clic: este negocio no trae las conversaciones de WhatsApp a Respondo.",
      );
    }
  }
  if (destino === "sitio_web") {
    noMide.push(
      "Qué hace la persona dentro del sitio: eso lo mide la analítica del sitio, no Respondo. Los UTM de arriba son lo que permite cruzarlo después.",
    );
  }
  if (destino === "formulario_meta") {
    noMide.push("Los datos del formulario quedan en la plataforma y hay que descargarlos desde ahí.");
  }
  if (destino === "llamada") {
    noMide.push("Una llamada no deja rastro en Respondo: la cuenta la lleva la plataforma.");
  }

  return { utm, loQueSeMide: mide, loQueNoSeMide: noMide };
}

/* ── Validación del plan ──────────────────────────────────────────────────── */

export type ProblemaPlan = { campo: string; problema: string };

/**
 * Revisa que el plan se pueda ejecutar de verdad.
 *
 * Esto NO es validación de formulario: es la última barrera entre lo que
 * escribió un modelo y lo que una persona va a copiar y pegar en Meta. Cada
 * regla de acá existe porque la plataforma rechaza, recorta o ignora.
 */
export function revisarPlan(plan: PlanCampana): ProblemaPlan[] {
  const problemas: ProblemaPlan[] = [];
  const piso = plan.piso;

  if (!plan.campanas.length) problemas.push({ campo: "campañas", problema: "El plan no tiene ninguna campaña." });

  for (const c of plan.campanas) {
    if (c.canal === "google") {
      for (const g of c.grupos) {
        if (g.titulares.length < LIMITES.google.titularesMin) {
          problemas.push({
            campo: `grupo «${g.nombre}»`,
            problema: `Google pide al menos ${LIMITES.google.titularesMin} titulares por anuncio; hay ${g.titulares.length}.`,
          });
        }
        if (g.descripciones.length < LIMITES.google.descripcionesMin) {
          problemas.push({
            campo: `grupo «${g.nombre}»`,
            problema: `Google pide al menos ${LIMITES.google.descripcionesMin} descripciones; hay ${g.descripciones.length}.`,
          });
        }
        if (!g.palabras.length) {
          problemas.push({ campo: `grupo «${g.nombre}»`, problema: "Un grupo de búsqueda sin palabras clave no puede mostrarse." });
        }
        /**
         * La verificación que salvó una cuenta real: una negativa que choca con
         * una palabra clave propia deja ciego al grupo completo.
         */
        for (const n of g.negativasSugeridas) {
          const choca = g.palabras.find((p) => p.texto.toLowerCase().includes(n.toLowerCase()));
          if (choca) {
            problemas.push({
              campo: `grupo «${g.nombre}»`,
              problema: `La negativa «${n}» bloquearía la palabra clave «${choca.texto}» del mismo grupo.`,
            });
          }
        }
      }
    } else {
      if (!c.conjuntos.length) {
        problemas.push({ campo: `campaña «${c.nombre}»`, problema: "Una campaña de Meta necesita al menos un conjunto de anuncios." });
      }
    }
    /**
     * ⚠️ El piso se exige SOLO cuando se conoce, y comparando dos montos de la
     * misma moneda. Antes esto comparaba el diario contra 2.000 sin mirar en
     * qué moneda estaba: una campaña de US$20 al día se marcaba como
     * insuficiente y el plan quedaba trabado con un problema falso.
     */
    if (piso && mismaMoneda(c.presupuestoDiario, piso.monto) && c.presupuestoDiario!.valor < piso.monto.valor) {
      problemas.push({
        campo: `campaña «${c.nombre}»`,
        problema: `Con menos de ${formatearMonto(piso.monto)} al día la campaña no junta datos suficientes para decidir nada. ${piso.porQue}`,
      });
    }
  }

  if (plan.angulos.length < 2) {
    problemas.push({
      campo: "creatividades",
      problema: "Un solo ángulo no se puede comparar contra nada: hacen falta al menos dos para aprender algo.",
    });
  }

  return problemas;
}

/**
 * El plan, en texto plano para copiar y pegar en la plataforma.
 *
 * Existe porque Respondo NO publica: este texto es literalmente el puente entre
 * pensar la campaña acá y armarla allá. Por eso lleva todo lo que el formulario
 * de Meta o de Google va a pedir, en el mismo orden en que lo pide.
 */
export function planEnTexto(plan: PlanCampana): string {
  const L: string[] = [];
  /**
   * Un monto se escribe con su moneda o no se escribe. Si la moneda es
   * desconocida sale el número pelado —que es exactamente lo que sabemos— y
   * más abajo el plan dice en qué moneda hay que interpretarlo.
   */
  const monto = (m: Monto | null) => (m === null ? "—" : formatearMonto(m));

  L.push(`PLAN: ${plan.objetivoNegocio}`);
  L.push(
    `Presupuesto: ${monto(plan.presupuestoMensual)} al mes · ${plan.duracionDias} días` +
      (plan.presupuestoMensual && !monedaConocida(plan.moneda)
        ? " · ⚠️ las cifras están en la moneda que configures en la plataforma: todavía no hay ninguna cuenta publicitaria conectada de la que leerla"
        : ""),
  );
  L.push("");
  L.push("ESTRATEGIA DE CANAL");
  for (const e of plan.estrategiaCanal) {
    L.push(`· ${e.canal === "google" ? "Google Ads" : "Meta"} (${Math.round(e.parte * 100)}%): ${e.porQue}`);
  }

  for (const c of plan.campanas) {
    L.push("");
    L.push(`── CAMPAÑA (${c.canal === "google" ? "Google Ads" : "Meta"}): ${c.nombre}`);
    L.push(`Objetivo: ${c.objetivo}`);
    L.push(`Presupuesto diario: ${monto(c.presupuestoDiario)}`);
    L.push(`Destino: ${ETIQUETA_DESTINO[c.destino]}${c.destinoDetalle ? ` → ${c.destinoDetalle}` : ""}`);
    for (const g of c.grupos) {
      L.push(`  Grupo: ${g.nombre}`);
      L.push(`    Palabras: ${g.palabras.map((p) => `${p.texto} [${p.concordancia}]`).join(" · ")}`);
      if (g.negativasSugeridas.length) L.push(`    Negativas sugeridas: ${g.negativasSugeridas.join(" · ")}`);
      L.push(`    Titulares: ${g.titulares.join(" | ")}`);
      L.push(`    Descripciones: ${g.descripciones.join(" | ")}`);
    }
    for (const cj of c.conjuntos) {
      L.push(`  Conjunto: ${cj.nombre}`);
      L.push(`    Ubicación: ${cj.ubicacion}`);
      L.push(`    Edad: ${cj.edadDesde ?? "—"} a ${cj.edadHasta ?? "—"}`);
      if (cj.intereses.length) L.push(`    Intereses: ${cj.intereses.join(" · ")}`);
      if (cj.nota) L.push(`    Nota: ${cj.nota}`);
    }
  }

  L.push("");
  L.push("ÁNGULOS CREATIVOS");
  for (const a of plan.angulos) {
    L.push(`· [${a.tipo}] ${a.nombre}`);
    L.push(`  Gancho: ${a.gancho}`);
    L.push(`  Titular: ${a.titular}`);
    L.push(`  Texto: ${a.texto}`);
    L.push(`  CTA: ${a.cta}`);
    L.push(`  Imagen: ${a.direccionVisual}`);
  }

  if (plan.tracking.utm) {
    const u = plan.tracking.utm;
    L.push("");
    L.push("TRACKING (UTM para el enlace de destino)");
    L.push(`utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${u.campaign}&utm_content=${u.content}`);
  }

  L.push("");
  L.push("HIPÓTESIS");
  L.push(plan.hipotesis.enunciado);
  L.push(`Señal principal: ${plan.hipotesis.senalPrincipal}`);
  if (plan.hipotesis.senalesSecundarias.length) {
    L.push(`Señales secundarias: ${plan.hipotesis.senalesSecundarias.join(" · ")}`);
  }
  if (plan.hipotesis.senalRespondo) L.push(`Señal de Respondo: ${plan.hipotesis.senalRespondo}`);

  if (plan.advertencias.length) {
    L.push("");
    L.push("LO QUE ESTE PLAN NO PUEDE PROMETER");
    for (const a of plan.advertencias) L.push(`· ${a}`);
  }

  return L.join("\n");
}
