/**
 * ESTADO COMERCIAL DE UN CONTACTO — la verdad compartida, derivada (Fase 1).
 *
 * LA PREGUNTA
 * -----------
 * «¿Qué pasa con este cliente y qué necesita el negocio hacer ahora?»
 *
 * Hasta Fase 0 cada pantalla lo contestaba por su cuenta: Inicio miraba solo
 * derivaciones abiertas, la bandeja pintaba «Responder» con otra regla, el
 * embudo recalculaba etapas en memoria, la ficha no sabía de Beto ni de pagos
 * informados. Los números no coincidían porque las preguntas no eran la misma.
 *
 * LA DECISIÓN: NO HAY TABLA NUEVA
 * -------------------------------
 * Cada dato ya tiene un dueño en la base (ver docs/FASE1_ESTADO_COMERCIAL.md,
 * sección B). Copiarlos a una tabla «estado del cliente» crearía una fuente
 * más que sincronizar, con el mismo problema multiplicado. En vez de eso:
 *
 *   hechos (leídos de sus dueños, por lote)  →  este archivo  →  estado
 *
 * Este archivo es PURO: recibe hechos y devuelve el estado. No lee la base, no
 * conoce Next, no llama modelos. Así Inicio, la ficha de la conversación y los
 * tests usan exactamente la misma regla, y la regla se prueba sin red.
 *
 * Nada de acá es un «score» ni una sugerencia de IA: son reglas deterministas
 * sobre estados que el producto ya registra.
 *
 * ⚠️ NO IMPORTAR NADA CON RED O NEXT ACÁ.
 */

import { clasificarDerivacion, type ClaseDerivacion } from "@/lib/derivacionesCore";
import {
  esPerdidoPorSilencio,
  etiquetaMotivoEtapa,
  metaEtapa,
  type Etapa,
} from "@/lib/etapasCore";

const DIA = 86_400_000;

/** Pasado este plazo, un pendiente deja de ser «de hoy» y va a «antiguos». */
export const DIAS_ANTIGUO = 7;
/** Un chat tomado por una persona donde el cliente habló último, hasta este plazo. */
export const DIAS_CLIENTE_ESPERA_MAX = 30;
/** Ventana de silencio en la que una cotización se puede retomar (igual que Beto). */
export const DIAS_RETOMAR_MIN = 3;
export const DIAS_RETOMAR_MAX = 30;
/** Actividad reciente para que un «interesado» cuente como oportunidad. */
export const DIAS_INTERESADO = 7;

export const ETIQUETA_PAGO_POR_CONFIRMAR = "pago_por_confirmar";
export const ETIQUETA_FALTA_PAGO = "pago_pendiente";
export const ETIQUETA_NO_CONTACTAR = "no_contactar";
export const TIPO_SEGUIMIENTO_COTIZACION = "cotizacion_sin_respuesta";

// ─── Hechos ─────────────────────────────────────────────────────────────────

export type ModoChat = "bot" | "humano" | "pausado";
export type RolMensaje = "cliente" | "empleado" | "humano";

export type HechoPago = {
  id: string;
  estado: "pendiente" | "pagado" | "anulado";
  monto: number;
  creadoEn: string;
  pagadoEn: string | null;
};

export type HechoDerivacion = {
  trigger: string | null;
  resumen: string | null;
  creadoEn: string;
};

export type HechoPropuesta = {
  estado: "propuesto" | "aprobado" | "rechazado" | "vencido" | "frenado";
  creadoEn: string;
  resueltoEn: string | null;
  motivo: string | null;
};

export type HechoSeguimiento = {
  tipo: string;
  programadoPara: string | null;
  enviadoEn: string | null;
  /** Motivo si se descartó (variables.descartado); null si salió o está pendiente. */
  descartado: string | null;
  respuestaRecibida: boolean;
  /** Rol del empleado que lo envía (tino | rita | vera). */
  rol: string | null;
};

export type HechoCita = {
  id: string;
  inicio: string;
  fin: string;
  estado: string;
};

export type HechoResultado = {
  tipo: string;
  creadoEn: string;
  puntaje: number | null;
};

