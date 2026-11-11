/**
 * CONFIGURACIÓN DE CONVERSIONES A META, POR TENANT — puro, sin red ni base.
 *
 * Vive en `ed_clientes.conversiones_meta` (jsonb, migración 331). El flag que
 * la enciende es otra columna (`conversiones_meta_activo`), apagada por
 * defecto: un negocio que no la enciende no cambia en nada.
 *
 * QUÉ SE CONFIGURA
 *   · eventos   — cuáles de los tres se mandan (LeadSubmitted, QualifiedLead,
 *                 Purchase). Todos encendidos por defecto.
 *   · reglas    — la regla de calificación: producto + cantidad mínima. Es
 *                 DATO del tenant, no código: Impresora Color es
 *                 `calendarios ≥ 500`, la próxima imprenta pondrá lo suyo.
 *   · testEventCode — el código de «Probar eventos» del Administrador de
 *                 eventos. Solo lo usa el botón de prueba; nunca la cola real.
 *   · partnerAgent — el nombre de partner que asigna Meta, si lo hay.
 *
 * Sin imports: `node --test` lo carga directo.
 */

export type EventoConversion = "LeadSubmitted" | "QualifiedLead" | "Purchase";

export const EVENTOS_CONVERSION: EventoConversion[] = ["LeadSubmitted", "QualifiedLead", "Purchase"];

export type ReglaCalificacion = {
  /** Clave canónica del producto, en minúsculas: «calendarios». */
  producto: string;
  /** Otras formas en que el cliente lo nombra: «calendario», «almanaque». */
  sinonimos: string[];
  /** Cantidad desde la cual la cotización califica (inclusive). */
  cantidadMinima: number;
};

export type ConfigConversiones = {
  eventos: Record<EventoConversion, boolean>;
  reglas: ReglaCalificacion[];
  testEventCode: string | null;
  partnerAgent: string | null;
};

export const CONFIG_VACIA: ConfigConversiones = {
  eventos: { LeadSubmitted: true, QualifiedLead: true, Purchase: true },
  reglas: [],
  testEventCode: null,
  partnerAgent: null,
};

/** Minúsculas, sin tildes, sin espacios dobles. */
export function normalizarTexto(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function textoCorto(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Solo caracteres seguros: estos valores viajan a Meta en el cuerpo.
  if (!/^[\w.\- ]+$/.test(s)) return null;
  return s.slice(0, max);
}

/**
 * Lee la config guardada, tolerante a basura: cualquier campo inválido cae a
 * su valor por defecto en vez de romper el cron. Una regla sin producto o con
 * cantidad no positiva se descarta: calificar «todo» por un typo le enseñaría
 * a Meta a buscar a cualquiera.
 */
export function leerConfig(crudo: unknown): ConfigConversiones {
  const o = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const ev = (o.eventos && typeof o.eventos === "object" ? o.eventos : {}) as Record<string, unknown>;

  const eventos = { ...CONFIG_VACIA.eventos };
  for (const k of EVENTOS_CONVERSION) {
    if (typeof ev[k] === "boolean") eventos[k] = ev[k] as boolean;
  }

  const reglas: ReglaCalificacion[] = [];
  for (const r of Array.isArray(o.reglas) ? o.reglas : []) {
    const x = (r ?? {}) as Record<string, unknown>;
    const producto = normalizarTexto(x.producto);
    const cantidadMinima = Math.floor(Number(x.cantidadMinima));
    if (!producto || !Number.isFinite(cantidadMinima) || cantidadMinima <= 0) continue;
    const sinonimos = (Array.isArray(x.sinonimos) ? x.sinonimos : [])
      .map(normalizarTexto)
      .filter((s) => s && s !== producto)
      .slice(0, 20);
    reglas.push({ producto, sinonimos, cantidadMinima });
  }

  return {
    eventos,
    reglas: reglas.slice(0, 20),
    testEventCode: textoCorto(o.testEventCode, 40),
    partnerAgent: textoCorto(o.partnerAgent, 80),
  };
}

/** Quita una «s» final simple para que «calendario» y «calendarios» calcen. */
function raiz(s: string): string {
  return s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s;
}

/** ¿Este nombre de producto corresponde a la regla? */
export function productoCalza(producto: string | null | undefined, regla: ReglaCalificacion): boolean {
  const p = raiz(normalizarTexto(producto));
  if (!p) return false;
  return [regla.producto, ...regla.sinonimos].some((n) => raiz(n) === p);
}

export type DatosCalificables = {
  producto: string | null;
  cantidad: number | null;
};

/**
 * La regla de calificación. Determinista, sin IA: la IA solo extrae los datos;
 * decidir si califica lo hace el código con la regla del tenant, para que se
 * pueda auditar y no dependa del humor del modelo.
 *
 * Sin reglas configuradas NADA califica solo (queda el botón manual). Mejor no
 * mandar QualifiedLead que mandarlo a ciegas.
 */
export function califica(d: DatosCalificables, reglas: ReglaCalificacion[]): boolean {
  if (d.cantidad === null || !Number.isFinite(d.cantidad) || d.cantidad <= 0) return false;
  return reglas.some((r) => productoCalza(d.producto, r) && (d.cantidad as number) >= r.cantidadMinima);
}

/** Datos mínimos de una cotización: producto + cantidad. */
export function esCotizacionCompleta(d: DatosCalificables): boolean {
  return Boolean(normalizarTexto(d.producto)) && d.cantidad !== null && Number.isFinite(d.cantidad) && d.cantidad > 0;
}

/**
 * Monto neto de una venta marcada a mano. Acepta «1.250.000», «$1250000».
 * Entero en CLP, mayor que cero. Tope alto (mil millones) solo contra typos
 * de dedo pegado: un pedido corporativo grande es normal en una imprenta.
 */
export function validarMontoVenta(v: unknown): { ok: true; monto: number } | { ok: false; error: string } {
  const crudo = String(v ?? "").replace(/[.\s$]/g, "").replace(/,\d{1,2}$/, "");
  if (!/^\d+$/.test(crudo)) return { ok: false, error: "Escribe el monto neto en pesos, solo números." };
  const monto = Number(crudo);
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: "El monto tiene que ser mayor que cero." };
  if (monto > 1_000_000_000) return { ok: false, error: "Ese monto parece tener un número de más." };
  return { ok: true, monto };
}
