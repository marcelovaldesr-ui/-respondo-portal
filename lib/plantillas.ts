/**
 * CATÁLOGO DE PLANTILLAS DE META (WhatsApp Cloud API).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Meta solo acepta texto libre DENTRO de la ventana de 24 h desde el último
 * mensaje del cliente. Todo lo que hacen Beto y Vera es lo contrario: escribirle
 * a alguien que no ha escrito hace semanas o meses. Fuera de la ventana, un
 * `type: "text"` se rechaza con el error 131047 (re-engagement).
 *
 * La solución de Meta son las PLANTILLAS: un texto fijo, aprobado de antemano,
 * con variables {{1}}, {{2}}… que se rellenan al enviar.
 *
 * REGLA DE ORO DE ESTE ARCHIVO
 * -----------------------------
 * El cuerpo de la plantilla y el texto que guardamos en ed_mensajes salen de la
 * MISMA fuente: `cuerpo` + `render()`. Si alguien edita el texto acá sin volver
 * a dar de alta la plantilla en Meta, el envío falla en vez de mandar algo
 * distinto a lo que el portal muestra. Es a propósito: preferimos un error
 * visible a una conversación que dice una cosa en el teléfono del cliente y
 * otra en la pantalla del negocio.
 *
 * LÍMITES DE META QUE ESTE ARCHIVO RESPETA
 * -----------------------------------------
 *  - El cuerpo no puede empezar ni terminar con una variable.
 *  - Dos variables no pueden ir pegadas ({{1}} {{2}} sí, {{1}}{{2}} no).
 *  - Un VALOR de variable no puede traer saltos de línea, tabs ni 4+ espacios
 *    seguidos (por eso `limpiarParam`). El cuerpo sí puede tener saltos.
 *  - Cuerpo máximo 1024 caracteres.
 *  - La numeración va de 1 a N sin saltos.
 *
 * CATEGORÍA Y COSTO (Chile, ago-2026)
 * ------------------------------------
 *  - `utility`  ≈ USD 0,018 por mensaje (≈ $18). Es la barata. Aplica cuando el
 *    mensaje continúa una transacción que el cliente ya inició: su cita, su
 *    cotización, su repuesto, su moto en el taller.
 *  - `marketing` ≈ USD 0,0889 (≈ $85). Aplica cuando nosotros iniciamos algo
 *    nuevo: "te toca la mantención".
 * Meta reclasifica por su cuenta si cree que la categoría no corresponde, así
 * que acá se declara la que de verdad aplica y no la más barata.
 */

export type CategoriaPlantilla = "utility" | "marketing";

export type Plantilla = {
  /** Nombre técnico en Meta: minúsculas, números y guion bajo. */
  nombre: string;
  /** Código de idioma del alta en Meta. */
  idioma: string;
  categoria: CategoriaPlantilla;
  /** Cuerpo EXACTO tal como se da de alta, con {{1}}, {{2}}… */
  cuerpo: string;
  /** Qué es cada variable, en orden. Solo documentación (y el alta en Meta). */
  variables: string[];
  /** Valores de ejemplo que pide Meta al crear la plantilla. */
  ejemplos: string[];
  /**
   * A QUÉ RUBROS APLICA. Sin este campo, aplica a todos.
   *
   * ⚠️ POR QUÉ EXISTE (26-ago-2026). Antes el catálogo era uno solo para todos
   * los clientes, y se había armado pensando en RS-Shop: `moto_lista`,
   * `repuesto_llego`, `mantencion_toca`. Al conectar Impresora Color se iba a
   * crear en su WABA una plantilla llamada «moto_lista» — y encima cuatro de las
   * siete eran de agenda, que **una imprenta no usa**: no agenda horas, cotiza y
   * vende.
   *
   * Dar de alta plantillas que nunca se van a usar no rompe nada, pero ensucia
   * el portafolio de Meta de un cliente y deja a la vista que no pensamos su
   * caso. Y una de las inútiles era de categoría marketing.
   *
   * Es el primer paso de «plantillas por industria», adelantado por necesidad.
   * Las llaves son las de `ed_clientes.rubro`, el mismo vocabulario que usan
   * `lib/plantillasRubro.ts` y `lib/clasificadorProducto.ts`.
   */
  rubros?: string[];
};

