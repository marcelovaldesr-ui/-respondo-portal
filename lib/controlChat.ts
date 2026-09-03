import { db } from "@/lib/db";
import { configPorCliente } from "@/lib/whatsapp";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DECIDIR POR DÓNDE SALE UN MENSAJE, Y SILENCIAR AL BOT MIENTRAS SALE.
 *
 * POR QUÉ ESTÁ ACÁ Y NO DENTRO DE acciones.ts
 * -------------------------------------------
 * Estas tres funciones nacieron privadas en las server actions del inbox. Al
 * agregar la subida de adjuntos por API hicieron falta en dos lugares, y
 * duplicarlas era exactamente el error que ya cometimos con la lógica de
 * versiones: se duplicó, una copia se quedó atrás y el resultado fue el cartel
 * que queríamos evitar (ver lib/erroresDeVersion.ts).
 *
 * Una sola definición hace imposible que vuelvan a divergir. Y estas en
 * particular deciden **desde qué número de WhatsApp sale un mensaje**: dos
 * versiones distintas de esa decisión es cómo se le escribe a un cliente desde
 * el número de otro negocio.
 */

export const MODOS = ["bot", "humano", "pausado"] as const;
export type Modo = (typeof MODOS)[number];

export type TransporteSalida =
  | { tipo: "waha" }
  | { tipo: "cloud"; config: import("@/lib/whatsapp").ConfigWhatsApp }
  | { tipo: "error"; error: string };

/**
 * Transporte de SALIDA de un cliente.
 *
 * Regla: se sale por Meta SOLO si el cliente está marcado explícitamente como
 * `transporte = 'cloud'`. Tener credenciales de Meta cargadas NO alcanza:
 * durante la migración un cliente puede tener Meta preparado pero seguir
 * atendiendo por WAHA (es el caso de Impresora Color). Basarse en "¿tiene
 * token?" mandaba las respuestas por el canal equivocado.
 *
 * Defensivo: si la columna `transporte` no existe todavía, se asume WAHA, que es
 * el comportamiento correcto hoy.
 */
export async function transporteSalida(clienteId: string): Promise<TransporteSalida> {
  const { data, error } = await db()
    .from("ed_clientes")
    .select("transporte")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) {
    return { tipo: "error", error: "No se pudo determinar el canal de salida." };
  }
  const transporte = (data?.transporte as string | null) ?? "waha";
  if (transporte !== "cloud") return { tipo: "waha" };
  const config = await configPorCliente(clienteId);
  // Nunca caer a la sesión WAHA global si un cliente Cloud quedó sin token: son
  // transportes distintos y el respaldo equivocado envía desde el número ajeno.
  if (!config) return { tipo: "error", error: "El número de Meta no tiene credenciales válidas." };
  return { tipo: "cloud", config };
}

export type ControlTemporal = { marca: string; modoAnterior: Modo; existia: boolean };

/** Silencia al bot durante el envío y permite revertir sin pisar cambios concurrentes. */
export async function tomarControlTemporal(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
): Promise<ControlTemporal | null> {
  const { data: anterior, error: lecturaError } = await supa
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (lecturaError) return null;

  const marca = new Date().toISOString();
  const { error } = await supa.from("ed_chat_estado").upsert(
    { empleado_id: empleadoId, chat_id: chatId, modo: "humano", actualizado_en: marca },
    { onConflict: "empleado_id,chat_id" },
  );
  if (error) return null;
  return {
    marca,
    modoAnterior: MODOS.includes(anterior?.modo as Modo) ? (anterior?.modo as Modo) : "bot",
    existia: Boolean(anterior),
  };
}

/**
 * Revierte solo si nadie cambió el modo después de nuestra toma temporal.
 *
 * La comparación por `actualizado_en` es lo que evita pisar a una persona que
 * tomó el control de verdad mientras nuestro envío estaba en vuelo. (Verificado
 * el 3-sep-2026 contra la base: ed_chat_estado no tiene trigger que toque
 * `actualizado_en`, así que la marca que escribimos es la que leemos.)
 *
 * Siempre UPDATE, nunca DELETE — aunque la fila no existiera antes. La fila
 * también guarda `ultimo_entrante_en` (ventana de 24 h) y `reingreso_*`, que el
 * webhook pudo escribir mientras el envío estaba en vuelo; borrarla tiraba eso.
 * Una fila en "bot" equivale a que no exista.
 */
export async function restaurarControl(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
  control: ControlTemporal,
): Promise<void> {
  await supa
    .from("ed_chat_estado")
    .update({ modo: control.modoAnterior, actualizado_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .eq("actualizado_en", control.marca);
}

/**
 * Después de un envío humano EXITOSO: si el chat estaba PAUSADO, se deja
 * pausado.
 *
 * Antes, responder desde el portal convertía "pausado" en "humano" permanente
 * (auditoría 3-sep-2026). Los dos silencian al asistente, pero no son lo mismo:
 * "pausado" lo eligió el dueño a mano y el vigilante de abandonadas no lo
 * toca; "humano" es "una persona está atendiendo" y el vigilante SÍ puede
 * hacer que Tino retome si nadie sigue. Un chat que el dueño pausó no debe
 * volver a manos de Tino solo porque alguien le contestó una vez.
 */
export async function conservarPausa(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
  control: ControlTemporal,
): Promise<void> {
  if (control.modoAnterior !== "pausado") return;
  await restaurarControl(supa, empleadoId, chatId, control);
}