export type HechosContacto = {
  chatId: string;
  nombre: string | null;
  telefono: string | null;
  etapa: Etapa;
  etapaMotivo: string | null;
  etapaEn: string | null;
  etapaManual: boolean;
  etiquetas: string[];
  ultimoMensajeEn: string | null;
  ultimoMensajeRol: RolMensaje | null;
  primerMensajeEn: string | null;
  totalMensajes: number | null;
  /** Modo del empleado que atiende el chat (el mismo criterio que la bandeja). */
  modo: ModoChat;
  /** Derivaciones SIN atender del chat (cualquier empleado). */
  derivaciones: HechoDerivacion[];
  pagos: HechoPago[];
  /** Propuestas de Beto para retomar la cotización, la más reciente primero. */
  propuestas: HechoPropuesta[];
  /** Seguimientos recientes del chat, cualquier tipo. */
  seguimientos: HechoSeguimiento[];
  /** Citas activas (agendada/confirmada/reagendada) recientes y futuras. */
  citas: HechoCita[];
  resultados: HechoResultado[];
  /** `ed_contactos.datos` (atribución y pérdida anterior). */
  datos: Record<string, unknown> | null;
  /**
   * Última vez que una persona cerró una derivación de este chat
   * («Ya lo atendí» o respondiendo). Sirve para no volver a pedir atención por
   * el mismo mensaje del cliente que ya se atendió.
   */
  atendidaEn?: string | null;
  /** Empleado con el que se abre el chat (criterio de la bandeja). */
  empleadoId?: string | null;
};

export type ContextoNegocio = {
  ahora: number;
  /** `ed_clientes.cotizacion_seguimiento`: Beto retoma cotizaciones. Nace apagado. */
  betoCotizaciones: boolean;
  /** El negocio configuró un enlace de pago: se puede cobrar desde el chat. */
  tienePagoLink: boolean;
  /** Permiso `aprobar_mensajes_pagados` (solo dueño). */
  puedeAprobarPagados: boolean;
  nombreTino?: string;
  nombreBeto?: string;
};

// ─── Tiempo ─────────────────────────────────────────────────────────────────

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function diasDesde(iso: string | null | undefined, ahora: number): number | null {
  const t = ms(iso);
  return Number.isFinite(t) ? Math.floor((ahora - t) / DIA) : null;
}

function horasDesde(iso: string | null | undefined, ahora: number): number | null {
  const t = ms(iso);
  return Number.isFinite(t) ? (ahora - t) / 3_600_000 : null;
}

function masReciente<T>(filas: readonly T[], fecha: (x: T) => string | null): T | null {
  let mejor: T | null = null;
  let tMejor = -Infinity;
  for (const f of filas) {
    const t = ms(fecha(f));
    if (Number.isFinite(t) && t > tMejor) {
      mejor = f;
      tMejor = t;
    }
  }
  return mejor;
}

// ─── Pago ───────────────────────────────────────────────────────────────────

/**
 * PAGO: CINCO ESTADOS QUE NO SE MEZCLAN.
 *
 * «Venta ganada» NO implica pago confirmado. El detector de cierres da la venta
 * por ganada cuando el cliente dice «ya transferí»; la plata la confirma una
 * persona marcando el cobro como pagado. Por eso:
 *
 *  1. informado     — etiqueta «Pago por confirmar»: el cliente dijo que pagó.
 *                     Gana sobre todo lo demás porque es lo único que exige una
 *                     acción del negocio (verificar la transferencia).
 *  2. confirmado    — hay un cobro `pagado` de ESTE ciclo (desde `etapa_en`, o
 *                     la etapa es ganado). Un pago de hace seis meses no
 *                     confirma la cotización de hoy.
 *  3. cobro_pendiente — se envió un cobro y no se ha pagado.
 *  4. falta_pago    — etiqueta «Falta pago»: aprobó y no hay cobro ni pago.
 *  5. sin_cobro     — nada de lo anterior.
 */
export type EstadoPago =
  | { tipo: "sin_cobro" }
  | { tipo: "falta_pago" }
  | { tipo: "cobro_pendiente"; pagoId: string; monto: number; desde: string }
  | { tipo: "informado"; desde: string | null; pagoPendienteId: string | null; monto: number | null }
  | { tipo: "confirmado"; pagoId: string; monto: number; en: string };

/**
 * ¿El cobro pagado corresponde al ciclo comercial actual?
 *
 * Ganada ≠ pagada: un cobro de hace cinco meses NO convierte en «pagado» a un
 * contacto que alguien marcó Ganado hoy a mano. Cuenta si se pagó cuando la
 * etapa actual ya estaba puesta, o — solo en Ganado — hasta 24 h antes: al
 * confirmar un pago el portal mueve a Ganado un instante DESPUÉS de
 * `pagado_en`, y una persona puede arrastrar la tarjeta a Ganado poco después
 * de confirmar. Un ciclo nuevo (vuelve a cotizar) deja el pago anterior fuera.
 */
