/**
 * ETAPAS DEL EMBUDO Y SUS MOTIVOS — definición única y pura (Fase 1, sep-2026).
 *
 * Antes vivían en lib/embudo.ts, que importa la base de datos. Componentes de
 * cliente (PanelChat, TarjetaEmbudo) importaban de ahí solo para pintar una
 * píldora y arrastraban `db` al bundle del navegador. Ahora el catálogo es
 * puro: lo usan el servidor, el cliente y los tests con la misma definición.
 *
 * ⚠️ NO IMPORTAR NADA CON RED O NEXT ACÁ.
 */

export type Etapa = "nuevo" | "interesado" | "cotizado" | "ganado" | "perdido";

export const ETAPAS: {
  valor: Etapa;
  label: string;
  descripcion: string;
  color: string;
  fondo: string;
}[] = [
  {
    valor: "nuevo",
    label: "Nuevo",
    descripcion: "Escribió; el asistente aún no detecta intención",
    color: "#475569",
    fondo: "#F1F5F9",
  },
  {
    valor: "interesado",
    label: "Interesado",
    descripcion: "Muestra intención de compra",
    color: "#9A3412",
    fondo: "#FFF7ED",
  },
  {
    valor: "cotizado",
    label: "Cotizado",
    descripcion: "Ya tiene precio o propuesta",
    color: "#92400E",
    fondo: "#FEF9C3",
  },
  {
    valor: "ganado",
    label: "Ganado",
    descripcion: "Compró o agendó",
    color: "#166534",
    fondo: "#DCFCE7",
  },
  {
    valor: "perdido",
    label: "Perdido",
    descripcion: "No prosperó",
    color: "#7F1D1D",
    fondo: "#FEE2E2",
  },
];

export function metaEtapa(valor: string) {
  return ETAPAS.find((e) => e.valor === valor) ?? ETAPAS[0];
}

export function esEtapa(valor: unknown): valor is Etapa {
  return typeof valor === "string" && ETAPAS.some((e) => e.valor === valor);
}

/** Orden del embudo: se usa para no retroceder de etapa automáticamente. */
export const ORDEN_ETAPA: Record<Etapa, number> = {
  nuevo: 0,
  interesado: 1,
  cotizado: 2,
  ganado: 3,
  perdido: 3, // terminal, mismo nivel que ganado
};

/** Días de silencio (habló el negocio último) para cerrar como perdido. */
export const DIAS_SILENCIO = 7;

/** Motivo que se guarda en ed_contactos.etapa_motivo (migración 251). */
export const MOTIVO_SILENCIO = "sin_respuesta";

/**
 * MOTIVOS DE PÉRDIDA (Fase 1).
 *
 * `etapa_motivo` es texto libre (migración 251, sin CHECK). Hasta ahora el
 * único motivo de pérdida que existía era `sin_respuesta` (lo pone el reloj);
 * una persona que movía a Perdido dejaba el motivo en null, así que no había
 * forma de distinguir «no contestó» de «dijo que no».
 *
 * La diferencia importa por Beto: «sin respuesta» NO es un rechazo y se puede
 * retomar; un rechazo explícito no se toca nunca. `explicita` es esa frontera.
 */
export const MOTIVOS_PERDIDA = [
  { valor: "sin_respuesta", label: "Sin respuesta", explicita: false },
  { valor: "no_interesado", label: "No le interesó", explicita: true },
  { valor: "eligio_competencia", label: "Eligió a otro", explicita: true },
  { valor: "no_contactar", label: "Pidió que no lo contacten", explicita: true },
  { valor: "otro", label: "Otro motivo", explicita: true },
] as const;

export type MotivoPerdida = (typeof MOTIVOS_PERDIDA)[number]["valor"];

export function esMotivoPerdida(valor: unknown): valor is MotivoPerdida {
  return typeof valor === "string" && MOTIVOS_PERDIDA.some((m) => m.valor === valor);
}

/** Perdido porque nadie contestó: la única pérdida que Beto puede retomar. */
export function esPerdidoPorSilencio(etapa: string | null | undefined, motivo: string | null | undefined): boolean {
  return etapa === "perdido" && motivo === MOTIVO_SILENCIO;
}

/**
 * MOTIVO AL CERRAR POR SILENCIO (Fase 1, revisión).
 *
 * Una persona marca «no le interesó» y después pulsa «que la maneje el
 * asistente»: la etapa vuelve a calcularse desde las señales (cotizado) y, a
 * los 7 días, el reloj la cerraría como `sin_respuesta` — que Beto SÍ retoma.
 * Eso contradice lo que la persona dijo. Si hay una pérdida explícita guardada
 * y el cliente no escribió después de ella, el cierre repite ese motivo. Si el
 * cliente volvió a escribir, es un ciclo nuevo y el silencio es silencio.
 */
export function motivoCierrePorSilencio(
  datos: unknown,
  ultimoRol: string | null | undefined,
  ultimoEn: string | null | undefined,
): string {
  const previa =
    datos && typeof datos === "object" && !Array.isArray(datos)
      ? ((datos as Record<string, unknown>).ultima_perdida as Record<string, unknown> | undefined)
      : undefined;
  const motivo = typeof previa?.motivo === "string" ? previa.motivo : null;
  const explicita = MOTIVOS_PERDIDA.find((m) => m.valor === motivo && m.explicita);
  if (!explicita) return MOTIVO_SILENCIO;
  const en = typeof previa?.en === "string" ? Date.parse(previa.en) : NaN;
  const escribioDespues =
    ultimoRol === "cliente" && !!ultimoEn && (!Number.isFinite(en) || Date.parse(ultimoEn) > en);
  return escribioDespues ? MOTIVO_SILENCIO : explicita.valor;
}

/**
 * Texto corto del motivo, para mostrar junto a la etapa. Null cuando el motivo
 * no agrega nada (una subida normal por señales del asistente).
 */
export function etiquetaMotivoEtapa(etapa: string, motivo: string | null | undefined): string | null {
  if (etapa === "perdido") {
    const m = MOTIVOS_PERDIDA.find((x) => x.valor === motivo);
    return m ? m.label : "Sin motivo registrado";
  }
  if (etapa === "ganado") {
    if (motivo === "pago_detectado") return "Dijo que pagó";
    if (motivo === "pago_confirmado") return "Pago confirmado";
    if (motivo === "nuevo_ciclo") return "Nueva compra";
    return null;
  }
  if (motivo === "volvio_a_escribir") return "Volvió a escribir";
  if (motivo === "nuevo_ciclo") return "Nuevo ciclo";
  return null;
}

/**
 * PÉRDIDA ANTERIOR (Fase 1). Cuando un perdido se reabre (volvió a escribir, o
 * una persona lo saca de Perdido), `etapa_motivo` pasa a describir la etapa
 * nueva y el motivo de la pérdida se perdía. Se conserva en
 * `ed_contactos.datos.ultima_perdida` —sin migración— para que la ficha diga
 * «antes estaba perdido: sin respuesta» y nadie trate a quien dijo que no como
 * a quien no contestó.
 *
 * Devuelve un objeto nuevo; no toca las demás claves de `datos` (atribución).
 */
export function datosConPerdidaAnterior(
  datos: unknown,
  motivo: string | null | undefined,
  en: string | null | undefined,
): Record<string, unknown> {
  const base = datos && typeof datos === "object" && !Array.isArray(datos) ? (datos as Record<string, unknown>) : {};
  return { ...base, ultima_perdida: { motivo: motivo ?? null, en: en ?? null } };
}
