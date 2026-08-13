import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Copia deliberada de la constante de lib/fechas.ts.
 *
 * Este módulo se testea con `node --test`, que no resuelve el alias `@/`. Los
 * otros módulos con test (agendaCore, fichaServicio, autogestion) siguen la
 * misma regla: cero imports de runtime. Es una línea duplicada a cambio de que
 * la lógica que decide cuánto se le cobra a un cliente tenga tests.
 */
const ZONA = "America/Santiago";

/**
 * CUPO DE CONVERSACIONES — la unidad que Respondo vende.
 *
 * Desde el 12-ago-2026 los planes se venden por conversaciones incluidas al
 * mes. Este módulo es el que las cuenta, calcula el porcentaje usado y decide
 * cuándo hay que avisar. La definición vive en la migración 278 y en
 * estrategia-comercial/PLANES_Y_PRECIOS_RESPONDO.md — si acá y allá dicen
 * cosas distintas, manda el documento comercial.
 *
 * Una conversación = todo el contacto con un mismo cliente dentro de una
 * ventana de 24 h corridas, sin importar cuántos mensajes. No cuenta si nadie
 * respondió.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN:
 *
 *  1. NUNCA se corta el servicio. Pasarse del cupo genera un aviso y un cobro
 *     de excedente, jamás un silencio. Cliengo corta; una pyme sin atención a
 *     mitad de mes pierde ventas y nos culpa a nosotros.
 *  2. Sin plan asignado no se avisa nada. Un cliente con plan NULL ve su
 *     consumo pero no recibe alertas. Así, si el contador tuviera un error,
 *     no le llega un mensaje equivocado a nadie.
 *
 * TODO ES DEFENSIVO: si la migración 278 no está aplicada, estadoDeCupo()
 * devuelve null y el portal simplemente no muestra el widget.
 */

// ---------------------------------------------------------------------------
// Los planes (espejo de la tabla comercial)
// ---------------------------------------------------------------------------

export type NombrePlan = "tino_solo" | "inicial" | "crecimiento" | "empresa" | "a_medida";

export type DefinicionPlan = {
  etiqueta: string;
  precio: number;
  /** Conversaciones incluidas. null en 'a_medida': se lee de la fila del cliente. */
  cupo: number | null;
  /** Pack de excedente: cuántas conversaciones y a qué precio. */
  pack: { tamano: number; precio: number } | null;
};

export const PLANES: Record<NombrePlan, DefinicionPlan> = {
  tino_solo: {
    etiqueta: "Tino solo",
    precio: 120_000,
    cupo: 800,
    pack: { tamano: 200, precio: 18_000 },
  },
  inicial: {
    etiqueta: "Inicial",
    precio: 149_990,
    cupo: 1_200,
    pack: { tamano: 300, precio: 24_000 },
  },
  crecimiento: {
    etiqueta: "Crecimiento",
    precio: 269_990,
    cupo: 3_000,
    pack: { tamano: 500, precio: 30_000 },
  },
  empresa: {
    etiqueta: "Empresa",
    precio: 449_990,
    cupo: 6_000,
    pack: { tamano: 1_000, precio: 50_000 },
  },
  a_medida: {
    etiqueta: "A medida",
    precio: 0,
    cupo: null,
    pack: null,
  },
};

export function esPlanConocido(valor: string | null | undefined): valor is NombrePlan {
  return typeof valor === "string" && valor in PLANES;
}

// ---------------------------------------------------------------------------
// El ciclo de facturación
// ---------------------------------------------------------------------------

export type Ciclo = {
  /** '2026-08' — la llave con la que se registran los avisos. */
  id: string;
  desdeIso: string;
  hastaIso: string;
  /** Días completos que faltan para que termine el ciclo. */
  diasRestantes: number;
  /** Días ya transcurridos, mínimo 1 (para poder proyectar el día 1). */
  diasCorridos: number;
  /** Días que tiene el mes. 28, 29, 30 o 31. */
  diasDelCiclo: number;
};

/**
 * El ciclo es el MES CALENDARIO chileno, no la fecha de contrato del cliente.
 * Es lo más fácil de explicar ("tu cupo va del 1 al último día del mes") y
 * evita tener que guardar y mantener un día de corte por cliente. Si algún día
 * hace falta el corte por fecha de contrato, este es el único punto a cambiar.
 *
 * Se ancla en -04:00 igual que inicioDeMesChile(): Chile va entre UTC-3 y
 * UTC-4, así que ese offset siempre cae dentro del día correcto. En horario de
 * verano el corte queda una hora antes; es el mismo criterio que ya usa el
 * resto de las métricas del portal y conviene que todas cuenten igual.
 */