export const MARGEN_PAGO_GANADO_MS = 24 * 3_600_000;

export function pagoDelCiclo(pagadoEn: string, etapa: Etapa, etapaEn: string | null): boolean {
  if (!etapaEn) return true;
  const pago = ms(pagadoEn);
  const desde = ms(etapaEn);
  if (pago >= desde) return true;
  return etapa === "ganado" && desde - pago <= MARGEN_PAGO_GANADO_MS;
}

export function estadoPago(
  h: Pick<HechosContacto, "etiquetas" | "etapa" | "etapaEn" | "pagos" | "resultados">,
): EstadoPago {
  const vivos = h.pagos.filter((p) => p.estado !== "anulado");
  const pendiente = masReciente(
    vivos.filter((p) => p.estado === "pendiente"),
    (p) => p.creadoEn,
  );

  if (h.etiquetas.includes(ETIQUETA_PAGO_POR_CONFIRMAR)) {
    const informadoEn = masReciente(
      h.resultados.filter((r) => r.tipo === "venta_confirmada"),
      (r) => r.creadoEn,
    );
    return {
      tipo: "informado",
      desde: informadoEn?.creadoEn ?? null,
      pagoPendienteId: pendiente?.id ?? null,
      monto: pendiente?.monto ?? null,
    };
  }

  const pagado = masReciente(
    vivos.filter((p) => p.estado === "pagado" && p.pagadoEn),
    (p) => p.pagadoEn,
  );
  if (pagado) {
    const delCiclo = pagoDelCiclo(pagado.pagadoEn as string, h.etapa, h.etapaEn);
    if (delCiclo) return { tipo: "confirmado", pagoId: pagado.id, monto: pagado.monto, en: pagado.pagadoEn as string };
  }

  if (pendiente) return { tipo: "cobro_pendiente", pagoId: pendiente.id, monto: pendiente.monto, desde: pendiente.creadoEn };
  if (h.etiquetas.includes(ETIQUETA_FALTA_PAGO)) return { tipo: "falta_pago" };
  return { tipo: "sin_cobro" };
}

// ─── Atención requerida ─────────────────────────────────────────────────────

export type MotivoAtencion =
  | ClaseDerivacion
  | "cliente_espera"
  | "pago_por_confirmar"
  | "propuesta_beto"
  | "falta_pago"
  | "cita_por_cerrar";

export type Prioridad = "urgente" | "hoy" | "pendiente";
export type GrupoAtencion = Prioridad | "esta_semana" | "antiguo";

/**
 * «Para hoy» tiene que querer decir HOY (11-sep, mirando Impresora en vivo).
 *
 * Con la prioridad sola, «Para hoy» juntaba 75 conversaciones, casi todas de 4
 * a 7 días: el rótulo mentía y el bloque dejaba de servir para decidir qué
 * hacer ahora. La prioridad sigue saliendo de la señal; lo que el reloj decide
 * es en qué montón cae: hasta 24 h es hoy, de ahí a 7 días es esta semana, más
 * allá es lo antiguo (que ya estaba plegado).
 */
export const HORAS_HOY = 24;

/**
 * PRIORIDAD POR SEÑAL, NO POR PUNTAJE.
 *
 *  urgente   — una persona pidió explícitamente a otra persona, o está molesta.
 *              Esperar ahí cuesta el cliente.
 *  hoy       — alguien espera respuesta o hay plata por verificar.
 *  pendiente — decisiones del negocio que no tienen a nadie esperando en línea
 *              (aprobar un seguimiento, pedir un abono, cerrar una cita pasada).
 *
 * Y un corte de antigüedad: lo que lleva más de DIAS_ANTIGUO días deja de
 * competir con lo de hoy y se agrupa aparte. No desaparece —sigue contado—,
 * pero una derivación de hace 41 días no puede tapar al cliente de hace 20
 * minutos (así estaba la portada de Impresora: las cuatro filas visibles eran
 * de agosto).
 */
export const PRIORIDAD: Record<MotivoAtencion, Prioridad> = {
  cliente_molesto: "urgente",
  pidio_persona: "urgente",
  tema_delicado: "hoy",
  problema_tecnico: "hoy",
  asistente_no_pudo: "hoy",
  cliente_espera: "hoy",
  pago_por_confirmar: "hoy",
  propuesta_beto: "pendiente",
  falta_pago: "pendiente",
  cita_por_cerrar: "pendiente",
};