/** Rubros que agendan horas. Los que no están acá no usan las citas. */
const CON_AGENDA = ["estetica", "dental", "salud", "nutricion", "taller", "motos", "inmobiliaria"];
/** Rubros que entregan un producto o trabajo terminado. */
const CON_PEDIDOS = ["imprenta", "tienda", "retail"];

/**
 * Las plantillas se dan de alta UNA VEZ por WABA (por cliente), con estos
 * mismos nombres. El código busca por `tipo` de seguimiento.
 */
export const PLANTILLAS: Record<string, Plantilla> = {
  // ─────────────────────── Agenda (Tino) ───────────────────────
  cita_confirmacion: {
    nombre: "cita_confirmacion",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, te esperamos mañana para tu {{2}} ({{3}}).\n\n" +
      "¿Nos confirmas que vienes? Si necesitas moverla o anularla, puedes hacerlo acá:\n" +
      "{{4}}\n\n" +
      "Cualquier duda, respóndenos por este mismo chat.",
    variables: ["nombre del cliente", "servicio", "día y hora", "enlace de gestión de la cita"],
    ejemplos: ["Cristian", "mantención programada", "jueves 21 a las 10:00", "https://respondo.cl/cita/abc123"],
    rubros: CON_AGENDA,
  },

  cita_recordatorio: {
    nombre: "cita_recordatorio",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, te recordamos tu {{2}} de hoy a las {{3}}.\n\n" +
      "Si no vas a poder llegar, avísanos acá y liberamos la hora:\n" +
      "{{4}}\n\n" +
      "¡Te esperamos!",
    variables: ["nombre del cliente", "servicio", "hora", "enlace de gestión de la cita"],
    ejemplos: ["Cristian", "mantención programada", "10:00", "https://respondo.cl/cita/abc123"],
    rubros: CON_AGENDA,
  },

  // ─────────────────────── Vera ───────────────────────
  encuesta_postventa: {
    nombre: "encuesta_postventa",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, gracias por venir hoy a {{2}}.\n\n" +
      "De 1 a 5, ¿cómo evaluarías la atención? Tu respuesta la lee el equipo, no un buzón.",
    variables: ["nombre del cliente", "nombre del negocio"],
    ejemplos: ["Cristian", "RS-Shop"],
  },

  // ─────────────────────── Beto ───────────────────────
  mantencion_toca: {
    nombre: "mantencion_toca",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, te escribimos de {{2}}. Según nuestro registro, tu {{3}} ya está en fecha de {{4}}.\n\n" +
      "Si quieres, te dejamos la hora coordinada por acá. Y si prefieres que no te escribamos más, " +
      "respóndenos BAJA y no volvemos a molestarte.",
    variables: ["nombre del cliente", "nombre del negocio", "moto", "próximo servicio"],
    ejemplos: ["Cristian", "RS-Shop", "KTM 390 Duke 2023", "su próxima mantención"],
    rubros: ["motos", "taller", "automotriz"],
  },

  /**
   * ESTA ES MARKETING Y NO SE PUEDE EVITAR. NO PERDER TIEMPO INTENTÁNDOLO.
   *
   * Se probaron dos textos (19-ago-2026). Meta aceptó los dos como UTILITY al
   * crearlos y después, DURANTE LA REVISIÓN, movió los dos a MARKETING
   * (`previous_category: UTILITY` en la API). O sea que no es cosa del texto:
   *
   *   1. "¿Sigue en pie? Si nos dices que sí, la retomamos hoy mismo."  → MARKETING
   *   2. "Tu cotización sigue abierta… ¿te la reenviamos o la cerramos?" → MARKETING
   *
   * La explicación está en la regla de Meta: utilidad exige que el mensaje sea
   * sobre "su pedido o su cuenta". Una COTIZACIÓN todavía no es un pedido —es
   * previa a la compra— así que cualquier seguimiento sobre ella es, para Meta,
   * reactivación comercial. Da lo mismo cuán neutro sea el texto.
   *
   * Consecuencia práctica: cuesta ≈$85 y no ≈$18. Y como el precio es el mismo
   * en los dos casos, se queda el texto que de verdad consigue respuesta.
   *
   * ⚠ Si alguien vuelve a intentar bajarla a utilidad, que lea esto primero.
   * Hay 60 días para apelar por Business Support, pero con este argumento la
   * apelación tiene poco futuro.
   */
  cotizacion_pendiente: {
    nombre: "cotizacion_pendiente",
    idioma: "es",
    categoria: "marketing",
    cuerpo:
      "Hola {{1}}, te escribimos de {{2}} por la cotización de {{3}} que nos pediste.\n\n" +
      "¿Sigue en pie? Si nos dices que sí, la retomamos hoy mismo.",
    variables: ["nombre del cliente", "nombre del negocio", "lo cotizado"],
    ejemplos: ["Cristian", "RS-Shop", "kit de arrastre para KTM 390 Duke"],
  },

  repuesto_llego: {
    nombre: "repuesto_llego",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, buenas noticias: llegó el {{3}} que estabas esperando en {{2}}.\n\n" +
      "Queda reservado a tu nombre. ¿Lo pasas a buscar o prefieres que lo despachemos?",
    variables: ["nombre del cliente", "nombre del negocio", "repuesto"],
    ejemplos: ["Cristian", "RS-Shop", "kit de arrastre"],
    rubros: ["motos", "taller", "automotriz"],
  },

  moto_lista: {
    nombre: "moto_lista",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, tu {{3}} ya está lista para retirar en {{2}}.\n\n" +
      "Te esperamos en el horario que te acomode. Si necesitas coordinar el retiro, respóndenos por acá.",
    variables: ["nombre del cliente", "nombre del negocio", "moto"],
    ejemplos: ["Cristian", "RS-Shop", "KTM 390 Duke"],
    rubros: ["motos", "taller", "automotriz"],
  },

  // ─────────────────── Imprenta y tiendas (26-ago-2026) ───────────────────
  //
  // Un negocio que vende y entrega NO agenda horas. Impresora Color tiene 349
  // conversaciones y ninguna es para reservar: son cotizaciones, pedidos y
  // encargos. Estas dos son el equivalente de `moto_lista` y `repuesto_llego`
  // para ese mundo, y las dos son UTILITY: continúan algo que el cliente ya
  // inició, así que son baratas y gratis dentro de las 24 h.

  pedido_listo: {
    nombre: "pedido_listo",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, tu {{3}} ya está listo para retirar en {{2}}.\n\n" +
      "Te esperamos en el horario que te acomode. Si necesitas coordinar el retiro, respóndenos por acá.",
    variables: ["nombre del cliente", "nombre del negocio", "trabajo o pedido"],
    ejemplos: ["Cristian", "Impresora Color", "pedido de 500 tarjetas"],
    rubros: CON_PEDIDOS,
  },

  encargo_llego: {
    nombre: "encargo_llego",
    idioma: "es",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, buenas noticias: llegó el {{3}} que encargaste en {{2}}.\n\n" +
      "Te lo dejamos reservado. Respóndenos por acá para coordinar el retiro.",
    variables: ["nombre del cliente", "nombre del negocio", "producto encargado"],
    ejemplos: ["Cristian", "Impresora Color", "tóner Xerox C8000"],
    rubros: CON_PEDIDOS,
  },
};

