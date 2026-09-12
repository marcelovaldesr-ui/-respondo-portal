/**
 * CÓMO SE DICE CADA ESTADO (Fase 1) — textos y tonos compartidos por Inicio,
 * la ficha de la conversación, Cobros y el embudo. Puro.
 *
 * Antes cada pantalla tenía su mapa de colores: el estado de un cobro estaba
 * copiado con los mismos hex en PagosCard y CobrosLista, «Te espera» era coral
 * en la bandeja y ámbar en el embudo. Un estado = un texto = un tono.
 */

import type { EstadoBeto, EstadoPago, GrupoAtencion } from "@/lib/estadoComercialCore";

export type Tono = "neutro" | "azul" | "cian" | "ok" | "alerta" | "peligro";

export const TONOS: Record<Tono, { fondo: string; texto: string }> = {
  neutro: { fondo: "var(--fondo-hundido)", texto: "var(--muted)" },
  azul: { fondo: "var(--azul-suave)", texto: "var(--azul)" },
  cian: { fondo: "var(--cian-suave)", texto: "var(--cian)" },
  ok: { fondo: "var(--ok-suave)", texto: "var(--ok)" },
  alerta: { fondo: "var(--alerta-suave)", texto: "var(--alerta)" },
  peligro: { fondo: "var(--coral-medio)", texto: "var(--peligro)" },
};

export function pesos(monto: number): string {
  return "$" + Math.round(monto).toLocaleString("es-CL");
}

/** "recién" · "25 min" · "3 h" · "4 d". */
export function haceCuanto(iso: string | null | undefined, ahora: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.floor((ahora - t) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export const GRUPOS_ATENCION: { valor: GrupoAtencion; label: string; tono: Tono }[] = [
  { valor: "urgente", label: "Urgente", tono: "peligro" },
  { valor: "hoy", label: "Para hoy", tono: "alerta" },
  { valor: "esta_semana", label: "Esta semana", tono: "cian" },
  { valor: "pendiente", label: "Por decidir", tono: "azul" },
  { valor: "antiguo", label: "Más de 7 días", tono: "neutro" },
];

export function metaGrupo(g: GrupoAtencion) {
  return GRUPOS_ATENCION.find((x) => x.valor === g) ?? GRUPOS_ATENCION[GRUPOS_ATENCION.length - 1];
}

/** Estado de pago de la CONVERSACIÓN. */
export function textoPago(p: EstadoPago): { label: string; detalle: string | null; tono: Tono } {
  switch (p.tipo) {
    case "informado":
      return {
        label: "Dice que pagó",
        detalle: p.monto ? `Por confirmar · cobro de ${pesos(p.monto)}` : "Pendiente de confirmar",
        tono: "alerta",
      };
    case "confirmado":
      return { label: "Pagado", detalle: pesos(p.monto), tono: "ok" };
    case "cobro_pendiente":
      return { label: "Cobro enviado", detalle: `${pesos(p.monto)} · esperando pago`, tono: "azul" };
    case "falta_pago":
      return { label: "Falta el pago", detalle: "Aprobó y no hay cobro", tono: "alerta" };
    default:
      return { label: "Sin cobro", detalle: null, tono: "neutro" };
  }
}

/** Estado de UN cobro (ed_pagos). Lo usan la ficha y /cobros. */
export const ESTADO_COBRO: Record<string, { label: string; tono: Tono }> = {
  pendiente: { label: "Esperando pago", tono: "azul" },
  pagado: { label: "Pagado", tono: "ok" },
  anulado: { label: "Anulado", tono: "neutro" },
};

export function textoBeto(b: EstadoBeto, nombre = "Beto"): { label: string; detalle: string | null; tono: Tono } {
  switch (b.tipo) {
    case "esperando_aprobacion":
      return { label: "Sugerencia por aprobar", detalle: `${nombre} propone retomar la cotización`, tono: "azul" };
    case "programado":
      return { label: "Seguimiento programado", detalle: `${nombre} le escribirá`, tono: "azul" };
    case "enviado":
      return {
        label: b.respondio ? "Seguimiento respondido" : "Seguimiento enviado",
        detalle: b.respondio ? "El cliente contestó" : "Esperando respuesta",
        tono: b.respondio ? "ok" : "neutro",
      };
    case "descartado":
      return { label: "Seguimiento descartado", detalle: motivoDescarte(b.motivo), tono: "neutro" };
    case "frenado":
      return { label: "No se retomó", detalle: b.motivo ? `Revisión: ${b.motivo}` : "La revisión la frenó", tono: "neutro" };
    case "rechazado":
      return { label: "Sugerencia descartada", detalle: "Una persona decidió no retomarla", tono: "neutro" };
    case "apagado":
      return { label: "Seguimiento apagado", detalle: `${nombre} no retoma cotizaciones en este negocio`, tono: "neutro" };
    default:
      // Sin prometer: Beto SUGIERE, y un envío pagado lo aprueba el dueño.
      return { label: "Sin seguimiento todavía", detalle: `Si no responde, ${nombre} puede sugerir retomarla`, tono: "neutro" };
  }
}

function motivoDescarte(m: string): string {
  if (m === "no_contactar") return "Marcado para no contactar";
  if (m.startsWith("envío falló")) return "El envío falló";
  if (m.startsWith("ventana")) return "Ventana de WhatsApp cerrada";
  return m.charAt(0).toUpperCase() + m.slice(1);
}