// Un cliente esperando desde hace tres días pesa más que una decisión del
// negocio sin nadie en línea: «esta semana» va antes que «por decidir».
const RANGO_GRUPO: Record<GrupoAtencion, number> = { urgente: 0, hoy: 1, esta_semana: 2, pendiente: 3, antiguo: 4 };

/**
 * Orden DENTRO de una misma conversación, para elegir qué se muestra como
 * «siguiente acción». Visto en vivo: un cliente que dijo «ahí aboné $10.000»
 * salía como «Responder» y el «confirma el pago» quedaba de nota al pie. La
 * plata por verificar manda sobre el «escribió y espera».
 *
 * Solo para el principal: la LISTA de Inicio se sigue ordenando por antigüedad
 * dentro de cada grupo (compararItems), que es lo justo entre conversaciones.
 */
const RANGO_MOTIVO: Record<MotivoAtencion, number> = {
  cliente_molesto: 0,
  pidio_persona: 1,
  tema_delicado: 2,
  pago_por_confirmar: 3,
  problema_tecnico: 4,
  asistente_no_pudo: 5,
  cliente_espera: 6,
  falta_pago: 7,
  cita_por_cerrar: 8,
  propuesta_beto: 9,
};

export function compararEnElChat(a: ItemAtencion, b: ItemAtencion): number {
  const g = RANGO_GRUPO[grupoDe(a)] - RANGO_GRUPO[grupoDe(b)];
  if (g) return g;
  const m = RANGO_MOTIVO[a.motivo] - RANGO_MOTIVO[b.motivo];
  if (m) return m;
  return compararItems(a, b);
}

export type ItemAtencion = {
  motivo: MotivoAtencion;
  label: string;
  /** Desde cuándo está pendiente (ISO). Null si la fuente no guarda fecha. */
  desde: string | null;
  prioridad: Prioridad;
  antiguo: boolean;
  /** Horas esperando. Null si la fuente no guarda fecha (ver `desde`). */
  horas: number | null;
};

export type Atencion = {
  requiere: boolean;
  items: ItemAtencion[];
  principal: ItemAtencion | null;
  grupo: GrupoAtencion | null;
};

export function grupoDe(item: ItemAtencion): GrupoAtencion {
  if (item.antiguo) return "antiguo";
  if (item.prioridad === "hoy" && item.horas !== null && item.horas > HORAS_HOY) return "esta_semana";
  return item.prioridad;
}

export function compararItems(a: ItemAtencion, b: ItemAtencion): number {
  const g = RANGO_GRUPO[grupoDe(a)] - RANGO_GRUPO[grupoDe(b)];
  if (g) return g;
  // Dentro del grupo, quien lleva más tiempo esperando va primero.
  const ta = ms(a.desde);
  const tb = ms(b.desde);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return Number.isFinite(ta) ? -1 : Number.isFinite(tb) ? 1 : 0;
}

