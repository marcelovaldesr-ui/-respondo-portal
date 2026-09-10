import { createHash } from "node:crypto";

/**
 * EVENTOS DE CONVERSIÓN — el núcleo puro, sin base de datos ni red.
 *
 * QUÉ ES ESTO Y POR QUÉ IMPORTA MÁS QUE EL PANEL
 * Hoy, en un anuncio Click-to-WhatsApp, lo único que Meta llega a saber es que
 * alguien ABRIÓ una conversación. Con eso optimiza: le manda el aviso a la
 * gente que abre conversaciones, no a la que compra. Devolverle el evento real
 * —«esta persona pagó $45.000»— es lo que hace que reparta la plata hacia los
 * avisos que traen compradores. Es la única pieza de esta sección que mejora el
 * resultado en vez de solo explicarlo.
 *
 * LO QUE ESTE ARCHIVO RESUELVE, QUE ES DONDE ESTOS SISTEMAS FALLAN
 *  · **Identificador estable (`event_id`).** Si el mismo cierre se reintenta,
 *    Meta tiene que contarlo UNA vez. El id se deriva del hecho —cliente,
 *    chat, tipo, momento— y no de un azar: dos intentos del mismo hecho dan el
 *    mismo id y Meta los deduplica.
 *  · **Hash de los datos de la persona.** El teléfono viaja como SHA-256 en
 *    minúsculas y solo dígitos, que es el formato que Meta exige. En claro
 *    sería entregarle a un tercero la base de contactos de un cliente.
 *  · **`ctwa_clid` obligatorio.** Sin el identificador del clic el evento no se
 *    puede atribuir a nada. Un evento así NO se manda: ensucia la cuenta del
 *    cliente y no aporta.
 *  · **Nada se manda dos veces.** El estado vive en la base; acá se decide.
 *
 * Puro y probable con Node pelado, que es donde se cazan los errores de dedupe.
 */

export type TipoEvento = "Lead" | "Schedule" | "Purchase";

/** Los eventos que Respondo SÍ puede afirmar, y de dónde sale cada uno. */
export const EVENTOS: Record<
  TipoEvento,
  { etiqueta: string; explicacion: string; origen: string }
> = {
  Lead: {
    etiqueta: "Conversación con interés",
    explicacion: "La persona pasó de saludar a preguntar por algo concreto.",
    origen: "Cuando la conversación entra a la etapa «interesado» o «cotizado» del embudo.",
  },
  Schedule: {
    etiqueta: "Agendó una hora",
    explicacion: "Quedó con día y hora tomados en la agenda.",
    origen: "Cuando se crea la cita (ed_resultados: agendamiento).",
  },
  Purchase: {
    etiqueta: "Compró",
    explicacion: "Hay una venta confirmada, con monto cuando se conoce.",
    origen: "Cuando el cobro por enlace de pago queda pagado, o se detecta la venta.",
  },
};

export type EventoPendiente = {
  clienteId: string;
  chatId: string;
  tipo: TipoEvento;
  /** Momento del hecho, en segundos (lo que pide Meta). */
  ocurridoEn: number;
  /** Identificador del clic. Sin esto el evento no sirve. */
  ctwaClid: string;
  /** Teléfono en crudo. Se hashea antes de salir; nunca se guarda el hash acá. */
  telefono?: string | null;
  valor?: number | null;
  moneda?: string | null;
};

/**
 * Normaliza un teléfono como pide Meta: solo dígitos, con código de país y sin
 * el `+`. Un número guardado como «+56 9 1234 5678» y otro como «56912345678»
 * tienen que dar el MISMO hash, o la persona no se reconoce y el evento se
 * pierde en silencio.
 */
export function normalizarTelefono(valor: string | null | undefined): string | null {
  const solo = String(valor ?? "").replace(/\D/g, "");
  if (solo.length < 8 || solo.length > 15) return null;
  return solo;
}

export function hashear(valor: string): string {
  return createHash("sha256").update(valor.trim().toLowerCase()).digest("hex");
}

/** El día en Chile de un instante (en segundos). Es la unidad de deduplicación. */
export function diaDelEvento(segundos: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(segundos * 1000));
}