/** De tipo de seguimiento (ed_seguimientos.tipo) a plantilla. */
export const PLANTILLA_POR_TIPO: Record<string, string> = {
  confirmacion_cita: "cita_confirmacion",
  recordatorio_cita: "cita_recordatorio",
  encuesta_postventa: "encuesta_postventa",
  mantencion_toca: "mantencion_toca",
  cotizacion_sin_respuesta: "cotizacion_pendiente",
  cotizacion_pendiente: "cotizacion_pendiente",
  repuesto_llego: "repuesto_llego",
  moto_lista: "moto_lista",
  pedido_listo: "pedido_listo",
  encargo_llego: "encargo_llego",
};

/**
 * Las plantillas que le corresponden a un rubro.
 *
 * Las que no declaran `rubros` son universales (hoy: `encuesta_postventa` y
 * `cotizacion_pendiente`, que aplican a cualquier negocio que entregue algo o
 * cotice).
 *
 * ⚠️ Sin rubro conocido devuelve SOLO las universales, no todas. Crear plantillas
 * de más en el WABA de un cliente no rompe nada, pero deja en su portafolio de
 * Meta cosas que no le corresponden — y una de ellas es marketing. Ante la duda,
 * de menos.
 */
export function plantillasParaRubro(rubro: string | null | undefined): Plantilla[] {
  const r = (rubro ?? "").trim().toLowerCase();
  return Object.values(PLANTILLAS).filter(
    (p) => !p.rubros || (r !== "" && p.rubros.includes(r)),
  );
}