export function atencionRequerida(h: HechosContacto, ctx: ContextoNegocio): Atencion {
  const items: ItemAtencion[] = [];
  const agregar = (motivo: MotivoAtencion, label: string, desde: string | null) => {
    const d = diasDesde(desde, ctx.ahora);
    const horas = horasDesde(desde, ctx.ahora);
    items.push({ motivo, label, desde, prioridad: PRIORIDAD[motivo], antiguo: d !== null && d > DIAS_ANTIGUO, horas });
  };

  // 1. Derivaciones abiertas: una fila por clase, con la fecha de la más antigua.
  const porClase = new Map<ClaseDerivacion, { label: string; desde: string }>();
  for (const d of h.derivaciones) {
    const c = clasificarDerivacion(d.trigger, d.resumen);
    const previa = porClase.get(c.clase);
    if (!previa || ms(d.creadoEn) < ms(previa.desde)) porClase.set(c.clase, { label: c.label, desde: d.creadoEn });
  }
  for (const [clase, v] of porClase) agregar(clase, v.label, v.desde);

  // 2. Chat en manos de una persona (o pausado) con el cliente hablando último.
  //    Si ya hay derivación abierta, esa fila lo cubre: no se duplica.
  //    Si una persona ya cerró una derivación DESPUÉS de ese mensaje («Ya lo
  //    atendí»), ese mensaje está atendido: vuelve a contar cuando el cliente
  //    escriba otra vez.
  const yaAtendido = Boolean(h.atendidaEn && h.ultimoMensajeEn && ms(h.atendidaEn) >= ms(h.ultimoMensajeEn));
  if (!porClase.size && !yaAtendido && h.modo !== "bot" && h.ultimoMensajeRol === "cliente") {
    const d = diasDesde(h.ultimoMensajeEn, ctx.ahora);
    if (d !== null && d <= DIAS_CLIENTE_ESPERA_MAX) {
      agregar(
        "cliente_espera",
        h.modo === "pausado" ? "Escribió y el chat está pausado" : "Escribió y espera respuesta",
        h.ultimoMensajeEn,
      );
    }
  }

  // 3. Pago informado por el cliente, sin verificar.
  const pago = estadoPago(h);
  if (pago.tipo === "informado") agregar("pago_por_confirmar", "Dice que pagó: confirma el pago", pago.desde);

  // 4. Beto propuso retomar y espera aprobación.
  const viva = h.propuestas.find((p) => p.estado === "propuesto");
  if (viva) {
    const beto = ctx.nombreBeto || "Beto";
    agregar(
      "propuesta_beto",
      ctx.puedeAprobarPagados ? `${beto} sugiere retomar: espera tu aprobación` : `${beto} sugiere retomar: la aprueba el dueño`,
      viva.creadoEn,
    );
  }

  // 5. Aprobó y falta el abono (sin cobro enviado).
  if (pago.tipo === "falta_pago") agregar("falta_pago", "Aprobó y falta el pago", h.etapaEn ?? h.ultimoMensajeEn);

  // 6. Cita activa cuya hora ya pasó: nadie marcó si vino.
  const pasada = h.citas
    .filter((c) => ms(c.fin) < ctx.ahora)
    .sort((a, b) => ms(b.fin) - ms(a.fin))[0];
  if (pasada) agregar("cita_por_cerrar", "La cita ya pasó: marca si vino", pasada.fin);

  items.sort(compararEnElChat);
  const principal = items[0] ?? null;
  return { requiere: items.length > 0, items, principal, grupo: principal ? grupoDe(principal) : null };
}

// ─── Beto ───────────────────────────────────────────────────────────────────

/**
 * ¿La ETAPA permite que Beto la retome? Es la primera reja de
 * `decidirCotizacion` (lib/generadorCotizacionCore.ts), sin las reglas de
 * tiempo y cupo. Un test verifica que ambas digan lo mismo.
 *
 *  - `no_contactar` nunca.
 *  - Perdido por silencio SÍ: «no contestó» no es «dijo que no».
 *  - Ganado, o perdido por cualquier otro motivo (incluido sin motivo), no.
 *  - Cotizado, o con etiqueta de cotización, sí.
 */
export function retomablePorBeto(h: Pick<HechosContacto, "etapa" | "etapaMotivo" | "etiquetas">): boolean {
  if (h.etiquetas.includes(ETIQUETA_NO_CONTACTAR)) return false;
  if (esPerdidoPorSilencio(h.etapa, h.etapaMotivo)) return true;
  if (h.etapa === "ganado" || h.etapa === "perdido") return false;
  return h.etapa === "cotizado" || h.etiquetas.includes("cotizacion");
}

/**
 * Lo que Beto hizo o hará con ESTA conversación, para mostrarlo sin fingir.
 * Null cuando no aplica (ni es retomable ni hubo actividad de Beto).
 */
export type EstadoBeto =
  | { tipo: "esperando_aprobacion"; desde: string }
  | { tipo: "programado"; para: string | null }
  | { tipo: "enviado"; en: string; respondio: boolean }
  | { tipo: "descartado"; motivo: string; en: string | null }
  | { tipo: "frenado"; motivo: string | null; en: string | null }
  | { tipo: "rechazado"; en: string | null }
  | { tipo: "apagado" }
  | { tipo: "sin_actividad" };