export function cicloActual(ahora: Date = new Date()): Ciclo {
  const [anio, mes] = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
  })
    .format(ahora)
    .split("-")
    .map(Number);

  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  const desde = new Date(`${anio}-${dosDigitos(mes)}-01T00:00:00-04:00`);
  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig = mes === 12 ? 1 : mes + 1;
  const hasta = new Date(`${anioSig}-${dosDigitos(mesSig)}-01T00:00:00-04:00`);

  const DIA = 86_400_000;
  // diasRestantes se DERIVA de los otros dos en vez de calcularse aparte.
  // Calculando ambos con Math.ceil, el día en curso se contaba dos veces y
  // agosto daba 32 días: la proyección salía inflada. Lo atrapó un test.
  const diasDelCiclo = Math.round((hasta.getTime() - desde.getTime()) / DIA);
  const diasCorridos = Math.min(
    diasDelCiclo,
    Math.max(1, Math.ceil((ahora.getTime() - desde.getTime()) / DIA)),
  );

  return {
    id: `${anio}-${dosDigitos(mes)}`,
    desdeIso: desde.toISOString(),
    hastaIso: hasta.toISOString(),
    diasDelCiclo,
    diasCorridos,
    diasRestantes: diasDelCiclo - diasCorridos,
  };
}

// ---------------------------------------------------------------------------
// Lógica pura (lo que se testea)
// ---------------------------------------------------------------------------

/** Porcentaje usado, redondeado y sin tope: pasarse del 100% es un estado válido. */
export function porcentajeUsado(consumo: number, cupo: number): number {
  if (cupo <= 0) return 0;
  return Math.round((consumo / cupo) * 100);
}

/**
 * Umbral que corresponde avisar, o null si no hay nada que avisar.
 *
 * Devuelve SIEMPRE el umbral más alto alcanzado. Si un cliente salta de 70% a
 * 105% entre dos corridas del cron, se avisa el 100% y no el 80%: mandarle los
 * dos mensajes seguidos sería ruido.
 */
export function umbralAlcanzado(consumo: number, cupo: number): 80 | 100 | null {
  if (cupo <= 0) return null;
  // Sobre la razón exacta, NO sobre el porcentaje redondeado. Con el
  // porcentaje, 959 de 1.200 (79,9%) redondeaba a 80 y disparaba el aviso
  // antes de tiempo: el cliente recibía "usaste el 80%" cuando no era cierto.
  const razon = consumo / cupo;
  if (razon >= 1) return 100;
  if (razon >= 0.8) return 80;
  return null;
}

/** Consumo proyectado al cierre del ciclo, al ritmo actual. */
export function proyeccionFinDeCiclo(consumo: number, ciclo: Ciclo): number {
  return Math.round((consumo / ciclo.diasCorridos) * ciclo.diasDelCiclo);
}

export type Excedente = { packs: number; conversaciones: number; costo: number };

/**
 * Cuánto excedente se le cobra a un cliente que se pasó.
 * Se cobra por PACK completo, no por conversación suelta: es más fácil de
 * explicar en la factura y es como lo vende el mercado (Cliengo, SuperPyme).
 */
export function costoExcedente(
  consumo: number,
  cupo: number,
  plan: DefinicionPlan,
): Excedente {
  const sobrante = consumo - cupo;
  if (sobrante <= 0 || !plan.pack) return { packs: 0, conversaciones: 0, costo: 0 };
  const packs = Math.ceil(sobrante / plan.pack.tamano);
  return {
    packs,
    conversaciones: sobrante,
    costo: packs * plan.pack.precio,
  };
}

// ---------------------------------------------------------------------------
// Lectura contra la base
// ---------------------------------------------------------------------------

export type EstadoCupo = {
  clienteId: string;
  plan: NombrePlan | null;
  etiquetaPlan: string | null;
  consumo: number;
  /** Cupo del plan + packs adicionales comprados. null = sin límite configurado. */
  cupo: number | null;
  porcentaje: number | null;
  proyeccion: number;
  excedente: Excedente | null;
  ciclo: Ciclo;
};

type FilaCliente = {
  plan: string | null;
  cupo_conversaciones: number | null;
  conversaciones_extra: number | null;
};

/**
 * Estado de cupo de un cliente en el ciclo en curso.
 * Devuelve null si la migración 278 no está aplicada o si algo falla: el
 * widget de cupo nunca puede tumbar el panel.
 */
