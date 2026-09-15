import type { Capacidades } from "@/lib/marketing/capacidades";
import type { CodigoErrorAds } from "@/lib/ads/proveedor";
import type { FilaRendimiento, Proveedor, TipoResultado } from "@/lib/ads/canal";
import type { Analisis } from "@/lib/ads/analisis";
import type { FallaCanal } from "@/lib/ads/canales";
import type { Profundidad, Senales } from "@/lib/ads/senales";
import type { Destino, PlanCampana } from "@/lib/marketing/arquitectoCore";
import type { GrupoMetricas } from "@/lib/ads/metricas";
import type { Hallazgo } from "@/lib/ads/insights";
import type { Rango } from "@/lib/ads/periodos";
import type { ItemPauta } from "@/lib/ads/estado";

/**
 * EL VOCABULARIO DE MARKETING — un solo conjunto de formas para todo el centro.
 *
 * Hay DOS proveedores de estos datos y los dos devuelven exactamente estas
 * formas: la carga real (`datos.ts`, que compone la atribución, Meta y las
 * tablas del negocio) y la demostración (`demo.ts`, fixtures deterministas).
 * Las pantallas no saben cuál de los dos las alimenta, y eso es lo que
 * garantiza que la demo muestre lo mismo que va a mostrar la realidad —ni un
 * campo más ni uno menos.
 *
 * Se mantiene la CERTEZA de `lib/ads/metricas.ts`: ninguna cifra viaja sin
 * decir si fue medida, derivada, es parcial o no está disponible.
 */

/** Un día de la serie principal. Los campos de Meta son null sin conexión. */
export type PuntoDiario = {
  /** AAAA-MM-DD en hora de Chile. */
  dia: string;
  gasto: number | null;
  impresiones: number | null;
  clics: number | null;
  conversaciones: number;
  calificados: number;
  ventas: number;
  cobrado: number;
};

/**
 * Los cinco escalones que solo Respondo puede ver de punta a punta.
 *
 * «Calificado» tiene una definición y no una opinión: la conversación avanzó
 * a `interesado` o más en el embudo, o registró una cotización, reserva o
 * venta. Es la etapa que el propio negocio mueve con la mano cuando quiere.
 */
export type EscalonEmbudo = {
  /**
   * `resultados` (Fase 6) es el escalón que reporta la PLATAFORMA: conversiones
   * del sitio, formularios, compras. Existe para los negocios que no traen la
   * conversación a Respondo: sin él, su embudo terminaba en «clics» y las tres
   * etapas siguientes quedaban en cero, que es exactamente la pantalla vacía
   * que esta fase vino a eliminar.
   */
  clave: "impresiones" | "clics" | "resultados" | "conversaciones" | "calificados" | "avanzados" | "ventas";
  etiqueta: string;
  valor: number | null;
  /** % respecto del escalón anterior. null si no se puede calcular. */
  tasa: number | null;
  /** Qué significa exactamente, para el tooltip. */
  definicion: string;
};

export type EstadoCampana =
  | "activa"
  | "pausada"
  | "terminada"
  | "borrador"
  | "lista"
  | "requiere_meta"
  | "requiere_permiso"
  | "publicada";

export type FilaCampana = {
  id: string;
  nombre: string;
  /** De dónde sale: una plataforma, la atribución propia o un borrador nuestro. */
  origen: "meta" | "google" | "atribucion" | "borrador";
  /**
   * Qué plataforma la publica. `null` en las de solo atribución (sabemos que
   * alguien llegó por un anuncio, no de qué cuenta salió) y en los borradores.
   */
  proveedor?: Proveedor | null;
  estado: EstadoCampana;
  objetivo: string | null;
  gasto: number | null;
  moneda: string;
  impresiones: number | null;
  clics: number | null;
  conversaciones: number;
  calificados: number;
  avanzados: number;
  ventas: number;
  cobrado: number;
  /**
   * Costo por CONVERSACIÓN. Se llamaba `cpc`, y en publicidad CPC significa
   * universalmente cost-per-click: cualquiera con oficio leía mal la columna.
   * Respondo no mide costo por clic en ninguna parte.
   */
  costoPorConversacion: number | null;
  /** Costo por venta. null sin gasto o sin ventas. */
  costoPorVenta: number | null;
  /** Retorno sobre lo cobrado por enlace. null sin gasto. */
  roas: number | null;
  /** Cuántos anuncios distintos trajeron gente. */
  anuncios: number;
  desde: string | null;
  hasta: string | null;
  /**
   * El resultado que declara la plataforma, CON su tipo. Dos campañas con
   * tipos distintos no se comparan ni se suman: ver `sonComparables` en
   * `lib/ads/canal.ts`.
   */
  resultados?: number | null;
  tipoResultado?: TipoResultado | null;
  costoPorResultado?: number | null;
  /** Solo Meta. Sirve para explicar un CTR que cae. */
  frecuencia?: number | null;
};