export function estadoBeto(h: HechosContacto, ctx: ContextoNegocio): EstadoBeto | null {
  const viva = h.propuestas.find((p) => p.estado === "propuesto");
  if (viva) return { tipo: "esperando_aprobacion", desde: viva.creadoEn };

  const deCotizacion = h.seguimientos.filter((s) => s.tipo === TIPO_SEGUIMIENTO_COTIZACION);
  const pendiente = deCotizacion.find((s) => !s.enviadoEn && !s.descartado);
  if (pendiente) return { tipo: "programado", para: pendiente.programadoPara };

  const ultimo = masReciente(deCotizacion, (s) => s.enviadoEn ?? s.programadoPara);
  const ultimaDecision = masReciente(
    h.propuestas.filter((p) => p.estado === "frenado" || p.estado === "rechazado"),
    (p) => p.resueltoEn ?? p.creadoEn,
  );
  const tUltimo = ms(ultimo?.enviadoEn ?? ultimo?.programadoPara ?? null);
  const tDecision = ms(ultimaDecision?.resueltoEn ?? ultimaDecision?.creadoEn ?? null);

  if (ultimo && (!Number.isFinite(tDecision) || tUltimo >= tDecision)) {
    if (ultimo.descartado) return { tipo: "descartado", motivo: ultimo.descartado, en: ultimo.enviadoEn };
    if (ultimo.enviadoEn) return { tipo: "enviado", en: ultimo.enviadoEn, respondio: ultimo.respuestaRecibida };
  }
  if (ultimaDecision) {
    return ultimaDecision.estado === "rechazado"
      ? { tipo: "rechazado", en: ultimaDecision.resueltoEn }
      : { tipo: "frenado", motivo: ultimaDecision.motivo, en: ultimaDecision.resueltoEn ?? ultimaDecision.creadoEn };
  }

  if (!retomablePorBeto(h)) return null;
  return ctx.betoCotizaciones ? { tipo: "sin_actividad" } : { tipo: "apagado" };
}

// ─── Oportunidad ────────────────────────────────────────────────────────────

export type TipoOportunidad =
  | "cobro_pendiente"
  | "cotizacion_activa"
  | "seguimiento_en_curso"
  | "cotizacion_sin_respuesta"
  | "interesado";

export type Oportunidad = {
  tipo: TipoOportunidad;
  label: string;
  desde: string | null;
  /** Solo cuando existe de verdad (un cobro). Nunca estimado. */
  monto: number | null;
};

export const RANGO_OPORTUNIDAD: Record<TipoOportunidad, number> = {
  cobro_pendiente: 0,
  cotizacion_activa: 1,
  seguimiento_en_curso: 2,
  cotizacion_sin_respuesta: 3,
  interesado: 4,
};

/**
 * ¿Está cerca de cerrarse? Solo con datos que existen: un cobro enviado, una
 * cotización con conversación viva o sin respuesta dentro de la ventana en que
 * todavía tiene sentido retomarla, o un interesado con actividad reciente.
 * No hay montos inventados: la base no guarda el valor de una cotización.
 */
export function oportunidadAbierta(h: HechosContacto, ctx: ContextoNegocio): Oportunidad | null {
  const pago = estadoPago(h);
  if (pago.tipo === "cobro_pendiente") {
    return { tipo: "cobro_pendiente", label: "Cobro enviado, esperando pago", desde: pago.desde, monto: pago.monto };
  }
  if (h.etapa === "ganado" || h.etapa === "perdido") return null;
  if (h.etiquetas.includes(ETIQUETA_NO_CONTACTAR)) return null;

  const dias = diasDesde(h.ultimoMensajeEn, ctx.ahora);
  const esCotizacion = h.etapa === "cotizado" || h.etiquetas.includes("cotizacion");

  if (esCotizacion) {
    const beto = estadoBeto(h, ctx);
    if (beto?.tipo === "programado") {
      return { tipo: "seguimiento_en_curso", label: `${ctx.nombreBeto || "Beto"} tiene un seguimiento programado`, desde: beto.para, monto: null };
    }
    if (beto?.tipo === "enviado" && !beto.respondio && (diasDesde(beto.en, ctx.ahora) ?? 99) <= DIAS_ANTIGUO) {
      return { tipo: "seguimiento_en_curso", label: `${ctx.nombreBeto || "Beto"} le escribió y espera respuesta`, desde: beto.en, monto: null };
    }
    if (dias === null) return null;
    if (h.ultimoMensajeRol === "cliente" || dias < DIAS_RETOMAR_MIN) {
      return { tipo: "cotizacion_activa", label: "Cotización en conversación", desde: h.ultimoMensajeEn, monto: null };
    }
    if (dias <= DIAS_RETOMAR_MAX) {
      return { tipo: "cotizacion_sin_respuesta", label: `Sin respuesta a la cotización hace ${dias} d`, desde: h.ultimoMensajeEn, monto: null };
    }
    return null;
  }

  if (h.etapa === "interesado" && dias !== null && dias <= DIAS_INTERESADO) {
    return { tipo: "interesado", label: "Mostró interés", desde: h.ultimoMensajeEn, monto: null };
  }
  return null;
}