export async function estadoDeCupo(
  clienteId: string,
  supa: SupabaseClient,
  ahora: Date = new Date(),
): Promise<EstadoCupo | null> {
  const ciclo = cicloActual(ahora);
  try {
    const { data: fila, error: errCliente } = await supa
      .from("ed_clientes")
      .select("plan, cupo_conversaciones, conversaciones_extra")
      .eq("id", clienteId)
      .maybeSingle();
    if (errCliente || !fila) return null; // migración 278 pendiente

    const { data: consumoBruto, error: errRpc } = await supa.rpc("ed_contar_conversaciones", {
      p_cliente: clienteId,
      p_desde: ciclo.desdeIso,
      p_hasta: ciclo.hastaIso,
    });
    if (errRpc) return null; // la función todavía no existe

    const c = fila as FilaCliente;
    const consumo = Number(consumoBruto ?? 0);
    const plan = esPlanConocido(c.plan) ? c.plan : null;
    const definicion = plan ? PLANES[plan] : null;

    // El cupo explícito de la fila manda sobre el del plan: así se acomoda un
    // trato puntual sin inventar un plan nuevo.
    const base = c.cupo_conversaciones ?? definicion?.cupo ?? null;
    const cupo = base === null ? null : base + (c.conversaciones_extra ?? 0);

    return {
      clienteId,
      plan,
      etiquetaPlan: definicion?.etiqueta ?? null,
      consumo,
      cupo,
      porcentaje: cupo === null ? null : porcentajeUsado(consumo, cupo),
      proyeccion: proyeccionFinDeCiclo(consumo, ciclo),
      excedente: cupo !== null && definicion ? costoExcedente(consumo, cupo, definicion) : null,
      ciclo,
    };
  } catch {
    return null;
  }
}

/**
 * ¿Hay que avisarle a este cliente y no se le avisó ya en este ciclo?
 *
 * El registro del aviso se inserta ACÁ, antes de mandar nada, y el índice
 * único de ed_avisos_cupo es lo que garantiza que no se repita. El cron corre
 * cada 5 minutos: sin esa barrera, un cliente al 81% recibiría 288 mensajes
 * al día. Si el envío posterior falla, el aviso se pierde — es preferible a
 * una avalancha.
 */
export async function reservarAviso(
  estado: EstadoCupo,
  supa: SupabaseClient,
): Promise<80 | 100 | null> {
  if (estado.plan === null || estado.cupo === null) return null; // sin plan, sin avisos
  const umbral = umbralAlcanzado(estado.consumo, estado.cupo);
  if (umbral === null) return null;

  try {
    const { error } = await supa.from("ed_avisos_cupo").insert({
      cliente_id: estado.clienteId,
      ciclo: estado.ciclo.id,
      umbral,
      consumo: estado.consumo,
      cupo: estado.cupo,
    });
    // 23505 = choque con el índice único: ya se avisó. Es el camino normal.
    if (error) return null;
    return umbral;
  } catch {
    return null;
  }
}

/** El texto que se le manda al dueño del negocio. Sin tecnicismos y sin alarmar. */
export function mensajeDeAviso(estado: EstadoCupo, umbral: 80 | 100): string {
  // Miles con punto, como se escriben en Chile. Mandar "1200" en un mensaje al
  // dueño de un negocio se lee como descuido.
  const n = (v: number) => v.toLocaleString("es-CL");
  const cupo = n(estado.cupo ?? 0);
  const pack = estado.plan ? PLANES[estado.plan].pack : null;

  if (umbral === 80) {
    return [
      `Hola 👋 Te contamos que ya usaste ${n(estado.consumo)} de las ${cupo} conversaciones de tu plan este mes.`,
      estado.ciclo.diasRestantes > 0
        ? `Quedan ${estado.ciclo.diasRestantes} días de ciclo.`
        : "El ciclo termina hoy.",
      "Tu asistente sigue funcionando con normalidad. Te avisamos por si quieres ampliar el plan.",
    ].join(" ");
  }

  return [
    `Hola 👋 Llegaste a las ${cupo} conversaciones incluidas en tu plan este mes.`,
    // Negrita de WhatsApp: UN asterisco a cada lado. Con dos, el dueño recibe
    // los asteriscos literales en pantalla.
    "Tu asistente *sigue atendiendo con normalidad*, no se corta nada.",
    pack
      ? `Las conversaciones adicionales se cobran en packs de ${n(pack.tamano)} a $${n(pack.precio)}.`
      : "",
    "Cualquier duda nos escribes.",
  ]
    .filter(Boolean)
    .join(" ");
}