export type FilaAnuncio = {
  id: string;
  campanaId: string;
  campanaNombre: string;
  titular: string;
  cuerpo: string;
  url: string;
  imagenUrl: string | null;
  gasto: number | null;
  impresiones: number | null;
  clics: number | null;
  conversaciones: number;
  calificados: number;
  cotizaciones: number;
  agendadas: number;
  /** Cotizaron o reservaron, contado UNA vez por persona (no es la suma). */
  avanzados: number;
  ventas: number;
  cobrado: number;
  conClid: number;
};

export type EtapaLead = "nuevo" | "interesado" | "cotizado" | "ganado" | "perdido";

export type Lead = {
  chatId: string;
  nombre: string;
  telefono: string;
  origen: "meta" | "instagram" | "organico";
  campanaId: string | null;
  campanaNombre: string;
  anuncioId: string | null;
  anuncioTitular: string;
  llegoEn: string;
  etapa: EtapaLead;
  calificado: boolean;
  cotizo: boolean;
  agendo: boolean;
  compro: boolean;
  cobrado: number;
  /** Última línea de la conversación, para reconocer a la persona. */
  ultimoMensaje: string;
  conClid: boolean;
};

export type FormatoCreatividad = "1:1" | "4:5" | "9:16" | "16:9";
export type PlataformaCreatividad = "instagram" | "facebook" | "ambas" | "google";

/** De dónde salió la pieza. Las tres se comportan igual aguas abajo. */
export type OrigenCreatividad = "generada" | "subida" | "existente";
export type EstadoCreatividad = "borrador" | "lista" | "en_campana" | "archivada";

export type Creatividad = {
  id: string;
  nombre: string;
  objetivo: string;
  producto: string;
  oferta: string;
  plataforma: PlataformaCreatividad;
  formato: FormatoCreatividad;
  concepto: string;
  gancho: string;
  titular: string;
  texto: string;
  cta: string;
  imagenUrl: string | null;
  imagenPrompt: string | null;
  estado: EstadoCreatividad;
  campanaId: string | null;
  campanaNombre: string | null;
  varianteDe: string | null;
  origen: OrigenCreatividad;
  /** El copy lo escribió una persona: no se reemplaza solo. */
  textoManual: boolean;
  /** Estrategia con la que se escribió y resultado de la revisión. */
  estrategia: Record<string, unknown> | null;
  creadoEn: string;
  actualizadoEn: string;
  /** Rendimiento, cuando la creatividad ya corrió en Meta y se pudo cruzar. */
  rendimiento: {
    gasto: number | null;
    impresiones: number | null;
    clics: number | null;
    conversaciones: number;
    ventas: number;
  } | null;
};

export type AudienciaCampana = {
  ubicacion: string;
  edadDesde: number | null;
  edadHasta: number | null;
  intereses: string[];
  nota: string;
};

export type BorradorCampana = {
  id: string;
  nombre: string;
  objetivo: string;
  oferta: string;
  audiencia: AudienciaCampana;
  presupuestoDiario: number | null;
  presupuestoTotal: number | null;
  moneda: string;
  /**
   * A dónde manda el clic. Era el literal `"whatsapp"` —el supuesto de toda la
   * sección escrito en el tipo—: un estudio jurídico que manda a su sitio no
   * podía guardarse. Ver `lib/marketing/arquitectoCore.ts`.
   */
  destino: Destino;
  /** Qué plataformas contempla: meta · google · ambos. */
  canal?: string;
  /**
   * El plan completo del Arquitecto, cuando la campaña nació ahí. Es el estado
   * COMPARTIDO entre Arquitecto, Estudio creativo y asistente: los tres leen y
   * escriben el mismo borrador en vez de tener cada uno el suyo.
   */
  plan?: PlanCampana | null;
  creatividadIds: string[];
  copies: { titular: string; texto: string; cta: string }[];
  estado: EstadoCampana;
  notas: string;
  creadoEn: string;
  actualizadoEn: string;
};

