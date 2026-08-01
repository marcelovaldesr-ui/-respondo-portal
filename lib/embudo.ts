import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * EMBUDO — en qué va cada conversación.
 *
 * Las etiquetas dicen QUÉ es una conversación (cotización, reclamo). La etapa
 * dice EN QUÉ VA. Es la diferencia entre una bandeja y un tablero de ventas:
 * responde "¿cuánto tengo por cerrar?" y "¿qué está frenado?".
 *
 * CÓMO SE MUEVE UNA CONVERSACIÓN
 *  - Sola: a partir de las señales que el asistente ya emite hoy (etiquetas
 *    automáticas y agendamientos). No hay que configurar nada.
 *  - A mano: si una persona la mueve, queda marcada como manual y el cálculo
 *    automático NO la vuelve a tocar. El criterio del dueño siempre gana.
 *
 * La etapa NUNCA retrocede sola: si el asistente ya la había llevado a
 * "cotizado", un mensaje nuevo no la devuelve a "nuevo".
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

/** Orden del embudo: se usa para no retroceder de etapa automáticamente. */
const ORDEN: Record<Etapa, number> = {
  nuevo: 0,
  interesado: 1,
  cotizado: 2,
  ganado: 3,
  perdido: 3, // terminal, mismo nivel que ganado
};

export function metaEtapa(valor: string) {
  return ETAPAS.find((e) => e.valor === valor) ?? ETAPAS[0];
}

/**
 * Etapa que corresponde según las señales del asistente.
 * Solo mira lo que YA existe: etiquetas automáticas y agendamientos.
 */
export function etapaSegunSenales(params: {
  etiquetas: string[];
  tieneAgendamiento?: boolean;
  tieneVenta?: boolean;
}): Etapa {
  const e = params.etiquetas ?? [];
  if (params.tieneVenta || params.tieneAgendamiento || e.includes("agendado")) return "ganado";
  if (e.includes("cotizacion")) return "cotizado";
  if (e.includes("posible_comprador")) return "interesado";
  return "nuevo";
}

export type TarjetaEmbudo = {
  chatId: string;
  contacto: string;
  etapa: Etapa;
  etapaManual: boolean;
  etiquetas: string[];
  ultimoMensaje: string;
  ultimoEn: string | null;
  esperandoHumano: boolean;
};

/**
 * Recalcula las etapas automáticas y devuelve el tablero listo para pintar.
 *
 * Se recalcula al abrir la página (no hay proceso de fondo): para el volumen de
 * una pyme es instantáneo y evita un cron más que mantener. Solo escribe cuando
 * la etapa cambia de verdad, así no genera tráfico inútil.
 */