// ─── Siguiente acción ───────────────────────────────────────────────────────

export type AccionSugerida =
  | { tipo: "responder"; label: string }
  | { tipo: "confirmar_pago"; label: string; pagoId: string | null }
  | { tipo: "revisar_propuesta"; label: string; puedeAprobar: boolean }
  | { tipo: "pedir_pago"; label: string }
  | { tipo: "ver_cita"; label: string; citaId: string }
  | { tipo: "devolver_a_tino"; label: string }
  | { tipo: "retomar"; label: string };

/**
 * UNA acción, la que corresponde por reglas del producto. El orden sigue al
 * motivo principal de atención; sin atención, lo único que queda por hacer es
 * soltar el chat (si una persona lo tiene tomado) o retomar una cotización que
 * se enfrió cuando Beto está apagado.
 */
export function siguienteAccion(
  h: HechosContacto,
  ctx: ContextoNegocio,
  atencion: Atencion = atencionRequerida(h, ctx),
  oportunidad: Oportunidad | null = oportunidadAbierta(h, ctx),
): AccionSugerida | null {
  const p = atencion.principal;
  if (p) {
    switch (p.motivo) {
      case "pago_por_confirmar": {
        const pago = estadoPago(h);
        return { tipo: "confirmar_pago", label: "Confirmar pago", pagoId: pago.tipo === "informado" ? pago.pagoPendienteId : null };
      }
      case "propuesta_beto":
        return {
          tipo: "revisar_propuesta",
          label: ctx.puedeAprobarPagados ? "Revisar y aprobar" : "Ver sugerencia",
          puedeAprobar: ctx.puedeAprobarPagados,
        };
      case "falta_pago":
        return ctx.tienePagoLink ? { tipo: "pedir_pago", label: "Enviar cobro" } : { tipo: "responder", label: "Pedir el pago" };
      case "cita_por_cerrar": {
        const cita = h.citas.filter((c) => ms(c.fin) < ctx.ahora).sort((a, b) => ms(b.fin) - ms(a.fin))[0];
        return cita ? { tipo: "ver_cita", label: "Cerrar la cita", citaId: cita.id } : null;
      }
      default:
        return { tipo: "responder", label: "Responder" };
    }
  }
  if (h.modo !== "bot") return { tipo: "devolver_a_tino", label: `Devolver a ${ctx.nombreTino || "Tino"}` };
  if (oportunidad?.tipo === "cotizacion_sin_respuesta" && !ctx.betoCotizaciones) {
    return { tipo: "retomar", label: "Retomar el contacto" };
  }
  return null;
}

// ─── Actividad ──────────────────────────────────────────────────────────────

export type EventoActividad = { clave: string; label: string; en: string; tono: "neutro" | "ok" | "alerta" | "peligro" };

const LABEL_SEGUIMIENTO: Record<string, string> = {
  cotizacion_sin_respuesta: "Seguimiento de la cotización",
  cliente_inactivo: "Mensaje para retomar el contacto",
  encuesta_postventa: "Encuesta postventa",
  recordatorio_cita: "Recordatorio de la cita",
  confirmacion_cita: "Confirmación de la cita",
  pedido_listo: "Aviso de pedido listo",
  encargo_llego: "Aviso de encargo",
  mantencion_toca: "Aviso de mantención",
};