/**
 * El identificador del evento.
 *
 * DETERMINISTA A PROPÓSITO: mismo hecho ⇒ mismo id, siempre. Un reintento
 * después de un timeout no le suma una venta falsa a la cuenta del cliente.
 *
 * ⭐ SE AGRUPA POR DÍA, NO POR MINUTO. Esto se corrigió el 11-sep-2026 después
 * de que una prueba destapara el problema de verdad, que no era el reintento:
 *
 *   **Una misma venta llega por DOS caminos distintos.** El barrido ve el cobro
 *   marcado como pagado (`ed_pagos`) y también el resultado `venta_confirmada`
 *   (`ed_resultados`), grabados con segundos de diferencia. Los dos se traducen
 *   a `Purchase`, mismo negocio y mismo chat. Con el id por minuto —y peor aún,
 *   si caían a los lados de un cambio de minuto— salían DOS conversiones para
 *   una sola venta, y Meta aprendía a buscar el doble de compradores de los que
 *   hubo.
 *
 * El día es la unidad correcta: por debajo, cualquier ventana deja el mismo
 * agujero en su borde. El costo es subcontar el caso raro de dos compras
 * distintas del mismo cliente el mismo día — y ese error va en la dirección que
 * corresponde: **es mejor contar de menos que inventar una venta.**
 */
export function idDeEvento(e: {
  clienteId: string;
  chatId: string;
  tipo: TipoEvento;
  ocurridoEn: number;
}): string {
  return createHash("sha256")
    .update(`${e.clienteId}|${e.chatId}|${e.tipo}|${diaDelEvento(e.ocurridoEn)}`)
    .digest("hex")
    .slice(0, 32);
}

export type Verificacion =
  | { ok: true }
  | { ok: false; motivo: string; codigo: "sin_clid" | "sin_fecha" | "valor_invalido" };

/**
 * ¿Este evento se puede mandar?
 *
 * Se prefiere NO mandar antes que mandar algo dudoso: un evento mal atribuido
 * le enseña a Meta a buscar a la gente equivocada, y eso le cuesta plata al
 * cliente durante semanas sin que nadie sepa por qué.
 */
export function verificar(e: EventoPendiente): Verificacion {
  if (!e.ctwaClid || e.ctwaClid.length < 5) {
    return {
      ok: false,
      codigo: "sin_clid",
      motivo:
        "Esta conversación no trae el identificador del clic, así que Meta no podría atribuirla a ningún anuncio.",
    };
  }
  if (!Number.isFinite(e.ocurridoEn) || e.ocurridoEn <= 0) {
    return { ok: false, codigo: "sin_fecha", motivo: "El evento no tiene una fecha válida." };
  }
  if (e.valor !== null && e.valor !== undefined) {
    if (!Number.isFinite(e.valor) || e.valor < 0) {
      return { ok: false, codigo: "valor_invalido", motivo: "El monto de la venta no es válido." };
    }
  }
  return { ok: true };
}

/**
 * Arma el cuerpo que espera la Conversions API para mensajería de negocios.
 *
 * ⚠️ Los tres campos que la vuelven específica de WhatsApp y que si faltan
 * hacen que Meta acepte el evento y no lo use para nada:
 *   `action_source: "business_messaging"` · `messaging_channel: "whatsapp"` ·
 *   `ctwa_clid` dentro de `user_data`.
 */
export function armarPayload(
  e: EventoPendiente,
  wabaId: string,
): Record<string, unknown> {
  const telefono = normalizarTelefono(e.telefono);

  const custom: Record<string, unknown> = {};
  if (e.valor !== null && e.valor !== undefined && e.valor > 0) {
    custom.value = Number(e.valor.toFixed(2));
    custom.currency = String(e.moneda ?? "CLP").toUpperCase();
  }

  return {
    data: [
      {
        event_name: e.tipo,
        event_time: Math.floor(e.ocurridoEn),
        event_id: idDeEvento(e),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: wabaId,
          ctwa_clid: e.ctwaClid,
          // Solo hasheado. El número en claro no sale nunca de acá.
          ...(telefono ? { ph: [hashear(telefono)] } : {}),
        },
        ...(Object.keys(custom).length ? { custom_data: custom } : {}),
      },
    ],
  };
}

/** Estados de la cola. `descartado` es un final legítimo, no una falla. */
export type EstadoEvento = "pendiente" | "enviado" | "fallido" | "descartado";

/**
 * ¿Se reintenta un evento que falló?
 *
 * Con techo y espaciado creciente: reintentar en bucle contra un límite de API
 * lo empeora, y un evento de hace tres días ya no le sirve a nadie.
 */
export function toca_reintentar(e: {
  estado: EstadoEvento;
  intentos: number;
  ultimoIntento: number | null;
  ahora?: number;
}): boolean {
  if (e.estado !== "fallido") return false;
  if (e.intentos >= 5) return false;
  const ahora = e.ahora ?? Date.now();
  if (!e.ultimoIntento) return true;
  // 5 min, 25 min, 2 h, 10 h — suficiente para que un problema pasajero pase.
  const esperaMs = 5 * 60_000 * Math.pow(5, Math.max(0, e.intentos - 1));
  return ahora - e.ultimoIntento >= esperaMs;
}