export async function cargarEmbudo(
  clienteId: string,
  /**
   * Solo conversaciones con actividad en los últimos N días (0 = todas).
   *
   * POR QUÉ EXISTE: sin este corte, el tablero se llena de conversaciones que
   * ya terminaron ("muchas gracias", "recibido") y que quedaron en Nuevo porque
   * son historial importado que nunca pasó por el asistente. El dueño abría el
   * embudo, veía "55 por cerrar" cuando en verdad tenía 7, y dejaba de creerle
   * al panel. Un tablero de ventas sirve por lo que DEJA FUERA.
   */
  diasActividad = 14,
  supaOpt?: SupabaseClient,
): Promise<TarjetaEmbudo[]> {
  const supa = supaOpt ?? db();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) return [];

  const [contactosR, resultadosR, escalacionesR] = await Promise.all([
    supa
      .from("ed_contactos")
      .select(
        "chat_id, nombre, etiquetas, etapa, etapa_manual, ultimo_mensaje_en, ultimo_mensaje_texto",
      )
      .eq("cliente_id", clienteId),
    supa.from("ed_resultados").select("chat_id, tipo").in("empleado_id", ids),
    supa
      .from("ed_escalaciones")
      .select("chat_id")
      .in("empleado_id", ids)
      .is("atendida_en", null),
  ]);

  const contactos = contactosR.data ?? [];
  if (!contactos.length) return [];

  // Señales de "ganado" que vienen de ed_resultados (agenda y ventas).
  const conAgenda = new Set<string>();
  const conVenta = new Set<string>();
  for (const r of resultadosR.data ?? []) {
    const t = r.tipo as string;
    if (t === "agendamiento") conAgenda.add(r.chat_id as string);
    if (t === "venta_confirmada" || t === "venta_recuperada") conVenta.add(r.chat_id as string);
  }
  const esperando = new Set((escalacionesR.data ?? []).map((e) => e.chat_id as string));

  /**
   * El último mensaje de cada chat ya viene en ed_contactos, mantenido por el
   * trigger de la migración 250. Antes se recorrían todos los mensajes del
   * negocio para averiguarlo: era la consulta más cara del portal (1,3 s con
   * 1.467 mensajes y creciendo lineal).
   */

  const cambios: { chat_id: string; etapa: Etapa }[] = [];
  const tarjetas: TarjetaEmbudo[] = [];

  for (const c of contactos) {
    const chatId = c.chat_id as string;
    const etiquetas = (c.etiquetas as string[] | null) ?? [];
    const guardada = ((c.etapa as string) ?? "nuevo") as Etapa;
    const manual = Boolean(c.etapa_manual);

    let etapa = guardada;
    if (!manual) {
      const sugerida = etapaSegunSenales({
        etiquetas,
        tieneAgendamiento: conAgenda.has(chatId),
        tieneVenta: conVenta.has(chatId),
      });
      // Solo avanza; nunca retrocede sola.
      if (ORDEN[sugerida] > ORDEN[guardada]) {
        etapa = sugerida;
        cambios.push({ chat_id: chatId, etapa });
      }
    }

    tarjetas.push({
      chatId,
      contacto: (c.nombre as string) || `+${chatId}`,
      etapa,
      etapaManual: manual,
      etiquetas,
      ultimoMensaje: (c.ultimo_mensaje_texto as string) ?? "",
      ultimoEn: (c.ultimo_mensaje_en as string) ?? null,
      esperandoHumano: esperando.has(chatId),
    });
  }

  // Persistir solo lo que cambió.
  for (const c of cambios) {
    await supa
      .from("ed_contactos")
      .update({ etapa: c.etapa, etapa_en: new Date().toISOString() })
      .eq("cliente_id", clienteId)
      .eq("chat_id", c.chat_id);
  }

  // Más recientes primero dentro de cada columna.
  tarjetas.sort((a, b) => (b.ultimoEn ?? "").localeCompare(a.ultimoEn ?? ""));

  // Corte por actividad. Se aplica DESPUÉS de recalcular las etapas para que el
  // estado quede guardado igual, aunque la tarjeta no se muestre hoy: si el
  // cliente vuelve a escribir, reaparece en la etapa correcta.
  if (diasActividad > 0) {
    const corte = new Date(Date.now() - diasActividad * 86400_000).toISOString();
    return tarjetas.filter((t) => (t.ultimoEn ?? "") >= corte);
  }
  return tarjetas;
}

/**
 * Mueve una conversación de etapa a mano. Queda marcada como manual para que el
 * cálculo automático no la pise después.
 */
export async function moverEtapa(
  clienteId: string,
  chatId: string,
  etapa: Etapa,
  supaOpt?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  if (!ETAPAS.some((e) => e.valor === etapa)) return { ok: false, error: "Etapa no válida" };
  const supa = supaOpt ?? db();
  const { error } = await supa
    .from("ed_contactos")
    .update({ etapa, etapa_manual: true, etapa_en: new Date().toISOString() })
    .eq("cliente_id", clienteId) // barrera de acceso
    .eq("chat_id", chatId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Devuelve el control de la etapa al cálculo automático.
 *
 * Ojo con un detalle que confunde si no se maneja: como la etapa nunca retrocede
 * sola, con solo quitar la marca manual la tarjeta se quedaría donde el humano
 * la dejó y el botón "que la maneje el asistente" no haría nada visible. Por eso
 * acá SÍ se recalcula de inmediato desde las señales, aunque implique retroceder:
 * es lo que la persona acaba de pedir explícitamente.
 */
export async function liberarEtapa(
  clienteId: string,
  chatId: string,
  supaOpt?: SupabaseClient,
): Promise<{ ok: boolean }> {
  const supa = supaOpt ?? db();

  const [contactoR, empleadosR] = await Promise.all([
    supa
      .from("ed_contactos")
      .select("etiquetas")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    supa.from("ed_empleados").select("id").eq("cliente_id", clienteId),
  ]);

  const ids = (empleadosR.data ?? []).map((e) => e.id as string);
  let tieneAgendamiento = false;
  let tieneVenta = false;
  if (ids.length) {
    const { data: res } = await supa
      .from("ed_resultados")
      .select("tipo")
      .in("empleado_id", ids)
      .eq("chat_id", chatId);
    for (const r of res ?? []) {
      const t = r.tipo as string;
      if (t === "agendamiento") tieneAgendamiento = true;
      if (t === "venta_confirmada" || t === "venta_recuperada") tieneVenta = true;
    }
  }

  const etapa = etapaSegunSenales({
    etiquetas: ((contactoR.data?.etiquetas as string[] | null) ?? []),
    tieneAgendamiento,
    tieneVenta,
  });

  const { error } = await supa
    .from("ed_contactos")
    .update({ etapa_manual: false, etapa, etapa_en: new Date().toISOString() })
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId);
  return { ok: !error };
}