function pesos(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

/** Lo que pasó con este cliente, lo más reciente primero. Solo hechos registrados. */
export function actividadReciente(h: HechosContacto, max = 6): EventoActividad[] {
  const ev: EventoActividad[] = [];
  for (const r of h.resultados) {
    if (r.tipo === "cotizacion_enviada") ev.push({ clave: `r-${r.tipo}-${r.creadoEn}`, label: "Se envió una cotización", en: r.creadoEn, tono: "neutro" });
    else if (r.tipo === "venta_confirmada") ev.push({ clave: `r-${r.tipo}-${r.creadoEn}`, label: "Dijo que pagó", en: r.creadoEn, tono: "alerta" });
    else if (r.tipo === "agendamiento") ev.push({ clave: `r-${r.tipo}-${r.creadoEn}`, label: "Agendó una hora", en: r.creadoEn, tono: "ok" });
    else if (r.tipo === "encuesta_respondida")
      ev.push({ clave: `r-${r.tipo}-${r.creadoEn}`, label: r.puntaje ? `Respondió la encuesta: ${r.puntaje}/5` : "Respondió la encuesta", en: r.creadoEn, tono: r.puntaje !== null && r.puntaje <= 3 ? "peligro" : "ok" });
    else if (r.tipo === "cliente_molesto") ev.push({ clave: `r-${r.tipo}-${r.creadoEn}`, label: "Quedó molesto", en: r.creadoEn, tono: "peligro" });
  }
  for (const p of h.pagos) {
    if (p.estado === "anulado") continue;
    ev.push({ clave: `p-${p.id}`, label: `Cobro enviado por ${pesos(p.monto)}`, en: p.creadoEn, tono: "neutro" });
    if (p.estado === "pagado" && p.pagadoEn) ev.push({ clave: `pp-${p.id}`, label: `Pago confirmado: ${pesos(p.monto)}`, en: p.pagadoEn, tono: "ok" });
  }
  for (const s of h.seguimientos) {
    if (!s.enviadoEn || s.descartado) continue;
    ev.push({ clave: `s-${s.tipo}-${s.enviadoEn}`, label: LABEL_SEGUIMIENTO[s.tipo] ?? "Seguimiento enviado", en: s.enviadoEn, tono: "neutro" });
  }
  ev.sort((a, b) => ms(b.en) - ms(a.en));
  return ev.slice(0, max);
}

// ─── Identidad ──────────────────────────────────────────────────────────────

export type Canal = "whatsapp" | "instagram";

export function canalDe(chatId: string): Canal {
  return chatId.startsWith("ig:") ? "instagram" : "whatsapp";
}

/** De dónde llegó, cuando se sabe: hoy solo anuncios de Meta (datos.campana). */
export function origenDe(datos: Record<string, unknown> | null): { tipo: "anuncio"; titulo: string | null } | null {
  const c = datos?.campana as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  const titulo = typeof c.titular === "string" && c.titular.trim() ? c.titular.trim() : null;
  return { tipo: "anuncio", titulo };
}

/** Pérdida anterior guardada al reabrir (datos.ultima_perdida). */
export function perdidaAnterior(datos: Record<string, unknown> | null): { motivo: string | null; en: string | null } | null {
  const p = datos?.ultima_perdida as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return null;
  return {
    motivo: typeof p.motivo === "string" ? p.motivo : null,
    en: typeof p.en === "string" ? p.en : null,
  };
}

// ─── Todo junto ─────────────────────────────────────────────────────────────

export type EstadoComercial = {
  etapa: Etapa;
  etapaLabel: string;
  /** Texto del motivo cuando agrega información (Perdido · Sin respuesta). */
  motivoEtapa: string | null;
  etapaManual: boolean;
  perdidaAnterior: { motivo: string | null; en: string | null } | null;
  pago: EstadoPago;
  atencion: Atencion;
  oportunidad: Oportunidad | null;
  beto: EstadoBeto | null;
  accion: AccionSugerida | null;
  proximaCita: HechoCita | null;
  actividad: EventoActividad[];
  canal: Canal;
  origen: { tipo: "anuncio"; titulo: string | null } | null;
};

export function derivarEstadoComercial(h: HechosContacto, ctx: ContextoNegocio): EstadoComercial {
  const atencion = atencionRequerida(h, ctx);
  const oportunidad = oportunidadAbierta(h, ctx);
  const proximaCita =
    h.citas.filter((c) => ms(c.fin) >= ctx.ahora).sort((a, b) => ms(a.inicio) - ms(b.inicio))[0] ?? null;
  return {
    etapa: h.etapa,
    etapaLabel: metaEtapa(h.etapa).label,
    motivoEtapa: etiquetaMotivoEtapa(h.etapa, h.etapaMotivo),
    etapaManual: h.etapaManual,
    perdidaAnterior: h.etapa === "perdido" ? null : perdidaAnterior(h.datos),
    pago: estadoPago(h),
    atencion,
    oportunidad,
    beto: estadoBeto(h, ctx),
    accion: siguienteAccion(h, ctx, atencion, oportunidad),
    proximaCita,
    actividad: actividadReciente(h),
    canal: canalDe(h.chatId),
    origen: origenDe(h.datos),
  };
}