/** Todo lo que necesita el centro de marketing para un período. */
export type Panorama = {
  rango: Rango;
  /** true cuando lo que se muestra son datos de demostración. */
  demo: boolean;
  monedaNegocio: string;
  /**
   * Qué puede hacer este negocio. ÚNICA fuente para los botones y los estados:
   * ninguna pantalla vuelve a preguntarse por su cuenta si se puede conectar
   * Meta o generar con IA. Ver `lib/marketing/capacidades.ts`.
   */
  capacidades: Capacidades;
  /**
   * ¿Llegaron las cifras de publicidad de ESTE período?
   *
   * OJO: no es lo mismo que `capacidades.metaConectada`. La cuenta puede estar
   * perfectamente conectada y esto ser false porque Meta pidió esperar o se
   * cayó la red. Se usa para decidir si se pintan cifras; para decidir qué
   * botón ofrecer se usa `capacidades`.
   */
  metaConectada: boolean;
  /** Por qué no llegaron, cuando no llegaron. Da el motivo exacto, no uno genérico. */
  errorPublicidad: CodigoErrorAds | null;
  metricas: GrupoMetricas[];
  serie: PuntoDiario[];
  embudo: EscalonEmbudo[];
  campanas: FilaCampana[];
  anuncios: FilaAnuncio[];
  leads: Lead[];
  creatividades: Creatividad[];
  borradores: BorradorCampana[];
  hallazgos: Hallazgo[];
  estado: { items: ItemPauta[]; listos: number; total: number; hayAtribucion: boolean };
  /**
   * ⭐ LAS SEÑALES DE ESTE NEGOCIO (Fase 6). Lo que decide qué se muestra.
   *
   * No es una preferencia ni un modo elegido en una pantalla: se detecta de
   * datos reales en cada carga. Un negocio que conecta WhatsApp mañana gana la
   * capa de conversaciones sin que nadie cambie una configuración.
   */
  senales: Senales;
  profundidad: Profundidad;
  /** En qué pie está cada plataforma publicitaria para este negocio. */
  canales: EstadoCanalPanorama[];
  /** Qué plataforma no respondió y por qué. Una caída no tumba a la otra. */
  fallasCanales: FallaCanal[];
  /** Filas normalizadas de las plataformas (campañas, grupos, anuncios, términos). */
  filasAds: FilaRendimiento[];
  /** Hechos y recomendaciones deterministas. El modelo NO las calcula. */
  analisis: Analisis;
  /** Contactos del período que NO vinieron de un anuncio, para contexto. */
  sinAnuncio: number;
  /**
   * false cuando las tablas de creatividades y campañas no existen todavía
   * (migración 303 sin aplicar). Las pantallas lo dicen en vez de mostrar una
   * galería vacía que parece un error.
   */
  almacenListo: boolean;
};

/** Lo que la UI necesita saber de cada canal, sin importar el proveedor. */
export type EstadoCanalPanorama = {
  proveedor: Proveedor;
  nombre: string;
  disponible: boolean;
  conectado: boolean;
  faltaElegirCuenta: boolean;
  cuentaNombre: string | null;
  moneda: string | null;
};

/** Cómo se lee cada etapa en las pantallas. Mismo vocabulario que Embudo. */
export const ETAPAS_LEAD: Record<EtapaLead, { texto: string; clase: string }> = {
  nuevo: { texto: "Llegó", clase: "pildora-neutra" },
  interesado: { texto: "Interesado", clase: "pildora-indigo" },
  cotizado: { texto: "Cotizado", clase: "pildora-alerta" },
  ganado: { texto: "Compró", clase: "pildora-ok" },
  perdido: { texto: "Perdido", clase: "pildora-neutra" },
};

export const ESTADO_CAMPANA: Record<EstadoCampana, { texto: string; clase: string }> = {
  activa: { texto: "Activa", clase: "pildora-ok" },
  pausada: { texto: "Pausada", clase: "pildora-alerta" },
  terminada: { texto: "Terminada", clase: "pildora-neutra" },
  borrador: { texto: "Borrador", clase: "pildora-neutra" },
  lista: { texto: "Lista", clase: "pildora-indigo" },
  requiere_meta: { texto: "Requiere Meta", clase: "pildora-alerta" },
  requiere_permiso: { texto: "Requiere permiso", clase: "pildora-alerta" },
  publicada: { texto: "Publicada", clase: "pildora-ok" },
};

/**
 * ⚠️ La ayuda NO nombra el canal.
 *
 * Decía «Que más gente te escriba por WhatsApp», que era verdad cuando el único
 * destino posible era WhatsApp. Desde la Fase 6 un anuncio puede llevar a un
 * formulario, a un sitio o a una llamada —Respondo mismo no tiene WhatsApp
 * conectado—, así que el objetivo describe el RESULTADO y el destino se elige
 * aparte. Prometer un canal en el rótulo del objetivo era contradecir al
 * selector que está tres campos más abajo.
 */
export const OBJETIVOS = [
  { clave: "conversaciones", texto: "Conseguir conversaciones", ayuda: "Que más gente te escriba y empiece a conversar." },
  { clave: "reservas", texto: "Conseguir reservas", ayuda: "Que agenden una hora o visita." },
  { clave: "cotizaciones", texto: "Generar cotizaciones", ayuda: "Que pidan precio por algo concreto." },
  { clave: "ventas", texto: "Vender un producto", ayuda: "Que compren algo específico, con precio." },
] as const;

export type ObjetivoClave = (typeof OBJETIVOS)[number]["clave"];

export function textoObjetivo(clave: string | null | undefined): string {
  return OBJETIVOS.find((o) => o.clave === clave)?.texto ?? (clave || "Sin objetivo");
}