export function plantillaPara(tipoONombre: string): Plantilla | null {
  const nombre = PLANTILLA_POR_TIPO[tipoONombre] ?? tipoONombre;
  return PLANTILLAS[nombre] ?? null;
}

/**
 * Deja un valor apto para ir como parámetro de plantilla.
 *
 * Meta rechaza el envío completo si un parámetro trae un salto de línea, un tab
 * o cuatro espacios seguidos. Un nombre pegado desde un Excel trae cualquiera
 * de las tres cosas más seguido de lo que uno cree, así que se limpia siempre y
 * no "cuando haga falta".
 */
export function limpiarParam(v: unknown): string {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Rellena {{1}}, {{2}}… con los parámetros.
 *
 * Este es el texto que se guarda en ed_mensajes, para que el portal muestre
 * exactamente lo que le llegó al cliente. Si falta un parámetro devuelve null:
 * es preferible no enviar a enviar un mensaje con un "{{3}}" a la vista.
 */
export function render(cuerpo: string, params: string[]): string | null {
  const total = (cuerpo.match(/\{\{\d+\}\}/g) ?? []).length;
  if (params.length < total) return null;
  let out = cuerpo;
  for (let i = 0; i < params.length; i++) {
    const p = limpiarParam(params[i]);
    if (!p) return null; // Meta tampoco acepta parámetros vacíos.
    out = out.replaceAll(`{{${i + 1}}}`, p);
  }
  return out;
}

/**
 * Chequeo de las reglas de Meta sobre el CUERPO. Se corre en los tests para que
 * una plantilla mal escrita se caiga acá y no en la revisión de Meta, que tarda
 * horas y no explica bien qué falló.
 */
export function validarCuerpo(p: Plantilla): string[] {
  const errores: string[] = [];
  const c = p.cuerpo;
  if (c.length > 1024) errores.push("el cuerpo pasa los 1024 caracteres");
  if (/^\s*\{\{\d+\}\}/.test(c)) errores.push("el cuerpo no puede empezar con una variable");
  if (/\{\{\d+\}\}\s*$/.test(c)) errores.push("el cuerpo no puede terminar con una variable");
  if (/\{\{\d+\}\}\{\{\d+\}\}/.test(c)) errores.push("hay dos variables pegadas");
  const nums = [...c.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const unicos = [...new Set(nums)].sort((a, b) => a - b);
  for (let i = 0; i < unicos.length; i++) {
    if (unicos[i] !== i + 1) errores.push(`la numeración salta: se esperaba {{${i + 1}}}`);
  }
  if (p.variables.length !== unicos.length) {
    errores.push(`hay ${unicos.length} variables en el cuerpo y ${p.variables.length} descritas`);
  }
  if (p.ejemplos.length !== unicos.length) {
    errores.push(`faltan ejemplos: ${p.ejemplos.length} para ${unicos.length} variables`);
  }
  if (!/^[a-z0-9_]+$/.test(p.nombre)) errores.push("el nombre solo admite minúsculas, números y _");
  return errores;
}
